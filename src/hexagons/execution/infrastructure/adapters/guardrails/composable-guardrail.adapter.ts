import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, type Result } from "@kernel";
import type { GitPort } from "@kernel/ports/git.port";
import type { EnrichedGuardrailContext } from "../../../domain/enriched-guardrail-context";
import { GuardrailError } from "../../../domain/errors/guardrail.error";
import type {
  GuardrailContext,
  GuardrailSeverity,
  GuardrailValidationReport,
  GuardrailViolation,
} from "../../../domain/guardrail.schemas";
import type { GuardrailRule } from "../../../domain/guardrail-rule";
import { OutputGuardrailPort } from "../../../domain/ports/output-guardrail.port";
import { shouldSkipContent, shouldSkipFile } from "./rules/skip-filter";

export class ComposableGuardrailAdapter extends OutputGuardrailPort {
  constructor(
    private readonly rules: GuardrailRule[],
    private readonly severityOverrides: ReadonlyMap<string, GuardrailSeverity>,
    private readonly gitPort: GitPort,
  ) {
    super();
  }

  async validate(
    context: GuardrailContext,
  ): Promise<Result<GuardrailValidationReport, GuardrailError>> {
    // 1. Discover changed files via git diff
    const diffResult = await this.gitPort.diffNameOnly(context.workingDirectory);
    if (!diffResult.ok)
      return err(GuardrailError.diffFailed(context.workingDirectory, diffResult.error));
    const changedFiles = diffResult.data;

    // 2. Read file contents (skip filtered files and large files)
    const fileContents = new Map<string, string>();
    for (const filePath of changedFiles) {
      if (shouldSkipFile(filePath)) continue;
      try {
        const content = await readFile(join(context.workingDirectory, filePath), "utf-8");
        if (!shouldSkipContent(content)) {
          fileContents.set(filePath, content);
        }
      } catch {
        // File may have been deleted — skip
      }
    }

    // 3. Get unified diff
    const gitDiffResult = await this.gitPort.diff(context.workingDirectory);
    const gitDiff = gitDiffResult.ok ? gitDiffResult.data : "";

    // 4. Build enriched context
    const enriched: EnrichedGuardrailContext = {
      ...context,
      filesChanged: changedFiles,
      fileContents,
      gitDiff,
    };

    // 5. Run rules + collect violations
    const violations: GuardrailViolation[] = [];
    for (const rule of this.rules) {
      const ruleViolations = rule.evaluate(enriched);
      for (const v of ruleViolations) {
        const overrideSeverity = this.severityOverrides.get(v.ruleId);
        violations.push(overrideSeverity ? { ...v, severity: overrideSeverity } : v);
      }
    }

    // 6. Build report
    const errorCount = violations.filter((v) => v.severity === "error").length;
    const warnCount = violations.filter((v) => v.severity === "warning").length;
    const infoCount = violations.filter((v) => v.severity === "info").length;
    const parts: string[] = [];
    if (errorCount > 0) parts.push(`${errorCount} error${errorCount > 1 ? "s" : ""}`);
    if (warnCount > 0) parts.push(`${warnCount} warning${warnCount > 1 ? "s" : ""}`);
    if (infoCount > 0) parts.push(`${infoCount} info`);

    return ok({
      violations,
      passed: errorCount === 0,
      summary: parts.length > 0 ? parts.join(", ") : "0 violations",
    });
  }
}
