import type { ReviewRole, ReviewStrategy } from "../schemas/review.schemas";

const ROLE_STRATEGY_MAP: Record<ReviewRole, ReviewStrategy> = {
  "tff-code-reviewer": "critique-then-reflection",
  "tff-security-auditor": "critique-then-reflection",
  "tff-spec-reviewer": "standard",
} as const;

export function strategyForRole(role: ReviewRole): ReviewStrategy {
  return ROLE_STRATEGY_MAP[role];
}
