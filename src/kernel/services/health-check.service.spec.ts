import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JournalEntry } from "@hexagons/execution/domain/journal-entry.schemas";
import { InMemoryJournalRepository } from "@hexagons/execution/infrastructure/repositories/journal/in-memory-journal.repository";
import { Slice } from "@hexagons/slice/domain/slice.aggregate";
import { SliceBuilder } from "@hexagons/slice/domain/slice.builder";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { Task } from "@hexagons/task/domain/task.aggregate";
import { InMemoryTaskRepository } from "@hexagons/task/infrastructure/in-memory-task.repository";
import { InMemoryArtifactFileAdapter } from "@hexagons/workflow/infrastructure/in-memory-artifact-file.adapter";
import type { GitError } from "@kernel/errors/git.error";
import { InMemoryGitAdapter } from "@kernel/infrastructure/in-memory-git.adapter";
import { InMemoryWorktreeAdapter } from "@kernel/infrastructure/worktree/in-memory-worktree.adapter";
import type { GitHookPort, HookError } from "@kernel/ports/git-hook.port";
import type { StateBranchOpsPort } from "@kernel/ports/state-branch-ops.port";
import { ok, type Result } from "@kernel/result";
import { afterEach, describe, expect, it } from "vitest";
import { HealthCheckService } from "./health-check.service";

function makeTaskCompletedEntry(sliceId: string, taskId: string): Omit<JournalEntry, "seq"> {
  return {
    sliceId,
    timestamp: new Date(),
    type: "task-completed",
    taskId,
    waveIndex: 0,
    durationMs: 100,
  } as Omit<JournalEntry, "seq">;
}

function makeSlice(
  label: string,
  status: string,
  kind: "milestone" | "quick" | "debug" = "milestone",
) {
  const builder = new SliceBuilder()
    .withLabel(label)
    .withStatus(status as Parameters<SliceBuilder["withStatus"]>[0])
    .withKind(kind);
  const props = builder.buildProps();
  return Slice.reconstitute({
    ...props,
    milestoneId: kind === "milestone" ? (props.milestoneId ?? crypto.randomUUID()) : null,
  });
}

// ── Stubs ──────────────────────────────────────────────────────────────────

class StubGitHookPort implements GitHookPort {
  isInstalledResult: Result<boolean, HookError> = ok(true);
  installResult: Result<void, HookError> = ok(undefined);
  uninstallResult: Result<void, HookError> = ok(undefined);

  installCalls = 0;
  isInstalledCalls = 0;

  isPostCheckoutHookInstalled(): Promise<Result<boolean, HookError>> {
    this.isInstalledCalls++;
    return Promise.resolve(this.isInstalledResult);
  }

  installPostCheckoutHook(_scriptContent: string): Promise<Result<void, HookError>> {
    this.installCalls++;
    return Promise.resolve(this.installResult);
  }

  uninstallPostCheckoutHook(): Promise<Result<void, HookError>> {
    return Promise.resolve(this.uninstallResult);
  }
}

class StubStateBranchOpsPort implements StateBranchOpsPort {
  branchExistsResult: Result<boolean, GitError> = ok(false);

  createOrphan(_branchName: string): Promise<Result<void, GitError>> {
    return Promise.resolve(ok(undefined));
  }

  forkBranch(_source: string, _target: string): Promise<Result<void, GitError>> {
    return Promise.resolve(ok(undefined));
  }

  deleteBranch(_branchName: string): Promise<Result<void, GitError>> {
    return Promise.resolve(ok(undefined));
  }

  branchExists(_branchName: string): Promise<Result<boolean, GitError>> {
    return Promise.resolve(this.branchExistsResult);
  }

  renameBranch(_oldName: string, _newName: string): Promise<Result<void, GitError>> {
    return Promise.resolve(ok(undefined));
  }

  syncToStateBranch(
    _stateBranch: string,
    _files: Map<string, string>,
  ): Promise<Result<string, GitError>> {
    return Promise.resolve(ok("abc123"));
  }

