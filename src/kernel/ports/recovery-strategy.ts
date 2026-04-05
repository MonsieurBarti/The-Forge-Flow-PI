import type { SyncError } from "@kernel/errors";
import type { Result } from "@kernel/result";
import type {
  RecoveryReport,
  RecoveryScenario,
  RecoveryType,
} from "@kernel/schemas/recovery.schemas";

export interface RecoveryStrategy {
  readonly handles: RecoveryType;
  execute(scenario: RecoveryScenario, tffDir: string): Promise<Result<RecoveryReport, SyncError>>;
}
