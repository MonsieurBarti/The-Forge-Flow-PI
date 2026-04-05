import type { Result } from "@kernel";
import type { AuditError } from "../errors/audit.error";
import type { AuditReportProps } from "../schemas/completion.schemas";

export abstract class AuditPort {
  abstract auditMilestone(params: {
    milestoneLabel: string;
    requirementsContent: string;
    diffContent: string;
    agentType: "spec-reviewer" | "security-auditor";
  }): Promise<Result<AuditReportProps, AuditError>>;
}
