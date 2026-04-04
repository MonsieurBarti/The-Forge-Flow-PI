import { ok, type Result } from "@kernel";
import type { GuardrailError } from "../../../domain/errors/guardrail.error";
import type { GuardrailContext, GuardrailValidationReport } from "../../../domain/guardrail.schemas";
import { OutputGuardrailPort } from "../../../domain/ports/output-guardrail.port";

const CLEAN_REPORT: GuardrailValidationReport = {
  violations: [],
  passed: true,
  summary: "0 violations",
};

export class InMemoryGuardrailAdapter extends OutputGuardrailPort {
  private _report: GuardrailValidationReport = CLEAN_REPORT;
  private readonly _validated: GuardrailContext[] = [];

  givenReport(report: GuardrailValidationReport): void {
    this._report = report;
  }

  get validatedContexts(): readonly GuardrailContext[] {
    return this._validated;
  }

  wasValidated(): boolean {
    return this._validated.length > 0;
  }

  reset(): void {
    this._report = CLEAN_REPORT;
    this._validated.length = 0;
  }

  async validate(
    context: GuardrailContext,
  ): Promise<Result<GuardrailValidationReport, GuardrailError>> {
    this._validated.push(context);
    return ok(this._report);
  }
}
