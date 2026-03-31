import { BaseDomainError } from "@kernel";

export class GuardrailError extends BaseDomainError {
  readonly code: string;

  private constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = code;
  }

  static fileReadFailed(filePath: string, cause: unknown): GuardrailError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new GuardrailError(
      "GUARDRAIL.FILE_READ_FAILED",
      `Failed to read file for guardrail check: ${filePath}: ${msg}`,
      { filePath, cause: msg },
    );
  }

  static diffFailed(workingDirectory: string, cause: unknown): GuardrailError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new GuardrailError(
      "GUARDRAIL.DIFF_FAILED",
      `Failed to compute git diff in ${workingDirectory}: ${msg}`,
      { workingDirectory, cause: msg },
    );
  }

  static restoreFailed(workingDirectory: string, cause: unknown): GuardrailError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new GuardrailError(
      "GUARDRAIL.RESTORE_FAILED",
      `Failed to restore worktree ${workingDirectory}: ${msg}`,
      { workingDirectory, cause: msg },
    );
  }

  static configInvalid(message: string): GuardrailError {
    return new GuardrailError("GUARDRAIL.CONFIG_INVALID", message);
  }
}
