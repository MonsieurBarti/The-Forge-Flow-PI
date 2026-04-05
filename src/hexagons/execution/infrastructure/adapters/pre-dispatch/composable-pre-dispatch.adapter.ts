import { ok, type Result } from "@kernel";
import type { GuardrailError } from "../../../domain/errors/guardrail.error";
import { PreDispatchGuardrailPort } from "../../../domain/ports/pre-dispatch-guardrail.port";
import type {
  PreDispatchContext,
  PreDispatchReport,
  PreDispatchViolation,
} from "../../../domain/pre-dispatch.schemas";
import type { PreDispatchGuardrailRule } from "../../../domain/pre-dispatch-guardrail-rule";

export class ComposablePreDispatchAdapter extends PreDispatchGuardrailPort {
  constructor(private readonly rules: PreDispatchGuardrailRule[]) {
    super();
  }

  async validate(context: PreDispatchContext): Promise<Result<PreDispatchReport, GuardrailError>> {
    const allViolations: PreDispatchViolation[] = [];

    const results = await Promise.all(this.rules.map((rule) => rule.evaluate(context)));

    for (const violations of results) {
      allViolations.push(...violations);
    }

    const passed = !allViolations.some((v) => v.severity === "blocker");

    return ok({
      passed,
      violations: allViolations,
      checkedAt: new Date().toISOString(),
    });
  }
}
