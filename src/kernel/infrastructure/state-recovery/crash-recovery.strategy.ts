import { existsSync } from "node:fs";
import { basename, join } from "node:path";

import { SyncError } from "@kernel/errors";
import { ok, type Result } from "@kernel/result";
import type { RecoveryStrategy } from "@kernel/ports/recovery-strategy";
import type { RecoveryReport, RecoveryScenario } from "@kernel/schemas/recovery.schemas";
import type { BackupService } from "@kernel/services/backup-service";
import type { RestoreStateUseCase } from "@kernel/services/restore-state.use-case";
import type { StateBranchOpsPort } from "@kernel/ports/state-branch-ops.port";
import { BranchMetaSchema } from "@kernel/schemas/branch-meta.schemas";

/**
 * Extracts the ISO timestamp from a backup directory name.
 * Backup names follow the pattern: .tff.backup.<timestamp>
 * where the timestamp has colons and dots replaced with hyphens,
 * e.g. .tff.backup.2024-01-15T10-00-00-000Z
 *
 * To compare, we reconstruct an ISO-sortable string by taking the
 * part after the last "backup." prefix. Since hyphens sort correctly
 * for ISO dates (YYYY-MM-DDTHH-MM-SS-mmmZ), lexicographic sort works.
 */
function backupTimestamp(backupPath: string): string {
  const name = basename(backupPath);
  // name is like: .tff.backup.2024-01-15T10-00-00-000Z
  const prefix = ".tff.backup.";
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

function sortBackupsNewestFirst(backupPaths: string[]): string[] {
  return [...backupPaths].sort((a, b) =>
    backupTimestamp(b).localeCompare(backupTimestamp(a)),
  );
}

export class CrashRecoveryStrategy implements RecoveryStrategy {
  readonly handles = "crash" as const;

  constructor(
    private readonly backupService: BackupService,
    private readonly stateBranchOps: StateBranchOpsPort,
    private readonly restoreUseCase: RestoreStateUseCase,
  ) {}

  async execute(
    scenario: RecoveryScenario,
    tffDir: string,
  ): Promise<Result<RecoveryReport, SyncError>> {
    const sorted = sortBackupsNewestFirst(scenario.backupPaths);
    const newestBackup = sorted[0];

    // Try to read lastSyncedAt from state branch if it exists
    let stateBranchSyncedAt: Date | null = null;
    if (scenario.stateBranchExists && scenario.currentBranch) {
      const stateBranch = `tff-state/${scenario.currentBranch}`;
      const readResult = await this.stateBranchOps.readFromStateBranch(
        stateBranch,
        "branch-meta.json",
      );
      if (readResult.ok && readResult.data) {
        try {
          const raw = JSON.parse(readResult.data);
          const meta = BranchMetaSchema.parse(raw);
          if (meta.lastSyncedAt) {
            stateBranchSyncedAt = new Date(meta.lastSyncedAt);
          }
        } catch {
          // Ignore parse errors — treat as no state branch data
        }
      }
    }

    // Determine whether to prefer backup or state branch
    const backupTs = backupTimestamp(newestBackup);
    const useStateBranch =
      stateBranchSyncedAt !== null &&
      scenario.currentBranch !== null &&
      stateBranchSyncedAt.toISOString().replace(/[:.]/g, "-") > backupTs;

    if (useStateBranch) {
      // Restore via RestoreStateUseCase (state branch is newer)
      const restoreResult = await this.restoreUseCase.execute(scenario.currentBranch!);
      if (!restoreResult.ok) {
        return ok(this.degradationReport(restoreResult.error.message));
      }

      const metaPath = join(tffDir, "branch-meta.json");
      if (!existsSync(metaPath)) {
        return ok(this.degradationReport("branch-meta.json missing after state branch restore"));
      }

      return ok({
        type: "crash",
        action: "restored",
        source: `tff-state/${scenario.currentBranch!}`,
        filesRestored: restoreResult.data.filesRestored,
        warnings: [],
      });
    }

    // Restore from backup
    try {
      this.backupService.restoreFromBackup(newestBackup, tffDir);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return ok(this.degradationReport(`backup restore failed: ${message}`));
    }

    const metaPath = join(tffDir, "branch-meta.json");
    if (!existsSync(metaPath)) {
      return ok(this.degradationReport("branch-meta.json missing after backup restore"));
    }

    return ok({
      type: "crash",
      action: "restored",
      source: newestBackup,
      filesRestored: 0,
      warnings: [],
    });
  }

  private degradationReport(warning: string): RecoveryReport {
    return {
      type: "crash",
      action: "created-fresh",
      source: "none",
      filesRestored: 0,
      warnings: [warning],
    };
  }
}
