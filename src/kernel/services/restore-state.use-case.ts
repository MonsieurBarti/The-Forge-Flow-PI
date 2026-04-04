import type { StateSyncPort } from "@kernel/ports/state-sync.port";
import type { GitPort } from "@kernel/ports/git.port";
import type { StateExporter } from "@kernel/services/state-exporter";
import type { BackupService } from "./backup-service";
import { BranchMetaSchema, type BranchMeta } from "@kernel/infrastructure/state-branch/state-snapshot.schemas";

/** Structural interface for lock acquisition — avoids importing infrastructure AdvisoryLock */
export interface LockAcquirer {
  acquire(lockPath: string, timeoutMs?: number): Result<() => void, SyncError>;
}
import { computeStateHash } from "./canonical-hash";
import { SyncError } from "@kernel/errors";
import { err, ok, type Result } from "@kernel/result";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface RestoreReport {
  previousBranch: string | null;
  restoredBranch: string;
  dirtySaved: boolean;
  backupPath: string;
  filesRestored: number;
  backupsCleaned: number;
}

export interface RestoreStateUseCaseDeps {
  stateSync: StateSyncPort;
  gitPort: GitPort;
  advisoryLock: LockAcquirer;
  stateExporter: StateExporter;
  backupService: BackupService;
  tffDir: string;
}

export class RestoreStateUseCase {
  constructor(private readonly deps: RestoreStateUseCaseDeps) {}

  async execute(targetCodeBranch: string): Promise<Result<RestoreReport, SyncError>> {
    const { stateSync, advisoryLock, stateExporter, backupService, tffDir } = this.deps;
    const lockPath = join(tffDir, ".lock");
    const metaPath = join(tffDir, "branch-meta.json");
    const projectRoot = join(tffDir, "..");

    // 1. Acquire lock
    const lockResult = advisoryLock.acquire(lockPath);
    if (!lockResult.ok) return lockResult;
    const release = lockResult.data;
    const lockToken = () => {}; // no-op signal — this use case holds the real lock

    try {
      // 2. Read branch-meta → previousBranch
      let previousBranch: string | null = null;
      let meta: BranchMeta | null = null;
      if (existsSync(metaPath)) {
        const raw = JSON.parse(readFileSync(metaPath, "utf-8"));
        meta = BranchMetaSchema.parse(raw);
        previousBranch = meta.codeBranch;
      }

      // 3. Dirty check: export → hash → compare to lastSyncedHash
      let dirtySaved = false;
      if (meta && previousBranch) {
        const exportResult = await stateExporter.export();
        if (exportResult.ok) {
          const currentHash = computeStateHash(exportResult.data);
          if (meta.lastSyncedHash !== currentHash) {
            const syncResult = await stateSync.syncToStateBranch(
              previousBranch, tffDir, { lockToken },
            );
            dirtySaved = syncResult.ok;
            // If dirty save fails, proceed — backup is safety net
          }
        }
      }

      // 4. Backup .tff/
      const backupPath = backupService.createBackup(tffDir);

      // 5. Clear .tff/ (preserve worktrees/, .lock)
      backupService.clearTffDir(tffDir);

      // 6. Restore from target state branch
      const restoreResult = await stateSync.restoreFromStateBranch(
        targetCodeBranch, tffDir, { lockToken },
      );
      if (!restoreResult.ok) {
        return err(new SyncError(
          "RESTORE_FAILED",
          `Restore from tff-state/${targetCodeBranch} failed: ${restoreResult.error.message}`,
        ));
      }

      // 7. Journal catch-up
      // S02's restoreFromStateBranch() does full-snapshot import (StateImporter.import)
      // which replaces all DB state. The snapshot IS the full state, so journal replay
      // on top of a full import is a no-op. AC6 idempotency is satisfied because
      // StateImporter.import() clears + re-inserts.
      const filesRestored = restoreResult.data.pulled;

      // 8. Update branch-meta.json
      const exportAfter = await stateExporter.export();
      const newHash = exportAfter.ok ? computeStateHash(exportAfter.data) : null;
      const restoredMeta: BranchMeta = {
        version: 1,
        stateId: meta?.stateId ?? crypto.randomUUID(),
        codeBranch: targetCodeBranch,
        stateBranch: `tff-state/${targetCodeBranch}`,
        parentStateBranch: meta?.parentStateBranch ?? null,
        lastSyncedAt: new Date(),
        lastJournalOffset: 0,
        dirty: false,
        lastSyncedHash: newHash,
      };
      writeFileSync(metaPath, JSON.stringify(restoredMeta, null, 2));

      // 9. Clean old backups (keep last 3)
      const backupsCleaned = backupService.cleanOldBackups(projectRoot, 3);

      // 10. Release lock (in finally)
      return ok({
        previousBranch,
        restoredBranch: targetCodeBranch,
        dirtySaved,
        backupPath,
        filesRestored,
        backupsCleaned,
      });
    } finally {
      release();
    }
  }
}
