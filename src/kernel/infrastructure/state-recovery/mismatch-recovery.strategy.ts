import { SyncError } from "@kernel/errors";
import type { RecoveryStrategy } from "@kernel/ports/recovery-strategy";
import type { Result } from "@kernel/result";
import { err, ok } from "@kernel/result";
import type { RecoveryReport, RecoveryScenario } from "@kernel/schemas/recovery.schemas";
import type { RestoreStateUseCase } from "@kernel/services/restore-state.use-case";

export class MismatchRecoveryStrategy implements RecoveryStrategy {
  readonly handles = "mismatch" as const;

  constructor(private readonly restoreUseCase: RestoreStateUseCase) {}

  async execute(
    scenario: RecoveryScenario,
    _tffDir: string,
  ): Promise<Result<RecoveryReport, SyncError>> {
    if (!scenario.currentBranch) {
      return err(new SyncError("RECOVERY_FAILED", "currentBranch is null in mismatch recovery"));
    }
    const branch = scenario.currentBranch;
    const source = `tff-state/${branch}`;

    const restoreResult = await this.restoreUseCase.execute(branch);

    if (restoreResult.ok) {
      return ok({
        type: "mismatch",
        action: "restored",
        source,
        filesRestored: restoreResult.data.filesRestored,
        warnings: [],
      });
    }

    const code = restoreResult.error.code;
    if (code === "SYNC.LOCK_CONTENTION" || code === "SYNC.BRANCH_NOT_FOUND") {
      return ok({
        type: "mismatch",
        action: "skipped",
        source,
        filesRestored: 0,
        warnings: [],
      });
    }

    return err(new SyncError("RESTORE_FAILED", restoreResult.error.message));
  }
}
