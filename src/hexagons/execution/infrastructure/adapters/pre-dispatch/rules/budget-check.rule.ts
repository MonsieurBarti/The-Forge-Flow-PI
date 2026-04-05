import type {
  PreDispatchContext,
  PreDispatchViolation,
} from "../../../../domain/pre-dispatch.schemas";
import type { PreDispatchGuardrailRule } from "../../../../domain/pre-dispatch-guardrail-rule";

export class BudgetCheckRule implements PreDispatchGuardrailRule {
  readonly id = "budget-check";

  async evaluate(context: PreDispatchContext): Promise<PreDispatchViolation[]> {
    if (context.budgetRemaining === undefined || context.budgetEstimated === undefined) {
      return [];
    }
    if (context.budgetRemaining < context.budgetEstimated) {
      return [
        {
          ruleId: this.id,
          severity: "warning",
          message: `Budget may be insufficient: ${context.budgetRemaining} remaining, ${context.budgetEstimated} estimated`,
        },
      ];
    }
    return [];
  }
}
