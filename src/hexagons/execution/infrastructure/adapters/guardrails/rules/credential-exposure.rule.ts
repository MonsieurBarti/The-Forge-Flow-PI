import type { EnrichedGuardrailContext } from "../../../../domain/enriched-guardrail-context";
import type { GuardrailViolation } from "../../../../domain/guardrail.schemas";
import type { GuardrailRule } from "../../../../domain/guardrail-rule";
import { shouldSkipFile } from "./skip-filter";

const PATTERNS: readonly { regex: RegExp; label: string }[] = [
  { regex: /AKIA[A-Z0-9]{16}/, label: "AWS access key" },
  { regex: /BEGIN (RSA |OPENSSH )?PRIVATE KEY/, label: "Private key" },
  { regex: /password\s*[:=]\s*["'][^"']+["']/, label: "Password assignment" },
  {
    regex: /(?:api[_-]?key|secret[_-]?key|auth[_-]?token)\s*[:=]\s*["'][^"']+["']/,
    label: "API key/token",
  },
];

export class CredentialExposureRule implements GuardrailRule {
  readonly id = "credential-exposure" as const;

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
              message: `Credential exposure detected: ${label}`,
              line: i + 1,
            });
          }
        }
      }
    }
    return violations;
  }
}
