import type { EnrichedGuardrailContext } from "../../../../domain/enriched-guardrail-context";
import type { GuardrailViolation } from "../../../../domain/guardrail.schemas";
import type { GuardrailRule } from "../../../../domain/guardrail-rule";
import { shouldSkipFile } from "./skip-filter";

const CONTENT_PATTERNS: readonly { regex: RegExp; label: string }[] = [
  { regex: /\beval\s*\(/, label: "eval()" },
  { regex: /new\s+Function\s*\(/, label: "new Function()" },
  { regex: /require\s*\(\s*[^"'`]/, label: "dynamic require()" },
  { regex: /import\s*\(\s*[^"'`]/, label: "dynamic import()" },
];

export class SuspiciousContentRule implements GuardrailRule {
  readonly id = "suspicious-content" as const;

  evaluate(context: EnrichedGuardrailContext): GuardrailViolation[] {
    const violations: GuardrailViolation[] = [];

    // Check for package.json modification
    if (context.filesChanged.includes("package.json")) {
      violations.push({
        ruleId: this.id,
        severity: "warning",
        filePath: "package.json",
        message: "Modification of package.json detected",
      });
    }

    // Scan file contents for suspicious patterns
    for (const [filePath, content] of context.fileContents) {
      if (shouldSkipFile(filePath)) continue;
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        for (const { regex, label } of CONTENT_PATTERNS) {
          if (regex.test(lines[i])) {
            violations.push({
              ruleId: this.id,
              severity: "warning",
              filePath,
              pattern: regex.source,
              message: `Suspicious content detected: ${label}`,
              line: i + 1,
            });
          }
        }
      }
    }
    return violations;
  }
}
