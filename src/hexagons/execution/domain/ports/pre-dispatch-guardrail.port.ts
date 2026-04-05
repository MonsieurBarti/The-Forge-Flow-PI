import type { Result } from "@kernel";
import type { GuardrailError } from "../errors/guardrail.error";
import type { PreDispatchContext, PreDispatchReport } from "../pre-dispatch.schemas";

export abstract class PreDispatchGuardrailPort {
  abstract validate(
    context: PreDispatchContext,
  ): Promise<Result<PreDispatchReport, GuardrailError>>;
}
