import type { PreDispatchGuardrailRule } from "../../../../domain/pre-dispatch-guardrail-rule";
import type { PreDispatchContext, PreDispatchViolation } from "../../../../domain/pre-dispatch.schemas";

export class DependencyCheckRule implements PreDispatchGuardrailRule {
  readonly id = "dependency-check";

  async evaluate(context: PreDispatchContext): Promise<PreDispatchViolation[]> {
    const violations: PreDispatchViolation[] = [];
    for (const upstream of context.upstreamTasks) {
      if (upstream.status !== "completed") {
        violations.push({
          ruleId: this.id,
          severity: "blocker",
          message: `Upstream task ${upstream.id} not completed (status: ${upstream.status})`,
        });
      }
    }
    return violations;
  }
}
