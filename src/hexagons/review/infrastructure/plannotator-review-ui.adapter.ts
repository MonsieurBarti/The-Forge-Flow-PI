import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok, type Result } from "@kernel";
import type { ReviewUIError } from "../domain/errors/review-ui.error";
import { ReviewUIPort } from "../domain/ports/review-ui.port";
import { SEVERITY_RANK } from "../domain/review.schemas";
import type {
  ApprovalUIContext,
  ApprovalUIResponse,
  FindingsUIContext,
  FindingsUIResponse,
  VerificationUIContext,
  VerificationUIResponse,
} from "../domain/review-ui.schemas";

const CHANGE_MARKERS = ["[DELETION]", "[REPLACEMENT]", "[INSERTION]"];

// Promisify execFile for non-blocking subprocess
function execFileAsync(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: "utf-8", timeout: 0 }, (error, stdout) => {
      if (error) return reject(error);
      resolve(stdout.trim());
    });
  });
}

export class PlannotatorReviewUIAdapter extends ReviewUIPort {
  constructor(private readonly plannotatorPath: string) {
    super();
  }

  async presentFindings(
    ctx: FindingsUIContext,
  ): Promise<Result<FindingsUIResponse, ReviewUIError>> {
    try {
      const md = this.formatFindingsMarkdown(ctx);
      const feedback = await this.runAnnotate(md);
      return ok({ acknowledged: true, formattedOutput: feedback });
    } catch {
      return ok({
        acknowledged: true,
        formattedOutput: "[plannotator error — findings acknowledged]",
      });
    }
  }

  async presentVerification(
    ctx: VerificationUIContext,
  ): Promise<Result<VerificationUIResponse, ReviewUIError>> {
    try {
      const md = this.formatVerificationMarkdown(ctx);
      const feedback = await this.runAnnotate(md);
      return ok({ accepted: true, formattedOutput: feedback });
    } catch {
      return ok({
        accepted: true,
        formattedOutput: "[plannotator error — verification acknowledged]",
      });
    }
  }

  async presentForApproval(
    ctx: ApprovalUIContext,
  ): Promise<Result<ApprovalUIResponse, ReviewUIError>> {
    try {
      const feedback = await this.runAnnotateFile(ctx.artifactPath);
      const hasChanges = CHANGE_MARKERS.some((m) => feedback.includes(m));
      const decision = hasChanges ? "changes_requested" : "approved";
      return ok({
        decision,
        feedback: hasChanges ? feedback : undefined,
        formattedOutput: feedback || "[no feedback]",
      });
    } catch {
      return ok({
        decision: "changes_requested",
        feedback: "Plannotator parse error — please review manually",
        formattedOutput: "[plannotator error — changes requested for safety]",
      });
    }
  }

  // Write temp markdown, run plannotator annotate, return stdout, cleanup
  private async runAnnotate(markdownContent: string): Promise<string> {
    const tmpDir = await mkdtemp(join(tmpdir(), "tff-review-ui-"));
    const tmpFile = join(tmpDir, "review.md");
    try {
      await writeFile(tmpFile, markdownContent, "utf-8");
      return await this.runAnnotateFile(tmpFile);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  // Run plannotator annotate on existing file, return stdout (non-blocking)
  private runAnnotateFile(filePath: string): Promise<string> {
    return execFileAsync(this.plannotatorPath, ["annotate", filePath]);
  }

  private formatFindingsMarkdown(ctx: FindingsUIContext): string {
    const sorted = [...ctx.findings].sort(
      (a, b) => (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99),
    );
    const lines = [`# Review Findings — ${ctx.sliceLabel}`, `Verdict: **${ctx.verdict}**`, ""];
    for (const f of sorted) {
      lines.push(`- **${f.severity}** \`${f.filePath}:${f.lineStart}\` ${f.message}`);
    }
    if (ctx.conflicts.length > 0) {
      lines.push("", "## Conflicts (require human resolution)", "");
      for (const c of ctx.conflicts) {
        lines.push(`- \`${c.filePath}:${c.lineStart}\` ${c.description}`);
      }
    }
    return lines.join("\n");
  }

  private formatVerificationMarkdown(ctx: VerificationUIContext): string {
    const lines = [`# Verification — ${ctx.sliceLabel}`, `Overall: **${ctx.overallVerdict}**`, ""];
    for (const c of ctx.criteria) {
      const icon = c.verdict === "PASS" ? "✅" : "❌";
      lines.push(`${icon} **${c.criterion}**: ${c.verdict}`, `  Evidence: ${c.evidence}`, "");
    }
    return lines.join("\n");
  }
}
