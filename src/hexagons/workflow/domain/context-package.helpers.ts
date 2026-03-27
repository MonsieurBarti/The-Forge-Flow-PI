import type { AgentType } from "@kernel";
import { ACTIVE_PHASES } from "./transition-table";
import type { WorkflowPhase } from "./workflow-session.schemas";

export const PHASE_AGENT_MAP: Partial<Record<WorkflowPhase, AgentType>> = {
  reviewing: "code-reviewer",
  verifying: "spec-reviewer",
};

export function isActivePhase(phase: WorkflowPhase): boolean {
  return ACTIVE_PHASES.has(phase);
}

export function resolveAgentType(phase: WorkflowPhase): AgentType {
  return PHASE_AGENT_MAP[phase] ?? "fixer";
}

export function buildTaskPrompt(description: string, criteria: string[]): string {
  if (criteria.length === 0) return description;
  const numbered = criteria.map((c, i) => `${i + 1}. ${c}`).join("\n");
  return `${description}\n\n## Acceptance Criteria\n${numbered}`;
}