  readFromStateBranch(
    _stateBranch: string,
    _path: string,
  ): Promise<Result<string | null, GitError>> {
    return Promise.resolve(ok(null));
  }

  readAllFromStateBranch(_stateBranch: string): Promise<Result<Map<string, string>, GitError>> {
    return Promise.resolve(ok(new Map()));
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "tff-health-check-test-"));
}

function buildTffDir(projectRoot: string): string {
  const tffDir = join(projectRoot, ".tff");
  mkdirSync(tffDir, { recursive: true });
  return tffDir;
}

function makeService(
  overrides: Partial<{
    gitHookPort: StubGitHookPort;
    stateBranchOps: StubStateBranchOpsPort;
    gitPort: InMemoryGitAdapter;
    projectRoot: string;
    worktreePort: InMemoryWorktreeAdapter;
    sliceRepo: InMemorySliceRepository;
    taskRepo: InMemoryTaskRepository;
    journalRepo: InMemoryJournalRepository;
    artifactFile: InMemoryArtifactFileAdapter;
  }> = {},
  projectRoot: string,
) {
  return new HealthCheckService({
    gitHookPort: overrides.gitHookPort ?? new StubGitHookPort(),
    stateBranchOps: overrides.stateBranchOps ?? new StubStateBranchOpsPort(),
    gitPort: overrides.gitPort ?? new InMemoryGitAdapter(),
    hookScriptContent: "#!/bin/sh\necho hook",
    projectRoot: overrides.projectRoot ?? projectRoot,
    worktreePort: overrides.worktreePort,
    sliceRepo: overrides.sliceRepo,
    taskRepo: overrides.taskRepo,
    journalRepo: overrides.journalRepo,
    artifactFile: overrides.artifactFile,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("HealthCheckService", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const r of roots.splice(0)) {
      rmSync(r, { recursive: true, force: true });
    }
  });

  describe("hook check", () => {
    it("installs hook when missing", async () => {
      const root = makeTmpDir();
      roots.push(root);

      const hookPort = new StubGitHookPort();
      hookPort.isInstalledResult = ok(false);

      const service = makeService({ gitHookPort: hookPort }, root);
      const result = await service.ensurePostCheckoutHook();

      expect(hookPort.installCalls).toBe(1);
      expect(result.ok).toBe(true);
      expect(result.ok && result.data).toBe("Post-checkout hook installed");
    });

    it("skips installation when hook already installed", async () => {
      const root = makeTmpDir();
      roots.push(root);

      const hookPort = new StubGitHookPort();
      hookPort.isInstalledResult = ok(true);

      const service = makeService({ gitHookPort: hookPort }, root);
      const result = await service.ensurePostCheckoutHook();

      expect(hookPort.installCalls).toBe(0);
      expect(result.ok).toBe(true);
      expect(result.ok && result.data).toBeNull();
    });
  });

  describe("orphaned state check", () => {
    it("returns warning when state branch exists but branch-meta missing", async () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffDir(root);
      // No branch-meta.json

      const stateBranchOps = new StubStateBranchOpsPort();
      stateBranchOps.branchExistsResult = ok(true);

      const gitPort = new InMemoryGitAdapter();
      gitPort.setCurrentBranch("feature/foo");

      const service = makeService({ stateBranchOps, gitPort }, root);
      const result = await service.checkOrphanedState(tffDir);

      expect(result.ok).toBe(true);
      expect(result.ok && result.data.some((w) => w.includes("tff-state/feature/foo"))).toBe(true);
    });

    it("returns no warnings when no orphaned state exists", async () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffDir(root);
      // No branch-meta.json

      const stateBranchOps = new StubStateBranchOpsPort();
      stateBranchOps.branchExistsResult = ok(false);

      const service = makeService({ stateBranchOps }, root);
      const result = await service.checkOrphanedState(tffDir);

      expect(result.ok).toBe(true);
      expect(result.ok && result.data).toHaveLength(0);
    });
  });

  describe(".gitignore check", () => {
    it("appends missing entries to .gitignore", async () => {
      const root = makeTmpDir();
      roots.push(root);
      writeFileSync(join(root, ".gitignore"), "node_modules/\n");

      const service = makeService({}, root);
      const result = await service.ensureGitignore();

      expect(result.ok).toBe(true);
      expect(result.ok && result.data).toContain(".gitignore");
      const content = readFileSync(join(root, ".gitignore"), "utf-8");
      expect(content).toContain(".tff/");
      expect(content).toContain(".tff.backup.*");
    });

    it("skips .gitignore when both entries already present", async () => {
      const root = makeTmpDir();
      roots.push(root);
      writeFileSync(join(root, ".gitignore"), ".tff/\n.tff.backup.*\n");

      const service = makeService({}, root);
      const result = await service.ensureGitignore();

      expect(result.ok).toBe(true);
      expect(result.ok && result.data).toBeNull();
    });
  });

  describe("stale lock check", () => {
    it("removes lock with dead PID", () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffDir(root);

      const lockPath = join(tffDir, ".lock");
      writeFileSync(
        lockPath,
        JSON.stringify({ pid: 999999999, acquiredAt: new Date().toISOString() }),
      );

      const service = makeService({}, root);
      const result = service.cleanStaleLocks(tffDir);

      expect(result.ok).toBe(true);
      expect(result.ok && result.data).toContain("dead PID 999999999");
    });

    it("leaves fresh lock with live PID alone", () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffDir(root);

      const lockPath = join(tffDir, ".lock");
      writeFileSync(
        lockPath,
        JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }),
      );

      const service = makeService({}, root);
      const result = service.cleanStaleLocks(tffDir);

      expect(result.ok).toBe(true);
      expect(result.ok && result.data).toBeNull();
    });

    it("removes malformed lock file", () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffDir(root);

      const lockPath = join(tffDir, ".lock");
      writeFileSync(lockPath, "not-valid-json{{{{");

      const service = makeService({}, root);
      const result = service.cleanStaleLocks(tffDir);

      expect(result.ok).toBe(true);
      expect(result.ok && result.data).toContain("malformed");
    });
  });

  describe("runAll", () => {
    it("aggregates results from all checks", async () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffDir(root);

      // Hook missing → will be fixed
      const hookPort = new StubGitHookPort();
      hookPort.isInstalledResult = ok(false);

      // Gitignore missing entries → will be fixed
      writeFileSync(join(root, ".gitignore"), "node_modules/\n");

      // Stale lock with dead PID → will be fixed
      const lockPath = join(tffDir, ".lock");
      writeFileSync(
        lockPath,
        JSON.stringify({ pid: 999999999, acquiredAt: new Date().toISOString() }),
      );

      // Orphaned state → warning
      const stateBranchOps = new StubStateBranchOpsPort();
      stateBranchOps.branchExistsResult = ok(true);
      const gitPort = new InMemoryGitAdapter();
      gitPort.setCurrentBranch("feature/bar");

      const service = makeService({ gitHookPort: hookPort, stateBranchOps, gitPort }, root);
      const result = await service.runAll(tffDir);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.fixed.some((m) => m.includes("Post-checkout hook"))).toBe(true);
      expect(result.data.fixed.some((m) => m.includes(".gitignore"))).toBe(true);
      expect(result.data.fixed.some((m) => m.includes("dead PID"))).toBe(true);
      expect(result.data.warnings.some((w) => w.includes("tff-state/feature/bar"))).toBe(true);
    });

    it("includes driftDetails in report", async () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffDir(root);

      const sliceRepo = new InMemorySliceRepository();
      const taskRepo = new InMemoryTaskRepository();
      const journalRepo = new InMemoryJournalRepository();

      const slice = makeSlice("M01-S01", "executing");
      sliceRepo.seed(slice);

      const tid1 = crypto.randomUUID();
      const tid2 = crypto.randomUUID();
      const tid3 = crypto.randomUUID();

      // 3 journal task-completed, 2 sqlite closed
      for (const taskId of [tid1, tid2, tid3]) {
        await journalRepo.append(slice.id, makeTaskCompletedEntry(slice.id, taskId));
      }

      const now = new Date();
      const t1 = Task.createNew({ id: tid1, sliceId: slice.id, label: "T01", title: "t1", now });
      t1.start(now);
      t1.complete(now);
      const t2 = Task.createNew({ id: tid2, sliceId: slice.id, label: "T02", title: "t2", now });
      t2.start(now);
      t2.complete(now);
      taskRepo.seed(t1);
      taskRepo.seed(t2);

      const service = makeService({ sliceRepo, taskRepo, journalRepo }, root);
      const result = await service.runAll(tffDir);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.driftDetails).toHaveLength(1);
      expect(result.data.driftDetails[0].sliceLabel).toBe("M01-S01");
      expect(result.data.driftDetails[0].journalCompleted).toBe(3);
      expect(result.data.driftDetails[0].sqliteCompleted).toBe(2);
    });
  });

  describe("checkOrphanedWorktrees", () => {
    it("returns warning for worktree with no matching active slice", async () => {
      const root = makeTmpDir();
      roots.push(root);

      const sliceRepo = new InMemorySliceRepository();
      const worktreePort = new InMemoryWorktreeAdapter();

      // Active slice exists
      const slice = makeSlice("M01-S01", "executing");
      sliceRepo.seed(slice);

      // Worktree for a different (non-existent active) slice
      worktreePort.seed({
        sliceId: "orphan-slice-id",
        branch: "slice/orphan",
        path: "/tmp/orphan",
        baseBranch: "main",
      });

      const service = makeService({ sliceRepo, worktreePort }, root);
      const result = await service.checkOrphanedWorktrees();

      expect(result.ok).toBe(true);
      expect(result.ok && result.data.some((w) => w.includes("orphan-slice-id"))).toBe(true);
    });

    it("returns warning for active slice with no worktree", async () => {
      const root = makeTmpDir();
      roots.push(root);

      const sliceRepo = new InMemorySliceRepository();
      const worktreePort = new InMemoryWorktreeAdapter();

      const slice = makeSlice("M01-S01", "executing");
      sliceRepo.seed(slice);
      // No worktree seeded

      const service = makeService({ sliceRepo, worktreePort }, root);
      const result = await service.checkOrphanedWorktrees();

      expect(result.ok).toBe(true);
      expect(result.ok && result.data.some((w) => w.includes("M01-S01"))).toBe(true);
    });

    it("returns empty when worktreePort not provided", async () => {
      const root = makeTmpDir();
      roots.push(root);

      const service = makeService({}, root);
      const result = await service.checkOrphanedWorktrees();

      expect(result.ok).toBe(true);
      expect(result.ok && result.data).toHaveLength(0);
    });
  });

  describe("checkJournalDrift", () => {
    it("detects drift when journal has more completed than sqlite", async () => {
      const root = makeTmpDir();
      roots.push(root);

      const sliceRepo = new InMemorySliceRepository();
      const taskRepo = new InMemoryTaskRepository();
      const journalRepo = new InMemoryJournalRepository();

      const slice = makeSlice("M01-S01", "executing");
      sliceRepo.seed(slice);

      const tid1 = crypto.randomUUID();
      const tid2 = crypto.randomUUID();
      const tid3 = crypto.randomUUID();

      for (const taskId of [tid1, tid2, tid3]) {
        await journalRepo.append(slice.id, makeTaskCompletedEntry(slice.id, taskId));
      }

      const now = new Date();
      const t1 = Task.createNew({ id: tid1, sliceId: slice.id, label: "T01", title: "t1", now });
      t1.start(now);
      t1.complete(now);
      const t2 = Task.createNew({ id: tid2, sliceId: slice.id, label: "T02", title: "t2", now });
      t2.start(now);
      t2.complete(now);
      taskRepo.seed(t1);
      taskRepo.seed(t2);

      const service = makeService({ sliceRepo, taskRepo, journalRepo }, root);
      const result = await service.checkJournalDrift();

      expect(result.ok).toBe(true);
      expect(result.ok && result.data).toHaveLength(1);
      expect(result.ok && result.data[0].journalCompleted).toBe(3);
      expect(result.ok && result.data[0].sqliteCompleted).toBe(2);
    });

    it("returns no drift when counts match", async () => {
      const root = makeTmpDir();
      roots.push(root);

      const sliceRepo = new InMemorySliceRepository();
      const taskRepo = new InMemoryTaskRepository();
      const journalRepo = new InMemoryJournalRepository();

      const slice = makeSlice("M01-S01", "executing");
      sliceRepo.seed(slice);

      const tid1 = crypto.randomUUID();
      await journalRepo.append(slice.id, makeTaskCompletedEntry(slice.id, tid1));

      const now = new Date();
      const t1 = Task.createNew({ id: tid1, sliceId: slice.id, label: "T01", title: "t1", now });
      t1.start(now);
      t1.complete(now);
      taskRepo.seed(t1);

      const service = makeService({ sliceRepo, taskRepo, journalRepo }, root);
      const result = await service.checkJournalDrift();

      expect(result.ok).toBe(true);
      expect(result.ok && result.data).toHaveLength(0);
    });
  });

  describe("checkMissingArtifacts", () => {
    it("detects missing SPEC.md for researching slice", async () => {
      const root = makeTmpDir();
      roots.push(root);

      const sliceRepo = new InMemorySliceRepository();
      const artifactFile = new InMemoryArtifactFileAdapter();

      const slice = makeSlice("M01-S01", "researching");
      sliceRepo.seed(slice);
      // No SPEC.md written

      const service = makeService({ sliceRepo, artifactFile }, root);
      const result = await service.checkMissingArtifacts();

      expect(result.ok).toBe(true);
      expect(
        result.ok && result.data.some((w) => w.includes("M01-S01") && w.includes("SPEC.md")),
      ).toBe(true);
    });

    it("detects missing PLAN.md for executing slice", async () => {
      const root = makeTmpDir();
      roots.push(root);

      const sliceRepo = new InMemorySliceRepository();
      const artifactFile = new InMemoryArtifactFileAdapter();

      const slice = makeSlice("M01-S01", "executing");
      sliceRepo.seed(slice);

      // Write SPEC.md but not PLAN.md
      await artifactFile.write("M01", "M01-S01", "spec", "# Spec");

      const service = makeService({ sliceRepo, artifactFile }, root);
      const result = await service.checkMissingArtifacts();

      expect(result.ok).toBe(true);
      expect(
        result.ok && result.data.some((w) => w.includes("M01-S01") && w.includes("PLAN.md")),
      ).toBe(true);
      expect(result.ok && result.data.every((w) => !w.includes("SPEC.md"))).toBe(true);
    });

    it("S-tier quick slice does not require RESEARCH.md", async () => {
      const root = makeTmpDir();
      roots.push(root);

      const sliceRepo = new InMemorySliceRepository();
      const artifactFile = new InMemoryArtifactFileAdapter();

      // Quick slice in executing phase - only needs SPEC.md and PLAN.md
      const slice = makeSlice("Q-01", "executing", "quick");
      sliceRepo.seed(slice);

      // Write SPEC.md and PLAN.md, no RESEARCH.md
      await artifactFile.write(null, "Q-01", "spec", "# Spec", "quick");
      await artifactFile.write(null, "Q-01", "plan", "# Plan", "quick");

      const service = makeService({ sliceRepo, artifactFile }, root);
      const result = await service.checkMissingArtifacts();

      expect(result.ok).toBe(true);
      // No warnings about RESEARCH.md
      expect(result.ok && result.data.every((w) => !w.includes("RESEARCH.md"))).toBe(true);
    });

    it("returns empty when artifactFile not provided", async () => {
      const root = makeTmpDir();
      roots.push(root);

      const service = makeService({}, root);
      const result = await service.checkMissingArtifacts();

      expect(result.ok).toBe(true);
      expect(result.ok && result.data).toHaveLength(0);
    });
  });
});
