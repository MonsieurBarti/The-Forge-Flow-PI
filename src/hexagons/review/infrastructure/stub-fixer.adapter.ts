import { ok, type Result } from "@kernel";
import type { FixerError } from "../domain/errors/fixer.error";
import { FixerPort, type FixRequest, type FixResult } from "../domain/ports/fixer.port";

export class StubFixerAdapter extends FixerPort {
  async fix(request: FixRequest): Promise<Result<FixResult, FixerError>> {
    return ok({
      fixed: [],
      deferred: [...request.findings],
      testsPassing: true,
    });
  }
}
