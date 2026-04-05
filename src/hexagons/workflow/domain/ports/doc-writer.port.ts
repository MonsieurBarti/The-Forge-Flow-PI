import type { Result } from "@kernel";
import type { DocWriterError } from "../../domain/errors/doc-writer.error";

export type DocType = "architecture" | "conventions" | "stack" | "concerns";

export abstract class DocWriterPort {
  abstract generateDoc(params: {
    docType: DocType;
    workingDirectory: string;
    existingContent?: string;
    diffContent?: string;
  }): Promise<Result<string, DocWriterError>>;
}
