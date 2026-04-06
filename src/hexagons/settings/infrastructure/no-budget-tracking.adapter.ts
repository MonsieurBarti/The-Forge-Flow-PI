import { ok, type Result } from "@kernel";
import { BudgetTrackingPort } from "../domain/ports/budget-tracking.port";

export class NoBudgetTrackingAdapter extends BudgetTrackingPort {
  private warned = false;

  async getUsagePercent(): Promise<Result<number, never>> {
    if (!this.warned) {
      this.warned = true;
      console.warn("[tff] Budget tracking not configured — model selection uses defaults");
    }
    return ok(0);
  }
}
