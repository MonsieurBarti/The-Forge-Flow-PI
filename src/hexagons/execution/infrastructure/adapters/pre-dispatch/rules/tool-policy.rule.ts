import type { PreDispatchGuardrailRule } from "../../../../domain/pre-dispatch-guardrail-rule";
import type { PreDispatchContext, PreDispatchViolation } from "../../../../domain/pre-dispatch.schemas";

export class ToolPolicyRule implements PreDispatchGuardrailRule {
  readonly id = "tool-policy";

  constructor(
    private readonly allowedTools: ReadonlyMap<string, readonly string[]> = new Map(),
  ) {}

  async evaluate(context: PreDispatchContext): Promise<PreDispatchViolation[]> {
    const allowed = this.allowedTools.get(context.agentModel);
    if (!allowed) return [];

    const violations: PreDispatchViolation[] = [];
    for (const tool of context.agentTools) {
      if (!allowed.includes(tool)) {
        violations.push({
          ruleId: this.id,
          severity: "blocker",
          message: `Tool "${tool}" not allowed for agent model "${context.agentModel}"`,
        });
      }
    }
    return violations;
  }
}
