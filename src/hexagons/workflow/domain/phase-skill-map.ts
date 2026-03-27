import type { SkillName, SkillReference, SkillType } from "./context-package.schemas";
import type { WorkflowPhase } from "./workflow-session.schemas";

export const SKILL_REGISTRY: Record<SkillName, SkillType> = {
  brainstorming: "flexible",
  "writing-plans": "rigid",
  "stress-testing-specs": "flexible",
  "test-driven-development": "rigid",
  "hexagonal-architecture": "flexible",
  "commit-conventions": "rigid",
  "systematic-debugging": "rigid",
  "research-methodology": "flexible",
  "acceptance-criteria-validation": "rigid",
  "verification-before-completion": "rigid",
  "code-review-protocol": "rigid",
  "architecture-review": "flexible",
  "finishing-work": "flexible",
};

export const PHASE_SKILL_MAP: Record<WorkflowPhase, SkillName[]> = {
  idle: [],
  discussing: ["brainstorming"],
  researching: ["research-methodology"],
  planning: ["writing-plans", "stress-testing-specs"],
  executing: ["test-driven-development", "hexagonal-architecture", "commit-conventions"],
  verifying: ["acceptance-criteria-validation", "verification-before-completion"],
  reviewing: ["code-review-protocol"],
  shipping: ["finishing-work", "commit-conventions"],
  "completing-milestone": [],
  paused: [],
  blocked: [],
};

const MAX_SKILLS_PER_DISPATCH = 3;

export function selectSkillsForPhase(phase: WorkflowPhase): SkillReference[] {
  const names = PHASE_SKILL_MAP[phase];
  const refs: SkillReference[] = names.map((name) => ({
    name,
    type: SKILL_REGISTRY[name],
  }));
  const sorted = [...refs].sort((a, b) => {
    if (a.type === "rigid" && b.type !== "rigid") return -1;
    if (a.type !== "rigid" && b.type === "rigid") return 1;
    return 0;
  });
  return sorted.slice(0, MAX_SKILLS_PER_DISPATCH);
}
