import type {
  AgentCapability,
  AgentCard,
  AgentType,
} from "./agent-card.schema";

export const AGENT_REGISTRY: ReadonlyMap<AgentType, AgentCard> = new Map<
  AgentType,
  AgentCard
>([
  [
    "spec-reviewer",
    {
      type: "spec-reviewer",
      displayName: "Spec Reviewer",
      description:
        "Reviews specifications for completeness, buildability, and correctness",
      capabilities: ["review"],
      defaultModelProfile: "quality",
      requiredTools: ["Read", "Glob", "Grep"],
      optionalTools: [],
    },
  ],
  [
    "code-reviewer",
    {
      type: "code-reviewer",
      displayName: "Code Reviewer",
      description: "Reviews code for correctness, patterns, and security",
      capabilities: ["review"],
      defaultModelProfile: "quality",
      requiredTools: ["Read", "Glob", "Grep"],
      optionalTools: [],
    },
  ],
  [
    "security-auditor",
    {
      type: "security-auditor",
      displayName: "Security Auditor",
      description:
        "Audits code for security vulnerabilities and OWASP compliance",
      capabilities: ["review"],
      defaultModelProfile: "quality",
      requiredTools: ["Read", "Glob", "Grep"],
      optionalTools: [],
    },
  ],
  [
    "fixer",
    {
      type: "fixer",
      displayName: "Fixer",
      description:
        "Diagnoses and fixes bugs, test failures, and review feedback",
      capabilities: ["fix"],
      defaultModelProfile: "budget",
      requiredTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      optionalTools: [],
    },
  ],
]);

export function getAgentCard(type: AgentType): AgentCard {
  const card = AGENT_REGISTRY.get(type);
  if (!card) {
    throw new Error(
      `[BUG] Missing registry entry for agent type "${type}". This is a programming error — every AgentType must have a card.`,
    );
  }
  return card;
}

export function findAgentsByCapability(
  capability: AgentCapability,
): AgentCard[] {
  const result: AgentCard[] = [];
  for (const card of AGENT_REGISTRY.values()) {
    if (card.capabilities.includes(capability)) {
      result.push(card);
    }
  }
  return result;
}
