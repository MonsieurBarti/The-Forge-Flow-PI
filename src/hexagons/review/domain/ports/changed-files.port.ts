import type { Result } from "@kernel";
import type { ChangedFilesError } from "../errors/review-context.error";

export abstract class ChangedFilesPort {
  abstract getDiff(
    sliceId: string,
    workingDirectory: string,
  ): Promise<Result<string, ChangedFilesError>>;
}
