import { stringify } from "yaml";
import type { AgentCapability, AgentSkill, AgentType } from "./agent-card.schema";

export interface CreateAgentOptions {
  displayName: string;
  purpose: string;
  scope: "slice" | "task";
  capabilities: AgentCapability[];
  modelProfile: "quality" | "balanced" | "budget";
  freshReviewerRule: "must-not-be-executor" | "none";
  skills?: AgentSkill[];
  identity?: string;
  requiredTools?: string[];
}

export function createAgentTemplate(type: AgentType, options: CreateAgentOptions): string {
  const frontmatter = {
    type,
    displayName: options.displayName,
    purpose: options.purpose,
    scope: options.scope,
    freshReviewerRule: options.freshReviewerRule,
    modelProfile: options.modelProfile,
    skills: options.skills ?? [
      { name: "standard", prompt: "prompts/standard-review.md", strategy: "standard" },
    ],
    requiredTools: options.requiredTools ?? [],
    capabilities: options.capabilities,
  };

  const identity =
    options.identity ??
    `You are a ${options.displayName}. Define your values and perspective here.`;

  return `---\n${stringify(frontmatter).trimEnd()}\n---\n\n${identity}\n`;
}
