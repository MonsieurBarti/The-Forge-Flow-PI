import type { Result } from "@kernel";
import type { AuditReportProps } from "../completion.schemas";
import type { AuditError } from "../errors/audit.error";

export abstract class AuditPort {
  abstract auditMilestone(params: {
    milestoneLabel: string;
    requirementsContent: string;
    diffContent: string;
    agentType: "spec-reviewer" | "security-auditor";
  }): Promise<Result<AuditReportProps, AuditError>>;
}
