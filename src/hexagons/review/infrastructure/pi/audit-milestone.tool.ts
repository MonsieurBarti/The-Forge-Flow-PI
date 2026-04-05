import { createZodTool, textResult } from "@infrastructure/pi";
import { z } from "zod";
import type { AuditMilestoneUseCase } from "../../application/audit-milestone.use-case";

export interface AuditMilestoneToolDeps {
  auditMilestone: AuditMilestoneUseCase;
}

export function createAuditMilestoneTool(deps: AuditMilestoneToolDeps) {
  return createZodTool({
    name: "tff_audit_milestone",
    label: "TFF Audit Milestone",
    description: "Run spec-reviewer and security-auditor audit on a milestone",
    schema: z.object({
      milestoneId: z.string().describe("Milestone ID"),
      milestoneLabel: z.string().describe("Milestone label"),
      headBranch: z.string().describe("Head branch for diff"),
      baseBranch: z.string().describe("Base branch for diff"),
      workingDirectory: z.string().describe("Working directory"),
    }),
    execute: async (params) => {
      const result = await deps.auditMilestone.execute(params);
      if (!result.ok) return textResult(JSON.stringify({ error: result.error.message }));
      return textResult(JSON.stringify(result.data));
    },
  });
}
