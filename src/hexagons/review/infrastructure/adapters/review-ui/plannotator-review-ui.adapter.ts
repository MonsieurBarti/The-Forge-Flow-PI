import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const PLANNOTATOR_REQUEST_CHANNEL = "plannotator:request";
const PLANNOTATOR_REVIEW_RESULT_CHANNEL = "plannotator:review-result";
const ACK_TIMEOUT_MS = 10_000;
const REVIEW_TIMEOUT_MS = 600_000; // 10 minutes

/** Narrow interface for the PI event bus — avoids importing PI types into infrastructure */
export interface PlannotatorEventEmitter {
  emit(channel: string, data: unknown): void;
  on(channel: string, handler: (data: unknown) => void): () => void;
}

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
  constructor(
    private readonly plannotatorPath: string,
    private readonly events: PlannotatorEventEmitter,
    private readonly reviewTimeoutMs: number = REVIEW_TIMEOUT_MS,
  ) {
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
      const planContent = await readFile(ctx.artifactPath, "utf-8");

      // 1. Emit plan-review request, get reviewId
      const ack = await this.emitPlanReview({
        planContent,
        planFilePath: ctx.artifactPath,
        origin: "tff",
      });

      if (ack.status !== "handled" || ack.result?.status !== "pending") {
        // Plannotator unavailable or error — fall back to annotate
        return this.presentForApprovalViaAnnotate(ctx);
      }

      // 2. Wait for user's review decision
      const reviewResult = await this.awaitReviewCompletion(ack.result.reviewId);

      const decision = reviewResult.approved ? "approved" : "changes_requested";
      return ok({
        decision,
        feedback: reviewResult.feedback,
        formattedOutput:
          reviewResult.feedback || (reviewResult.approved ? "[approved]" : "[changes requested]"),
      });
    } catch {
      // Timeout or communication error — fall back to annotate
      try {
        return await this.presentForApprovalViaAnnotate(ctx);
      } catch {
        return ok({
          decision: "changes_requested",
          feedback: "Plannotator review failed — please review manually",
          formattedOutput: "[plannotator error — changes requested for safety]",
        });
      }
    }
  }

  // ── Fallback: annotate-based approval (used when plan-review is unavailable) ──

  private async presentForApprovalViaAnnotate(
    ctx: ApprovalUIContext,
  ): Promise<Result<ApprovalUIResponse, ReviewUIError>> {
    const feedback = await this.runAnnotateFile(ctx.artifactPath);
    const CHANGE_MARKERS = ["[DELETION]", "[REPLACEMENT]", "[INSERTION]"];
    const hasChanges = CHANGE_MARKERS.some((m) => feedback.includes(m));
    const decision = hasChanges ? "changes_requested" : "approved";
    return ok({
      decision,
      feedback: hasChanges ? feedback : undefined,
      formattedOutput: feedback || "[no feedback]",
    });
  }

  // ── Event-based plan-review helpers ──

  private emitPlanReview(payload: {
    planContent: string;
    planFilePath?: string;
    origin?: string;
  }): Promise<{ status: string; result?: { status: string; reviewId: string } }> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("plannotator:request acknowledgment timeout")),
        ACK_TIMEOUT_MS,
      );
      this.events.emit(PLANNOTATOR_REQUEST_CHANNEL, {
        requestId: randomUUID(),
        action: "plan-review",
        payload,
        respond: (response: { status: string; result?: { status: string; reviewId: string } }) => {
          clearTimeout(timeout);
          resolve(response);
        },
      });
    });
  }

  private awaitReviewCompletion(
    reviewId: string,
  ): Promise<{ approved: boolean; feedback?: string }> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Review timeout for ${reviewId}`));
      }, this.reviewTimeoutMs);

      // Register listener BEFORE emit to avoid race condition
      const unsubscribe = this.events.on(PLANNOTATOR_REVIEW_RESULT_CHANNEL, (data: unknown) => {
        const result = data as { reviewId: string; approved: boolean; feedback?: string };
        if (result.reviewId !== reviewId) return;
        clearTimeout(timeout);
        unsubscribe();
        resolve({ approved: result.approved, feedback: result.feedback });
      });
    });
  }

  // ── CLI subprocess helpers (for annotate-based methods) ──

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
