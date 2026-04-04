import { SyncError } from "@kernel/errors";
import { ok, err, type Result } from "@kernel/result";
import type { GitPort } from "@kernel/ports/git.port";
import type { StateBranchOpsPort } from "@kernel/ports/state-branch-ops.port";
import type { DoctorService } from "./doctor-service";
import type { RestoreStateUseCase } from "./restore-state.use-case";
import { BranchMetaSchema } from "@kernel/infrastructure/state-branch/state-snapshot.schemas";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export class BranchConsistencyGuard {
  constructor(
    private readonly doctor: DoctorService,
    private readonly gitPort: GitPort,
    private readonly restoreUseCase: RestoreStateUseCase,
    private readonly stateBranchOps: StateBranchOpsPort,
  ) {}

  async ensure(tffDir: string): Promise<Result<void, SyncError>> {
    // 1. Self-heal first
    await this.doctor.diagnoseAndFix(tffDir);

    // 2. Get current branch
    const branchResult = await this.gitPort.currentBranch();
    if (!branchResult.ok) return ok(undefined);
    const currentBranch = branchResult.data;

    // 3. Detached HEAD → skip
    if (currentBranch === null) return ok(undefined);

    // 4. Read branch-meta
    const metaPath = join(tffDir, "branch-meta.json");
    if (existsSync(metaPath)) {
      const meta = BranchMetaSchema.parse(JSON.parse(readFileSync(metaPath, "utf-8")));

      // 5. Match → ok
      if (meta.codeBranch === currentBranch) return ok(undefined);

      // 6. Mismatch → restore
      return this.tryRestore(currentBranch);
    }

    // 7. No meta — check if state branch exists for current branch
    const stateBranch = `tff-state/${currentBranch}`;
    const existsResult = await this.stateBranchOps.branchExists(stateBranch);
    if (existsResult.ok && existsResult.data) {
      return this.tryRestore(currentBranch);
    }

    // No state branch — ok (untracked branch)
    return ok(undefined);
  }

  private async tryRestore(targetBranch: string): Promise<Result<void, SyncError>> {
    const restoreResult = await this.restoreUseCase.execute(targetBranch);
    if (restoreResult.ok) return ok(undefined);

    const code = restoreResult.error.code;
    if (code === "SYNC.LOCK_CONTENTION" || code === "SYNC.BRANCH_NOT_FOUND") {
      // Non-fatal — proceed with existing state
      return ok(undefined);
    }

    return err(new SyncError("RESTORE_FAILED", restoreResult.error.message));
  }
}
