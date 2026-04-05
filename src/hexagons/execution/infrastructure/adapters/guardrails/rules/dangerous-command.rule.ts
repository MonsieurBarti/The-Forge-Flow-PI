import type { EnrichedGuardrailContext } from "../../../../domain/enriched-guardrail-context";
import type { GuardrailViolation } from "../../../../domain/guardrail.schemas";
import type { GuardrailRule } from "../../../../domain/guardrail-rule";
import { shouldSkipFile } from "./skip-filter";

const PATTERNS: readonly { regex: RegExp; label: string }[] = [
  { regex: /rm\s+-rf\b/, label: "rm -rf" },
  { regex: /kill\s+-9\b/, label: "kill -9" },
  { regex: /chmod\s+777\b/, label: "chmod 777" },
  { regex: /\bmkfs\b/, label: "mkfs" },
  { regex: /\bdd\s+if=/, label: "dd if=" },
];

export class DangerousCommandRule implements GuardrailRule {
  readonly id = "dangerous-commands" as const;

  evaluate(context: EnrichedGuardrailContext): GuardrailViolation[] {
    const violations: GuardrailViolation[] = [];
    for (const [filePath, content] of context.fileContents) {
      if (shouldSkipFile(filePath)) continue;
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        for (const { regex, label } of PATTERNS) {
          if (regex.test(lines[i])) {
            violations.push({
              ruleId: this.id,
              severity: "error",
              filePath,
              pattern: regex.source,
              message: `Dangerous command detected: ${label}`,
              line: i + 1,
            });
          }
        }
      }
    }
    return violations;
  }
}
