import { isOk, ok, type Result } from "@kernel";
import type { WorktreeError } from "@kernel/errors/worktree.error";
import type { WorktreePort } from "@kernel/ports/worktree.port";
import type { CleanupReport } from "@kernel/ports/worktree.schemas";
import type { SliceStatusProvider } from "../domain/ports/slice-status-provider.port";

export class CleanupOrphanedWorktreesUseCase {
  constructor(
    private readonly worktreePort: WorktreePort,
    private readonly sliceStatusProvider: SliceStatusProvider,
  ) {}

  async execute(): Promise<Result<CleanupReport, WorktreeError>> {
    const listResult = await this.worktreePort.list();
    if (!isOk(listResult)) return listResult;

    const report: CleanupReport = { deleted: [], skipped: [], errors: [] };

    for (const worktree of listResult.data) {
      const statusResult = await this.sliceStatusProvider.getStatus(worktree.sliceId);
      if (!isOk(statusResult)) {
        report.skipped.push(worktree.sliceId);
        continue;
      }
      if (statusResult.data !== "closed") {
        report.skipped.push(worktree.sliceId);
        continue;
      }
      const deleteResult = await this.worktreePort.delete(worktree.sliceId);
      if (isOk(deleteResult)) {
        report.deleted.push(worktree.sliceId);
      } else {
        report.errors.push({
          sliceId: worktree.sliceId,
          reason: deleteResult.error.message,
        });
      }
    }

    return ok(report);
  }
}
