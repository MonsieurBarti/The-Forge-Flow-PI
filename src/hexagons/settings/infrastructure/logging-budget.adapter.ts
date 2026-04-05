import { ok, type Result } from "@kernel";
import type { LoggerPort } from "@kernel/ports/logger.port";
import { BudgetTrackingPort } from "../domain/ports/budget-tracking.port";

export class LoggingBudgetAdapter extends BudgetTrackingPort {
  private warned = false;

  constructor(private readonly logger: LoggerPort) {
    super();
  }

  async getUsagePercent(): Promise<Result<number, never>> {
    if (!this.warned) {
      this.logger.warn("Budget tracking not configured — using unlimited budget");
      this.warned = true;
    }
    return ok(0);
  }
}
