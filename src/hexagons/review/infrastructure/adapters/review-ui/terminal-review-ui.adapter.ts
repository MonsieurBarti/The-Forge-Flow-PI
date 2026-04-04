import { ok, type Result } from "@kernel";
import type { ReviewUIError } from "../../../domain/errors/review-ui.error";
import { ReviewUIPort } from "../../../domain/ports/review-ui.port";
import { SEVERITY_RANK } from "../../../domain/schemas/review.schemas";
import type {
  ApprovalUIContext,
  ApprovalUIResponse,
  FindingsUIContext,
  FindingsUIResponse,
  VerificationUIContext,
  VerificationUIResponse,
} from "../../../domain/schemas/review-ui.schemas";

const SEVERITY_ICON: Record<string, string> = {
  critical: "\u{1F6D1}",
  high: "\u{26A0}\u{FE0F}",
  medium: "\u{1F536}",
  low: "\u{1F539}",
  info: "\u{2139}\u{FE0F}",
};

export class TerminalReviewUIAdapter extends ReviewUIPort {
  async presentFindings(
    ctx: FindingsUIContext,
  ): Promise<Result<FindingsUIResponse, ReviewUIError>> {
    const lines: string[] = [];

    lines.push(`# Review Findings \u2014 ${ctx.sliceLabel}`);
    lines.push(`**Verdict:** ${ctx.verdict}`);
    lines.push("");

    if (ctx.findings.length > 0) {
      const sorted = [...ctx.findings].sort(
        (a, b) => (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99),
      );

      lines.push("## Findings");
      lines.push("");
      lines.push("| Severity | Location | Message |");
      lines.push("|----------|----------|---------|");

      for (const f of sorted) {
        const icon = SEVERITY_ICON[f.severity] ?? "";
        const loc = f.lineEnd
          ? `\`${f.filePath}:${f.lineStart}-${f.lineEnd}\``
          : `\`${f.filePath}:${f.lineStart}\``;
        lines.push(`| ${icon} ${f.severity} | ${loc} | ${f.message} |`);
      }
      lines.push("");
    }

    if (ctx.conflicts.length > 0) {
      lines.push("## Conflicts");
      lines.push("");
      for (const c of ctx.conflicts) {
        lines.push(`- \`${c.filePath}:${c.lineStart}\` ${c.description}`);
        for (const rv of c.reviewerVerdicts) {
          lines.push(`  - ${rv.role}: **${rv.severity}**`);
        }
      }
      lines.push("");
    }

    if (ctx.fixCyclesUsed > 0) {
      lines.push(`Fix cycles used: ${ctx.fixCyclesUsed}`);
    }
    if (ctx.timedOutReviewers.length > 0) {
      lines.push(`Timed-out reviewers: ${ctx.timedOutReviewers.join(", ")}`);
    }

    const formattedOutput = lines.join("\n");
    return ok({ acknowledged: true, formattedOutput });
  }

  async presentVerification(
    ctx: VerificationUIContext,
  ): Promise<Result<VerificationUIResponse, ReviewUIError>> {
    const lines: string[] = [];

    lines.push(`# Verification \u2014 ${ctx.sliceLabel}`);
    lines.push(`**Overall:** ${ctx.overallVerdict}`);
    lines.push("");
    lines.push("| Criterion | Verdict | Evidence |");
    lines.push("|-----------|---------|----------|");

    for (const c of ctx.criteria) {
      const icon = c.verdict === "PASS" ? "\u2705" : "\u274C";
      lines.push(`| ${c.criterion} | ${icon} ${c.verdict} | ${c.evidence} |`);
    }
    lines.push("");

    const formattedOutput = lines.join("\n");
    const accepted = ctx.overallVerdict === "PASS";
    return ok({ accepted, formattedOutput });
  }

  async presentForApproval(
    ctx: ApprovalUIContext,
  ): Promise<Result<ApprovalUIResponse, ReviewUIError>> {
    const lines: string[] = [];

    lines.push(
      `# ${ctx.artifactType.charAt(0).toUpperCase() + ctx.artifactType.slice(1)} \u2014 ${ctx.sliceLabel}`,
    );
    lines.push("");
    lines.push(`**Path:** ${ctx.artifactPath}`);
    lines.push(`**Summary:** ${ctx.summary}`);
    lines.push("");

    const formattedOutput = lines.join("\n");
    return ok({ decision: undefined, formattedOutput });
  }
}
