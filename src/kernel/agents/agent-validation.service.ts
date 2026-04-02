import { err, ok, type Result } from "@kernel/result";
import type { AgentCard } from "./agent-card.schema";
import { AgentValidationError } from "./agent-errors";

const MAX_IDENTITY_LINES = 30;

const METHODOLOGY_BLOCKLIST: RegExp[] = [
  /\bstep \d/,
  /\byou must\b/,
  /\byou should\b/,
  /\byou will\b/,
  /\byou need to\b/,
  /^import /m,
  /\brequire\(/,
  /\bfunction\s+\w+/,
  /\bclass\s+[A-Z]/,
  /^export /m,
  /\bconst\s+\w+\s*=/,
  /\blet\s+\w+\s*=/,
  /\bvar\s+\w+\s*=/,
  /\bif\s*\(/,
  /\bfor\s*\(/,
  /\bwhile\s*\(/,
  /\breturn\s+[^.]*;/,
  /=>\s*\{/,
];

export class AgentValidationService {
  validate(card: AgentCard): Result<AgentCard, AgentValidationError> {
    const lines = card.identity.split("\n").length;
    if (lines > MAX_IDENTITY_LINES) {
      return err(AgentValidationError.identityTooLong(lines));
    }

    const matches: string[] = [];
    for (const pattern of METHODOLOGY_BLOCKLIST) {
      if (pattern.test(card.identity)) {
        matches.push(pattern.source);
      }
    }
    if (matches.length > 0) {
      return err(AgentValidationError.methodologyDetected(matches));
    }

    const needsFreshReviewer =
      card.capabilities.includes("review") || card.capabilities.includes("verify");
    if (needsFreshReviewer && card.freshReviewerRule !== "must-not-be-executor") {
      return err(AgentValidationError.missingFreshReviewerRule(card.type));
    }

    if (!needsFreshReviewer && card.freshReviewerRule !== "none") {
      return err(AgentValidationError.invalidFreshReviewerRule(card.type));
    }

    if (card.skills.length === 0) {
      return err(AgentValidationError.noSkillsDeclared(card.type));
    }

    return ok(card);
  }
}
