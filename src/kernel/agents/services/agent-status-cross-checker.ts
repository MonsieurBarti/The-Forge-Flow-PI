import type { AgentType } from "../schemas/agent-card.schema";
import type { AgentCost } from "../schemas/agent-result.schema";
import type { AgentConcern, AgentStatusReport } from "../schemas/agent-status.schema";

export interface AgentResultTransport {
  filesChanged: string[];
  durationMs: number;
  cost: AgentCost;
  error?: string;
}

export interface CrossCheckResult {
  valid: boolean;
  discrepancies: AgentConcern[];
}

export function crossCheckAgentResult(
  report: AgentStatusReport,
  transport: AgentResultTransport,
  agentType: AgentType,
): CrossCheckResult {
  const discrepancies: AgentConcern[] = [];

  // 1. Files claim: completeness passed but no files changed (fixer only)
  if (agentType === "tff-fixer") {
    const completeness = report.selfReview.dimensions.find((d) => d.dimension === "completeness");
    if (completeness?.passed && transport.filesChanged.length === 0) {
      discrepancies.push({
        area: "files-claim",
        description:
          "Agent reported completeness passed but no files were changed (fixer agent expected to modify files)",
        severity: "warning",
      });
    }
  }

  // 2. Error consistency: DONE with populated error
  if (report.status === "DONE" && transport.error) {
    discrepancies.push({
      area: "error-consistency",
      description: `Agent reported DONE but error field is populated: "${transport.error}"`,
      severity: "warning",
    });
  }

  // 3. Concern consistency: DONE with non-empty concerns
  if (report.status === "DONE" && report.concerns.length > 0) {
    discrepancies.push({
      area: "concern-consistency",
      description: `Agent reported DONE but has ${report.concerns.length} concern(s) — should be DONE_WITH_CONCERNS`,
      severity: "warning",
    });
  }

  // 4. Cost sanity: zero duration or zero cost with non-zero tokens
  const totalTokens = transport.cost.inputTokens + transport.cost.outputTokens;
  if (totalTokens > 0 && (transport.durationMs === 0 || transport.cost.costUsd === 0)) {
    discrepancies.push({
      area: "cost-sanity",
      description: `${transport.durationMs === 0 ? "Zero duration" : "Zero cost"} with ${totalTokens} tokens — possible data issue`,
      severity: "warning",
    });
  }

  return { valid: discrepancies.length === 0, discrepancies };
}
