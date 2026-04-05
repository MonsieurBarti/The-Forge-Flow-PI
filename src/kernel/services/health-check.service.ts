import { appendFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { GitPort } from "@kernel/ports/git.port";
import type { GitHookPort } from "@kernel/ports/git-hook.port";
import type { StateBranchOpsPort } from "@kernel/ports/state-branch-ops.port";
import type { Result } from "@kernel/result";
import { err, ok } from "@kernel/result";

export interface HealthCheckDeps {
  gitHookPort: GitHookPort;
  stateBranchOps: StateBranchOpsPort;
  gitPort: GitPort;
  hookScriptContent: string;
  projectRoot: string;
}

export interface HealthCheckReport {
  fixed: string[];
  warnings: string[];
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

  async runAll(tffDir: string): Promise<Result<HealthCheckReport, Error>> {
    const report: HealthCheckReport = { fixed: [], warnings: [] };

    const hookResult = await this.ensurePostCheckoutHook();
    if (hookResult.ok && hookResult.data) report.fixed.push(hookResult.data);

    const gitignoreResult = await this.ensureGitignore();
    if (gitignoreResult.ok && gitignoreResult.data) report.fixed.push(gitignoreResult.data);

    const lockResult = this.cleanStaleLocks(tffDir);
    if (lockResult.ok && lockResult.data) report.fixed.push(lockResult.data);

    const orphanResult = await this.checkOrphanedState(tffDir);
    if (orphanResult.ok) report.warnings.push(...orphanResult.data);

    return ok(report);
  }
}
