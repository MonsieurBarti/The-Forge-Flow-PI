import type { SyncError } from "@kernel/errors/sync.error";
import type { LoggerPort } from "@kernel/ports/logger.port";
import type { StateRecoveryPort } from "@kernel/ports/state-recovery.port";
import type { Result } from "@kernel/result";
import { err, ok } from "@kernel/result";
import type { HealthCheckService } from "./health-check.service";

export class StateGuard {
  constructor(
    private readonly recoveryPort: StateRecoveryPort,
    private readonly healthCheck: HealthCheckService,
    private readonly logger: LoggerPort,
  ) {}

  async ensure(tffDir: string): Promise<Result<void, SyncError>> {
    // 1. Run health checks (non-blocking — continue even if some fail)
    await this.healthCheck.runAll(tffDir);

    // 2. Detect recovery scenario
    const detectResult = await this.recoveryPort.detect(tffDir);
    if (!detectResult.ok) return detectResult;

    const scenario = detectResult.data;

    // 3. If healthy or untracked → return ok immediately (idempotent, zero fs writes)
    if (scenario.type === "healthy" || scenario.type === "untracked") {
      return ok(undefined);
    }

    // 4. Recover
    const recoverResult = await this.recoveryPort.recover(scenario, tffDir);
    if (!recoverResult.ok) return err(recoverResult.error);

    // 5. Log action
    const report = recoverResult.data;
    this.logger.info(
      `[tff] State recovered: ${report.type} → ${report.action} (source: ${report.source})`,
    );

    return ok(undefined);
  }
}
