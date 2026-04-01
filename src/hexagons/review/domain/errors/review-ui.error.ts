import { BaseDomainError } from "@kernel";

export class ReviewUIError extends BaseDomainError {
  readonly code: string;

  private constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = code;
  }

  static presentationFailed(context: string, cause: unknown): ReviewUIError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new ReviewUIError(
      "REVIEW_UI.PRESENTATION_FAILED",
      `Failed to present ${context}: ${msg}`,
      { context, cause: msg },
    );
  }

  static plannotatorNotFound(): ReviewUIError {
    return new ReviewUIError(
      "REVIEW_UI.PLANNOTATOR_NOT_FOUND",
      "plannotator binary not found on PATH",
    );
  }

  static feedbackParseError(raw: string): ReviewUIError {
    return new ReviewUIError(
      "REVIEW_UI.FEEDBACK_PARSE_ERROR",
      `Failed to parse plannotator feedback: ${raw.slice(0, 100)}`,
      { raw },
    );
  }
}
