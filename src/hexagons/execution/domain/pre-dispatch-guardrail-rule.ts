import type { PreDispatchContext, PreDispatchViolation } from "./pre-dispatch.schemas";

export interface PreDispatchGuardrailRule {
  readonly id: string;
  evaluate(context: PreDispatchContext): Promise<PreDispatchViolation[]>;
}
