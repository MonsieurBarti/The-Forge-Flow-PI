import { ok, err } from '@kernel/result';
import { SyncError } from '@kernel/errors';
import type { Result } from '@kernel/result';
import type { RecoveryStrategy } from '@kernel/ports/recovery-strategy';
import type { RecoveryScenario, RecoveryReport } from '@kernel/schemas/recovery.schemas';
import type { RestoreStateUseCase } from '@kernel/services/restore-state.use-case';

export class MismatchRecoveryStrategy implements RecoveryStrategy {
  readonly handles = 'mismatch' as const;

  constructor(private readonly restoreUseCase: RestoreStateUseCase) {}

  async execute(
    scenario: RecoveryScenario,
    _tffDir: string,
  ): Promise<Result<RecoveryReport, SyncError>> {
    const branch = scenario.currentBranch!;
    const source = `tff-state/${branch}`;

    const restoreResult = await this.restoreUseCase.execute(branch);

    if (restoreResult.ok) {
      return ok({
        type: 'mismatch',
        action: 'restored',
        source,
        filesRestored: restoreResult.data.filesRestored,
        warnings: [],
      });
    }

    const code = restoreResult.error.code;
    if (code === 'SYNC.LOCK_CONTENTION' || code === 'SYNC.BRANCH_NOT_FOUND') {
      return ok({
        type: 'mismatch',
        action: 'skipped',
        source,
        filesRestored: 0,
        warnings: [],
      });
    }

    return err(new SyncError('RESTORE_FAILED', restoreResult.error.message));
  }
}
