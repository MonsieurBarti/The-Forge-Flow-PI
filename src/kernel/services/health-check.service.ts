import { appendFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { JournalRepositoryPort } from "@hexagons/execution/domain/ports/journal-repository.port";
import type { SliceRepositoryPort } from "@hexagons/slice";
import type { TaskRepositoryPort } from "@hexagons/task/domain/ports/task-repository.port";
import type { ArtifactFilePort } from "@hexagons/workflow/domain/ports/artifact-file.port";
import type { GitPort } from "@kernel/ports/git.port";
import type { GitHookPort } from "@kernel/ports/git-hook.port";
import type { StateBranchOpsPort } from "@kernel/ports/state-branch-ops.port";
import type { WorktreePort } from "@kernel/ports/worktree.port";
import type { Result } from "@kernel/result";
import { err, ok } from "@kernel/result";

export interface HealthCheckDeps {
  gitHookPort: GitHookPort;
  stateBranchOps: StateBranchOpsPort;
  gitPort: GitPort;
  hookScriptContent: string;
  projectRoot: string;
  worktreePort?: WorktreePort;
  sliceRepo?: SliceRepositoryPort;
  taskRepo?: TaskRepositoryPort;
  journalRepo?: JournalRepositoryPort;
  artifactFile?: ArtifactFilePort;
}

export interface DriftDetail {
  sliceId: string;
  sliceLabel: string;
  journalCompleted: number;
  sqliteCompleted: number;
}

export interface HealthCheckReport {
  fixed: string[];
  warnings: string[];
  driftDetails: DriftDetail[];
}

export class HealthCheckService {
  constructor(private readonly deps: HealthCheckDeps) {}

  async ensurePostCheckoutHook(): Promise<Result<string | null, Error>> {
    const result = await this.deps.gitHookPort.isPostCheckoutHookInstalled();
    if (!result.ok || result.data) return ok(null);

    const installResult = await this.deps.gitHookPort.installPostCheckoutHook(
      this.deps.hookScriptContent,
    );
    if (installResult.ok) {
      return ok("Post-checkout hook installed");
    }
    return err(new Error(String(installResult.error)));
  }

  async ensureGitignore(): Promise<Result<string | null, Error>> {
    const gitignorePath = join(this.deps.projectRoot, ".gitignore");
    if (!existsSync(gitignorePath)) return ok(null);

    const content = readFileSync(gitignorePath, "utf-8");
    const lines = content.split("\n");
    const missing: string[] = [];

    if (!lines.some((l) => l.trim() === ".tff/")) missing.push(".tff/");
    if (!lines.some((l) => l.trim() === ".tff.backup.*")) missing.push(".tff.backup.*");

    if (missing.length > 0) {
      const suffix = `${(content.endsWith("\n") ? "" : "\n") + missing.join("\n")}\n`;
      appendFileSync(gitignorePath, suffix);
      return ok(`.gitignore: added ${missing.join(", ")}`);
    }

    return ok(null);
  }

  cleanStaleLocks(tffDir: string): Result<string | null, Error> {
    const lockPath = join(tffDir, ".lock");
    if (!existsSync(lockPath)) return ok(null);

    try {
      const raw = JSON.parse(readFileSync(lockPath, "utf-8"));
      const pid = raw.pid as number;
      const acquiredAt = new Date(raw.acquiredAt as string);

      try {
        process.kill(pid, 0);
        const ageMs = Date.now() - acquiredAt.getTime();
        if (ageMs > 5 * 60 * 1000) {
          unlinkSync(lockPath);
          return ok(`Stale lock removed (age: ${Math.round(ageMs / 1000)}s, PID ${pid})`);
        }
        return ok(null);
      } catch {
        unlinkSync(lockPath);
        return ok(`Stale lock removed (dead PID ${pid})`);
      }
    } catch {
      unlinkSync(lockPath);
      return ok("Stale lock removed (malformed)");
    }
  }

  async checkOrphanedState(tffDir: string): Promise<Result<string[], Error>> {
    const metaPath = join(tffDir, "branch-meta.json");
    if (existsSync(metaPath)) return ok([]);

    const branchResult = await this.deps.gitPort.currentBranch();
    if (!branchResult.ok || branchResult.data === null) return ok([]);

    const stateBranch = `tff-state/${branchResult.data}`;
    const existsResult = await this.deps.stateBranchOps.branchExists(stateBranch);
    if (existsResult.ok && existsResult.data) {
      return ok([`State branch ${stateBranch} exists but no branch-meta.json — restore needed`]);
    }

    return ok([]);
  }

  async checkOrphanedWorktrees(): Promise<Result<string[], Error>> {
    if (!this.deps.worktreePort || !this.deps.sliceRepo) return ok([]);

    const worktreesResult = await this.deps.worktreePort.list();
    if (!worktreesResult.ok) return ok([]);

    const activeStatuses = new Set([
      "discussing",
      "researching",
      "planning",
      "executing",
      "verifying",
      "reviewing",
    ] as const);

    const milestoneResult = await this.deps.sliceRepo.findByKind("milestone");
    const quickResult = await this.deps.sliceRepo.findByKind("quick");
    const debugResult = await this.deps.sliceRepo.findByKind("debug");

    const activeSlices = [
      ...(milestoneResult.ok ? milestoneResult.data : []),
      ...(quickResult.ok ? quickResult.data : []),
      ...(debugResult.ok ? debugResult.data : []),
    ].filter((s) =>
      activeStatuses.has(s.status as typeof activeStatuses extends Set<infer T> ? T : never),
    );

    const worktrees = worktreesResult.data;
    const activeSliceIds = new Set(activeSlices.map((s) => s.id));
    const worktreeSliceIds = new Set(worktrees.map((w) => w.sliceId));

    const warnings: string[] = [];

    for (const wt of worktrees) {
      if (!activeSliceIds.has(wt.sliceId)) {
        warnings.push(
          `Worktree for slice ${wt.sliceId} (branch: ${wt.branch}) has no matching active slice`,
        );
      }
    }

    for (const slice of activeSlices) {
      if (!worktreeSliceIds.has(slice.id)) {
        warnings.push(`Active slice ${slice.label} (${slice.id}) has no worktree`);
      }
    }

    return ok(warnings);
  }

  async checkJournalDrift(): Promise<Result<DriftDetail[], Error>> {
    if (!this.deps.journalRepo || !this.deps.taskRepo || !this.deps.sliceRepo) return ok([]);

    const activeStatuses = new Set([
      "discussing",
      "researching",
      "planning",
      "executing",
      "verifying",
      "reviewing",
    ] as const);

    const milestoneResult = await this.deps.sliceRepo.findByKind("milestone");
    const quickResult = await this.deps.sliceRepo.findByKind("quick");
    const debugResult = await this.deps.sliceRepo.findByKind("debug");

    const activeSlices = [
      ...(milestoneResult.ok ? milestoneResult.data : []),
      ...(quickResult.ok ? quickResult.data : []),
      ...(debugResult.ok ? debugResult.data : []),
    ].filter((s) =>
      activeStatuses.has(s.status as typeof activeStatuses extends Set<infer T> ? T : never),
    );

    const driftDetails: DriftDetail[] = [];

    for (const slice of activeSlices) {
      const journalResult = await this.deps.journalRepo.readAll(slice.id);
      const tasksResult = await this.deps.taskRepo.findBySliceId(slice.id);

      if (!journalResult.ok || !tasksResult.ok) continue;

      const journalCompleted = journalResult.data.filter((e) => e.type === "task-completed").length;
      const sqliteCompleted = tasksResult.data.filter((t) => t.status === "closed").length;

      if (journalCompleted !== sqliteCompleted) {
        driftDetails.push({
          sliceId: slice.id,
          sliceLabel: slice.label,
          journalCompleted,
          sqliteCompleted,
        });
      }
    }

    return ok(driftDetails);
  }

  async checkMissingArtifacts(): Promise<Result<string[], Error>> {
    if (!this.deps.artifactFile || !this.deps.sliceRepo) return ok([]);

    const milestoneResult = await this.deps.sliceRepo.findByKind("milestone");
    const quickResult = await this.deps.sliceRepo.findByKind("quick");
    const debugResult = await this.deps.sliceRepo.findByKind("debug");

    const allSlices = [
      ...(milestoneResult.ok ? milestoneResult.data : []),
      ...(quickResult.ok ? quickResult.data : []),
      ...(debugResult.ok ? debugResult.data : []),
    ];

    const statusOrder: Record<string, number> = {
      discussing: 0,
      researching: 1,
      planning: 2,
      executing: 3,
      verifying: 4,
      reviewing: 5,
    };

    const warnings: string[] = [];

    for (const slice of allSlices) {
      const phase = statusOrder[slice.status];
      if (phase === undefined) continue; // closed or completing — skip

      // researching+ needs SPEC.md
      if (phase >= statusOrder.researching) {
        const milestoneLabel =
          slice.kind === "milestone" ? this.resolveMilestoneLabel(slice.label) : null;
        const specResult = await this.deps.artifactFile.read(
          milestoneLabel,
          slice.label,
          "spec",
          slice.kind,
        );
        if (specResult.ok && specResult.data === null) {
          warnings.push(`${slice.label}: missing SPEC.md (status: ${slice.status})`);
        }
      }

      // executing+ needs PLAN.md
      if (phase >= statusOrder.executing) {
        const milestoneLabel =
          slice.kind === "milestone" ? this.resolveMilestoneLabel(slice.label) : null;
        const planResult = await this.deps.artifactFile.read(
          milestoneLabel,
          slice.label,
          "plan",
          slice.kind,
        );
        if (planResult.ok && planResult.data === null) {
          warnings.push(`${slice.label}: missing PLAN.md (status: ${slice.status})`);
        }
      }
    }

    return ok(warnings);
  }

  private resolveMilestoneLabel(sliceLabel: string): string {
    // Slice labels are like M07-S11 — milestone label is M07
    const match = sliceLabel.match(/^(M\d{2,})/);
    return match ? match[1] : sliceLabel;
  }

  async runAll(tffDir: string): Promise<Result<HealthCheckReport, Error>> {
    const report: HealthCheckReport = { fixed: [], warnings: [], driftDetails: [] };

    const hookResult = await this.ensurePostCheckoutHook();
    if (hookResult.ok && hookResult.data) report.fixed.push(hookResult.data);

    const gitignoreResult = await this.ensureGitignore();
    if (gitignoreResult.ok && gitignoreResult.data) report.fixed.push(gitignoreResult.data);

    const lockResult = this.cleanStaleLocks(tffDir);
    if (lockResult.ok && lockResult.data) report.fixed.push(lockResult.data);

    const orphanResult = await this.checkOrphanedState(tffDir);
    if (orphanResult.ok) report.warnings.push(...orphanResult.data);

    const worktreeResult = await this.checkOrphanedWorktrees();
    if (worktreeResult.ok) report.warnings.push(...worktreeResult.data);

    const driftResult = await this.checkJournalDrift();
    if (driftResult.ok) report.driftDetails.push(...driftResult.data);

    const artifactResult = await this.checkMissingArtifacts();
    if (artifactResult.ok) report.warnings.push(...artifactResult.data);

    return ok(report);
  }
}
