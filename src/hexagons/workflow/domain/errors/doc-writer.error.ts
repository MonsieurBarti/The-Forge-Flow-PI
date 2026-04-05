import { WorkflowBaseError } from "./workflow-base.error";

export class DocWriterError extends WorkflowBaseError {
  readonly code: string;

  private constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = code;
  }

  static dispatchFailed(docType: string, cause: unknown): DocWriterError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new DocWriterError(
      "DOC_WRITER.DISPATCH_FAILED",
      `Failed to dispatch doc-writer agent for "${docType}": ${msg}`,
      { docType, cause: msg },
    );
  }

  static parseFailed(docType: string): DocWriterError {
    return new DocWriterError(
      "DOC_WRITER.PARSE_FAILED",
      `Doc-writer agent returned empty output for "${docType}"`,
      { docType },
    );
  }
}
