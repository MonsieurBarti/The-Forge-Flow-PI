import { SyncError } from "@kernel/errors";
import type { GitPort } from "@kernel/ports/git.port";
import type { StateSyncPort } from "@kernel/ports/state-sync.port";
import { err, type Result } from "@kernel/result";
import type { RestoreReport, RestoreStateUseCase } from "./restore-state.use-case";

export class ForceSyncUseCase {
  constructor(
    private readonly stateSync: StateSyncPort,
    private readonly restoreUseCase: RestoreStateUseCase,
    private readonly gitPort: GitPort,
  ) {}

  async push(tffDir: string): Promise<Result<void, SyncError>> {
    const branchResult = await this.gitPort.currentBranch();
    if (!branchResult.ok) {
      return err(new SyncError("GIT_ERROR", branchResult.error.message));
    }
    const branch = branchResult.data;
    if (branch === null) {
      return err(new SyncError("DETACHED_HEAD", "Cannot sync: HEAD is detached"));
    }
    return this.stateSync.syncToStateBranch(branch, tffDir);
  }

  async pull(_tffDir: string): Promise<Result<RestoreReport, SyncError>> {
    const branchResult = await this.gitPort.currentBranch();
    if (!branchResult.ok) {
      return err(new SyncError("GIT_ERROR", branchResult.error.message));
    }
    const branch = branchResult.data;
    if (branch === null) {
      return err(new SyncError("DETACHED_HEAD", "Cannot sync: HEAD is detached"));
    }
    return this.restoreUseCase.execute(branch);
  }
}
