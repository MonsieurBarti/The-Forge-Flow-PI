import { ok, type Result } from "@kernel";
import type { GuardrailError } from "../../../domain/errors/guardrail.error";
import { PreDispatchGuardrailPort } from "../../../domain/ports/pre-dispatch-guardrail.port";
import type { PreDispatchContext, PreDispatchReport } from "../../../domain/pre-dispatch.schemas";

export class InMemoryPreDispatchAdapter extends PreDispatchGuardrailPort {
  private report: PreDispatchReport = {
    passed: true,
    violations: [],
    checkedAt: new Date().toISOString(),
  };

  setReport(report: PreDispatchReport): void {
    this.report = report;
  }

  async validate(_context: PreDispatchContext): Promise<Result<PreDispatchReport, GuardrailError>> {
    return ok(this.report);
  }
}
