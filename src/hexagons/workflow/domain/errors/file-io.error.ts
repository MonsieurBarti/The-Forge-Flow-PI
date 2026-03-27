import { WorkflowBaseError } from "./workflow-base.error";

export class FileIOError extends WorkflowBaseError {
  readonly code = "WORKFLOW.FILE_IO";

  constructor(message: string, cause?: unknown) {
    super(message, { cause });
  }
}
