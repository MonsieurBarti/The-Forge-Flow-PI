import type { SyncError } from '@kernel/errors';
import type { Result } from '@kernel/result';
import type { RecoveryScenario, RecoveryReport } from '@kernel/schemas/recovery.schemas';

export abstract class StateRecoveryPort {
  abstract detect(tffDir: string): Promise<Result<RecoveryScenario, SyncError>>;
  abstract recover(
    scenario: RecoveryScenario,
    tffDir: string,
  ): Promise<Result<RecoveryReport, SyncError>>;
}
