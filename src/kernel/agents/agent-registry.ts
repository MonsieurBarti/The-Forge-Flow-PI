import type { AgentCapability, AgentCard, AgentType } from "./agent-card.schema";

export const AGENT_REGISTRY: ReadonlyMap<AgentType, AgentCard> = new Map<AgentType, AgentCard>([
  [
    "spec-reviewer",
    {
      type: "spec-reviewer",
      displayName: "Spec Reviewer",
      description: "Reviews specifications for completeness, buildability, and correctness",
      identity: "You are a senior specification reviewer with expertise in software design.",
      purpose: "Review specifications for completeness, buildability, and correctness",
      scope: "slice",
      freshReviewerRule: "must-not-be-executor",
      capabilities: ["review"],
      defaultModelProfile: "quality",
      skills: [
        { name: "standard-review", prompt: "prompts/standard-review.md", strategy: "standard" },
      ],
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
      identity: "You are a senior code reviewer with deep expertise in software engineering.",
      purpose: "Review code changes for correctness, quality patterns, and security",
      scope: "slice",
      freshReviewerRule: "must-not-be-executor",
      capabilities: ["review"],
      defaultModelProfile: "quality",
      skills: [
        {
          name: "critique-then-reflection",
          prompt: "prompts/critique-then-reflection.md",
          strategy: "critique-then-reflection",
        },
      ],
      requiredTools: ["Read", "Glob", "Grep"],
      optionalTools: [],
    },
  ],
  [
    "security-auditor",
    {
      type: "security-auditor",
      displayName: "Security Auditor",
      description: "Audits code for security vulnerabilities and OWASP compliance",
      identity:
        "You are a security expert specializing in application security and OWASP compliance.",
      purpose: "Audit code for security vulnerabilities and OWASP compliance",
      scope: "slice",
      freshReviewerRule: "must-not-be-executor",
      capabilities: ["review"],
      defaultModelProfile: "quality",
      skills: [
        { name: "security-audit", prompt: "prompts/security-audit.md", strategy: "standard" },
      ],
      requiredTools: ["Read", "Glob", "Grep"],
      optionalTools: [],
    },
  ],
  [
    "fixer",
    {
      type: "fixer",
      displayName: "Fixer",
      description: "Diagnoses and fixes bugs, test failures, and review feedback",
      identity: "You are an expert software engineer focused on diagnosing and fixing issues.",
      purpose: "Diagnose and fix bugs, test failures, and review feedback",
      scope: "task",
      freshReviewerRule: "none",
      capabilities: ["fix"],
      defaultModelProfile: "budget",
      skills: [{ name: "standard-fix", prompt: "prompts/standard-fix.md", strategy: "standard" }],
      requiredTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      optionalTools: [],
    },
  ],
  [
    "executor",
    {
      type: "executor",
      displayName: "Executor",
      description: "Executes slice tasks via wave-based parallelism with agent dispatch",
      identity: "You are a disciplined executor that implements tasks methodically and precisely.",
      purpose: "Execute slice tasks via wave-based parallelism with agent dispatch",
      scope: "slice",
      freshReviewerRule: "none",
      capabilities: ["execute"],
      defaultModelProfile: "budget",
      skills: [
        { name: "standard-execute", prompt: "prompts/standard-execute.md", strategy: "standard" },
      ],
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

export function findAgentsByCapability(capability: AgentCapability): AgentCard[] {
  const result: AgentCard[] = [];
  for (const card of AGENT_REGISTRY.values()) {
    if (card.capabilities.includes(capability)) {
      result.push(card);
    }
  }
  return result;
}
