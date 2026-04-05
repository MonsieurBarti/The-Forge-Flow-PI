import { BaseDomainError } from "@kernel";

export class ShipError extends BaseDomainError {
  readonly code: string;

  private constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = code;
  }

  static prerequisiteFailed(sliceId: string, reason: string): ShipError {
    return new ShipError(
      "SHIP.PREREQUISITE_FAILED",
      `Prerequisite failed for slice ${sliceId}: ${reason}`,
      { sliceId, reason },
    );
  }

  static prCreationFailed(sliceId: string, cause: unknown): ShipError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new ShipError(
      "SHIP.PR_CREATION_FAILED",
      `PR creation failed for slice ${sliceId}: ${msg}`,
      { sliceId, cause: msg },
    );
  }

  static cleanupFailed(sliceId: string, cause: unknown): ShipError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new ShipError("SHIP.CLEANUP_FAILED", `Cleanup failed for slice ${sliceId}: ${msg}`, {
      sliceId,
      cause: msg,
    });
  }

  static mergeDeclined(sliceId: string): ShipError {
    return new ShipError("SHIP.MERGE_DECLINED", `Merge was declined for slice ${sliceId}`, {
      sliceId,
    });
  }

  static contextResolutionFailed(sliceId: string, cause: unknown): ShipError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new ShipError(
      "SHIP.CONTEXT_RESOLUTION_FAILED",
      `Failed to resolve ship context for slice ${sliceId}: ${msg}`,
      { sliceId, cause: msg },
    );
  }

  static mergeBackFailed(sliceId: string, cause: unknown): ShipError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new ShipError(
      "SHIP.MERGE_BACK_FAILED",
      `State merge-back failed for slice ${sliceId}: ${msg}`,
      { sliceId, cause: msg },
    );
  }
}
