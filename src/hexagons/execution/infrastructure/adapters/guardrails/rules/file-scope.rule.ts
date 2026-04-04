import type { EnrichedGuardrailContext } from "../../../../domain/enriched-guardrail-context";
import type { GuardrailViolation } from "../../../../domain/guardrail.schemas";
import type { GuardrailRule } from "../../../../domain/guardrail-rule";

export class FileScopeRule implements GuardrailRule {
  readonly id = "file-scope" as const;

  evaluate(context: EnrichedGuardrailContext): GuardrailViolation[] {
    if (context.taskFilePaths.length === 0) return [];
    const outOfScope = context.filesChanged.filter((f) => !context.taskFilePaths.includes(f));
    return outOfScope.map((filePath) => ({
      ruleId: this.id,
      severity: "warning" as const,
      filePath,
      message: `File outside declared task scope: ${filePath}`,
    }));
  }
}
