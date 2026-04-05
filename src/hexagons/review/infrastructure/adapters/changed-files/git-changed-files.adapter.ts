import { err, ok, type Result } from "@kernel";
import type { GitPort } from "@kernel/ports";
import { ChangedFilesError } from "../../../domain/errors/review-context.error";
import { ChangedFilesPort } from "../../../domain/ports/changed-files.port";

export class GitChangedFilesAdapter extends ChangedFilesPort {
  constructor(
    private readonly gitPort: GitPort,
    private readonly resolveMilestoneBranch: (sliceId: string) => string,
  ) {
    super();
  }

  async getDiff(
    sliceId: string,
    workingDirectory: string,
  ): Promise<Result<string, ChangedFilesError>> {
    const base = this.resolveMilestoneBranch(sliceId);
    const result = await this.gitPort.diffAgainst(base, workingDirectory);
    if (!result.ok) {
      return err(
        new ChangedFilesError(`Failed to get diff for slice ${sliceId}`, {
          sliceId,
          cause: result.error.message,
        }),
      );
    }
    return ok(result.data);
  }
}
