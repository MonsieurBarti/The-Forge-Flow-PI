import type { Result } from "@kernel";

export abstract class BudgetTrackingPort {
  abstract getUsagePercent(): Promise<Result<number, never>>;
}
