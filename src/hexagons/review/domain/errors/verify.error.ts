import { BaseDomainError } from "@kernel";

export class VerifyError extends BaseDomainError {
  readonly code: string;

  private constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = code;
  }

  static contextResolutionFailed(sliceId: string, cause: unknown): VerifyError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new VerifyError(
      "VERIFY.CONTEXT_RESOLUTION_FAILED",
      `Failed to resolve verification context for slice ${sliceId}: ${msg}`,
      { sliceId, cause: msg },
    );
  }

  static freshReviewerBlocked(sliceId: string, verifierId: string): VerifyError {
    return new VerifyError(
      "VERIFY.FRESH_REVIEWER_BLOCKED",
      `Fresh-reviewer violation: ${verifierId} cannot verify slice ${sliceId}`,
      { sliceId, verifierId },
    );
  }

  static verifierFailed(sliceId: string, cause: unknown): VerifyError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new VerifyError(
      "VERIFY.VERIFIER_FAILED",
      `Verifier failed for slice ${sliceId}: ${msg}`,
      { sliceId, cause: msg },
    );
  }

  static parseError(sliceId: string, rawOutput: string): VerifyError {
    return new VerifyError(
      "VERIFY.PARSE_ERROR",
      `Failed to parse verifier output for slice ${sliceId}`,
      { sliceId, rawOutput },
    );
  }
}
