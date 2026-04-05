import type { SyncError } from "@kernel/errors";
import type { Result } from "@kernel/result";
import type { RecoveryReport, RecoveryScenario } from "@kernel/schemas/recovery.schemas";

export abstract class StateRecoveryPort {
  abstract detect(tffDir: string): Promise<Result<RecoveryScenario, SyncError>>;
  abstract recover(
    scenario: RecoveryScenario,
    tffDir: string,
  ): Promise<Result<RecoveryReport, SyncError>>;
}
