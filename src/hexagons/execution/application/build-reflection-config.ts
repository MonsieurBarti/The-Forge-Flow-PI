import type { AgentDispatchConfig } from "@kernel";

export const REFLECTION_TOOLS = ["Read", "Glob", "Grep", "Bash"] as const;

export interface BuildReflectionConfigParams {
  readonly originalConfig: AgentDispatchConfig;
  readonly acceptanceCriteria: string;
  readonly gitDiff: string;
}

export function buildReflectionConfig(params: BuildReflectionConfigParams): AgentDispatchConfig {
  const { originalConfig, acceptanceCriteria, gitDiff } = params;

  return {
    taskId: `${originalConfig.taskId}-reflection`,
    sliceId: originalConfig.sliceId,
    agentType: originalConfig.agentType,
    workingDirectory: originalConfig.workingDirectory,
    systemPrompt: REFLECTION_SYSTEM_PROMPT,
    taskPrompt: buildReflectionTaskPrompt(acceptanceCriteria, gitDiff, originalConfig.taskPrompt),
    model: originalConfig.model,
    tools: [...REFLECTION_TOOLS],
    filePaths: [...originalConfig.filePaths],
  };
}

const REFLECTION_SYSTEM_PROMPT = `You are a code reviewer performing a post-implementation reflection.
Your role is to review the changes made by a previous agent against the acceptance criteria.
You MUST NOT modify any code. You are read-only.

Report your findings using the following format:

<!-- TFF_REFLECTION_REPORT -->
{
  "passed": true|false,
  "issues": [
    { "severity": "blocker"|"warning", "description": "...", "filePath": "..." }
  ]
}
<!-- /TFF_REFLECTION_REPORT -->

- "blocker" = implementation does not satisfy an AC or introduces a defect
- "warning" = minor concern that does not block acceptance
- If no issues, set passed=true and issues=[]`;

function buildReflectionTaskPrompt(
  acceptanceCriteria: string,
  gitDiff: string,
  originalTaskPrompt: string,
): string {
  return `## Original Task
${originalTaskPrompt}

## Acceptance Criteria
${acceptanceCriteria}

## Changes to Review
\`\`\`diff
${gitDiff}
\`\`\`

Review these changes against the acceptance criteria above. Report your findings.`;
}
