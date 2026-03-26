import { ok, type Result } from "@kernel";
import { BudgetTrackingPort } from "../domain/ports/budget-tracking.port";

export class AlwaysUnderBudgetAdapter extends BudgetTrackingPort {
  async getUsagePercent(): Promise<Result<number, never>> {
    return ok(0);
  }
}
