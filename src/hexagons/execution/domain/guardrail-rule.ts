import type { EnrichedGuardrailContext } from "./enriched-guardrail-context";
import type { GuardrailRuleId, GuardrailViolation } from "./guardrail.schemas";

export interface GuardrailRule {
  readonly id: GuardrailRuleId;
  evaluate(context: EnrichedGuardrailContext): GuardrailViolation[];
}
