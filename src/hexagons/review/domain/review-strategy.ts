import type { ReviewRole, ReviewStrategy } from "./review.schemas";

const ROLE_STRATEGY_MAP: Record<ReviewRole, ReviewStrategy> = {
  "code-reviewer": "critique-then-reflection",
  "security-auditor": "critique-then-reflection",
  "spec-reviewer": "standard",
} as const;

export function strategyForRole(role: ReviewRole): ReviewStrategy {
  return ROLE_STRATEGY_MAP[role];
}
