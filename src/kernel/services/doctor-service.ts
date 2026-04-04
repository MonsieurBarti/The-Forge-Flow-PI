import type { GitHookPort } from "@kernel/ports/git-hook.port";
import type { StateBranchOpsPort } from "@kernel/ports/state-branch-ops.port";
import type { GitPort } from "@kernel/ports/git.port";
import type { BackupService } from "./backup-service";
import { existsSync, readFileSync, readdirSync, unlinkSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export interface DiagnosticReport {
  fixed: string[];
  warnings: string[];
}

export interface DoctorServiceDeps {
  gitHookPort: GitHookPort;
  stateBranchOps: StateBranchOpsPort;
  gitPort: GitPort;
  backupService: BackupService;
  hookScriptContent: string;
  projectRoot: string;
}

export class DoctorService {
  constructor(private readonly deps: DoctorServiceDeps) {}

  async diagnoseAndFix(tffDir: string): Promise<DiagnosticReport> {
    const report: DiagnosticReport = { fixed: [], warnings: [] };

    // Check 1: Crash recovery — backup exists + branch-meta missing
    this.checkCrashRecovery(tffDir, report);

    // Check 2: Post-checkout hook missing
    await this.checkHook(report);

    // Check 3: branch-meta missing but state branch exists
    await this.checkOrphanedState(tffDir, report);

    // Check 4: .gitignore missing entries
    this.checkGitignore(report);

    // Check 5: Stale lock
    this.checkStaleLock(tffDir, report);

    return report;
  }

  private checkCrashRecovery(tffDir: string, report: DiagnosticReport): void {
    const projectRoot = this.deps.projectRoot;
    const metaPath = join(tffDir, "branch-meta.json");
    if (existsSync(metaPath)) return;

    const backups = readdirSync(projectRoot)
      .filter((e) => e.startsWith(".tff.backup."))
      .sort()
      .reverse();

    if (backups.length === 0) return;

    const newestBackup = join(projectRoot, backups[0]);
    this.deps.backupService.restoreFromBackup(newestBackup, tffDir);
    report.fixed.push(`Crash recovery: restored from ${backups[0]}`);
  }

  private async checkHook(report: DiagnosticReport): Promise<void> {
    const result = await this.deps.gitHookPort.isPostCheckoutHookInstalled();
    if (!result.ok || result.data) return;

    const installResult = await this.deps.gitHookPort.installPostCheckoutHook(
      this.deps.hookScriptContent,
    );
    if (installResult.ok) {
      report.fixed.push("Post-checkout hook installed");
    }
  }

  private async checkOrphanedState(tffDir: string, report: DiagnosticReport): Promise<void> {
    const metaPath = join(tffDir, "branch-meta.json");
    if (existsSync(metaPath)) return;

    const branchResult = await this.deps.gitPort.currentBranch();
    if (!branchResult.ok || branchResult.data === null) return;

    const stateBranch = `tff-state/${branchResult.data}`;
    const existsResult = await this.deps.stateBranchOps.branchExists(stateBranch);
    if (existsResult.ok && existsResult.data) {
      report.warnings.push(
        `State branch ${stateBranch} exists but no branch-meta.json — restore needed`,
      );
    }
  }

  private checkGitignore(report: DiagnosticReport): void {
    const gitignorePath = join(this.deps.projectRoot, ".gitignore");
    if (!existsSync(gitignorePath)) return;

    const content = readFileSync(gitignorePath, "utf-8");
    const lines = content.split("\n");
    const missing: string[] = [];

    if (!lines.some((l) => l.trim() === ".tff/")) missing.push(".tff/");
    if (!lines.some((l) => l.trim() === ".tff.backup.*")) missing.push(".tff.backup.*");

    if (missing.length > 0) {
      const suffix = (content.endsWith("\n") ? "" : "\n") + missing.join("\n") + "\n";
      appendFileSync(gitignorePath, suffix);
      report.fixed.push(`.gitignore: added ${missing.join(", ")}`);
    }
  }

  private checkStaleLock(tffDir: string, report: DiagnosticReport): void {
    const lockPath = join(tffDir, ".lock");
    if (!existsSync(lockPath)) return;

    try {
      const raw = JSON.parse(readFileSync(lockPath, "utf-8"));
      const pid = raw.pid as number;
      const acquiredAt = new Date(raw.acquiredAt as string);

      try {
        process.kill(pid, 0);
        const ageMs = Date.now() - acquiredAt.getTime();
        if (ageMs > 5 * 60 * 1000) {
          unlinkSync(lockPath);
          report.fixed.push(`Stale lock removed (age: ${Math.round(ageMs / 1000)}s, PID ${pid})`);
        }
      } catch {
        unlinkSync(lockPath);
        report.fixed.push(`Stale lock removed (dead PID ${pid})`);
      }
    } catch {
      unlinkSync(lockPath);
      report.fixed.push("Stale lock removed (malformed)");
    }
  }
}
