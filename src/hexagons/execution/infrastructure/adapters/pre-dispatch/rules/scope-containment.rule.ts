import type { PreDispatchGuardrailRule } from "../../../../domain/pre-dispatch-guardrail-rule";
import type { PreDispatchContext, PreDispatchViolation } from "../../../../domain/pre-dispatch.schemas";

export class ScopeContainmentRule implements PreDispatchGuardrailRule {
  readonly id = "scope-containment";

  async evaluate(context: PreDispatchContext): Promise<PreDispatchViolation[]> {
    const violations: PreDispatchViolation[] = [];
    for (const filePath of context.taskFilePaths) {
      if (!context.sliceFilePaths.includes(filePath)) {
        violations.push({
          ruleId: this.id,
          severity: "blocker",
          message: `File outside slice scope: ${filePath}`,
        });
      }
    }
    return violations;
  }
}
