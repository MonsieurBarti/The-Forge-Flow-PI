import type { Result } from "@kernel";
import type { GuardrailError } from "../errors/guardrail.error";
import type { GuardrailContext, GuardrailValidationReport } from "../guardrail.schemas";

export abstract class OutputGuardrailPort {
  abstract validate(
    context: GuardrailContext,
  ): Promise<Result<GuardrailValidationReport, GuardrailError>>;
}
