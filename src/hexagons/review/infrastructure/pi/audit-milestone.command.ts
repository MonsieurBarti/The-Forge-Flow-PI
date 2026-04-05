import type { ExtensionAPI, ExtensionCommandContext } from "@infrastructure/pi";
import type { AuditMilestoneUseCase } from "../../application/audit-milestone.use-case";
import type { AuditReportProps } from "../../domain/schemas/completion.schemas";

export interface AuditMilestoneCommandDeps {
  auditMilestone: AuditMilestoneUseCase;
  resolveActiveMilestone: () => Promise<{
    milestoneId: string;
    milestoneLabel: string;
    headBranch: string;
    baseBranch: string;
    workingDirectory: string;
  } | null>;
}

function formatAuditReport(
  reports: AuditReportProps[],
  allPassed: boolean,
  unresolvedCount: number,
): string {
  const lines: string[] = [];
  lines.push("## Milestone Audit Report");
  lines.push("");
  lines.push(
    `**Overall:** ${allPassed ? "PASS" : "FAIL"} | **Unresolved findings:** ${unresolvedCount}`,
  );
  lines.push("");

  for (const report of reports) {
    const title = report.agentType === "spec-reviewer" ? "Intent Audit" : "Security Audit";
    lines.push(`### ${title}`);
    lines.push(`**Verdict:** ${report.verdict} | **Findings:** ${report.findings.length}`);
    lines.push("");
    lines.push(report.summary);
    lines.push("");

    if (report.findings.length > 0) {
      lines.push("| Severity | File | Message |");
      lines.push("|---|---|---|");
      for (const f of report.findings) {
        lines.push(`| ${f.severity} | ${f.filePath}:${f.lineStart} | ${f.message} |`);
      }
      lines.push("");
    }
  }

  if (allPassed) {
    lines.push("All clear. `/tff:complete-milestone` can proceed.");
  } else {
    lines.push("Address all findings, then re-run `/tff:audit-milestone`.");
  }

  return lines.join("\n");
}

export function registerAuditMilestoneCommand(
  api: ExtensionAPI,
  deps: AuditMilestoneCommandDeps,
): void {
  api.registerCommand("tff:audit-milestone", {
    description: "Run milestone audit (required before completion)",
    handler: async (_args: string, _ctx: ExtensionCommandContext) => {
      const milestone = await deps.resolveActiveMilestone();
      if (!milestone) {
        api.sendUserMessage("No active milestone found.");
        return;
      }

      const result = await deps.auditMilestone.execute(milestone);

      if (!result.ok) {
        api.sendUserMessage(`Audit failed: ${result.error.message}`);
        return;
      }

      api.sendUserMessage(
        formatAuditReport(
          result.data.auditReports,
          result.data.allPassed,
          result.data.unresolvedCount,
        ),
      );
    },
  });
}
