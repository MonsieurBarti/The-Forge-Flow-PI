import type { EnrichedGuardrailContext } from "../../../../domain/enriched-guardrail-context";
import type { GuardrailViolation } from "../../../../domain/guardrail.schemas";
import type { GuardrailRule } from "../../../../domain/guardrail-rule";
import { shouldSkipFile } from "./skip-filter";

const PATTERNS: readonly { regex: RegExp; label: string }[] = [
  { regex: /git\s+merge\b/, label: "git merge (use /tff ship instead)" },
  { regex: /git\s+push\b/, label: "git push (use /tff ship instead)" },
  { regex: /git\s+push\s+--force/, label: "git push --force" },
  { regex: /git\s+reset\s+--hard/, label: "git reset --hard" },
  { regex: /git\s+clean\s+-[a-z]*f/, label: "git clean -f" },
  { regex: /git\s+checkout\s+\./, label: "git checkout ." },
  {
    regex: /git\s+checkout\s+(main|master)\b/,
    label: "git checkout main/master (stay on slice branch)",
  },
];

export class DestructiveGitRule implements GuardrailRule {
  readonly id = "destructive-git" as const;

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
              message: `Destructive git operation detected: ${label}`,
              line: i + 1,
            });
          }
        }
      }
    }
    return violations;
  }
}
