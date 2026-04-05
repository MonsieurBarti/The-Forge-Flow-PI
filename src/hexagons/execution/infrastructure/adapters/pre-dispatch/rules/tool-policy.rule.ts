import type { ToolPoliciesConfig, ToolPolicyEntry } from "@hexagons/settings";

import type {
  PreDispatchContext,
  PreDispatchViolation,
} from "../../../../domain/pre-dispatch.schemas";
import type { PreDispatchGuardrailRule } from "../../../../domain/pre-dispatch-guardrail-rule";

export class ToolPolicyRule implements PreDispatchGuardrailRule {
  readonly id = "tool-policy";

  constructor(
    private readonly config: ToolPoliciesConfig = { defaults: {}, byTier: {}, byRole: {} },
  ) {}

  async evaluate(context: PreDispatchContext): Promise<PreDispatchViolation[]> {
    const effective = this.resolveEffectivePolicy(context);

    const blocked = effective.blocked ?? [];
    const allowed = effective.allowed;

    const violations: PreDispatchViolation[] = [];
    for (const tool of context.agentTools) {
      if (blocked.includes(tool)) {
        violations.push({
          ruleId: this.id,
          severity: "blocker",
          message: `Tool "${tool}" is blocked by policy`,
        });
      } else if (allowed && !allowed.includes(tool)) {
        violations.push({
          ruleId: this.id,
          severity: "blocker",
          message: `Tool "${tool}" is not in the allowed list`,
        });
      }
    }
    return violations;
  }

  private resolveEffectivePolicy(context: PreDispatchContext): ToolPolicyEntry {
    const layers: ToolPolicyEntry[] = [this.config.defaults];

    if (context.complexityTier) {
      const tierPolicy = this.config.byTier?.[context.complexityTier];
      if (tierPolicy) layers.push(tierPolicy);
    }

    if (context.agentRole) {
      const rolePolicy = this.config.byRole?.[context.agentRole];
      if (rolePolicy) layers.push(rolePolicy);
    }

    return this.mergeLayers(layers);
  }

  private mergeLayers(layers: ToolPolicyEntry[]): ToolPolicyEntry {
    let blocked: string[] = [];
    let allowed: string[] | undefined;

    for (const layer of layers) {
      if (layer.blocked?.length) {
        blocked = [...new Set([...blocked, ...layer.blocked])];
      }
      if (layer.allowed) {
        allowed = layer.allowed;
      }
    }

    return { blocked: blocked.length > 0 ? blocked : undefined, allowed };
  }
}
