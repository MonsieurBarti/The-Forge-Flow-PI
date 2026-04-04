import { SyncError } from "@kernel/errors";
import { ok, err, type Result } from "@kernel/result";
import type { GitPort } from "@kernel/ports/git.port";
import type { StateBranchOpsPort } from "@kernel/ports/state-branch-ops.port";
import type { DoctorService } from "./doctor-service";
import type { RestoreStateUseCase } from "./restore-state.use-case";
import { BranchMetaSchema, type BranchMeta } from "@kernel/infrastructure/state-branch/state-snapshot.schemas";
import type { RenameDetectionResult } from "@kernel/schemas/rename-detection.schemas";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

      // 6. Disambiguate using 3-way detection
      const detection = await this.disambiguate(meta, currentBranch);
      switch (detection.kind) {
        case "match":
          return ok(undefined);
        case "untracked":
          return ok(undefined);
        case "rename":
          return this.handleRename(meta, currentBranch, tffDir);
        case "switch":
          return this.tryRestore(currentBranch);
      }
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

  private async disambiguate(
    meta: BranchMeta,
    currentBranch: string,
  ): Promise<RenameDetectionResult> {
    const oldExists = await this.gitPort.branchExists(meta.codeBranch);
    const stateForCurrentResult = await this.stateBranchOps.branchExists(
      `tff-state/${currentBranch}`,
    );
    const stateForCurrentExists =
      stateForCurrentResult.ok && stateForCurrentResult.data;

    if (oldExists.ok && oldExists.data) {
      // Old branch still exists
      return stateForCurrentExists
        ? { kind: "switch" }
        : { kind: "untracked" };
    }

    // Old branch gone
    if (!stateForCurrentExists) {
      return { kind: "rename", newBranch: currentBranch };
    }

    // Ambiguous: state exists for current AND old branch is gone
    // Compare stateId to resolve
    const remoteMetaResult = await this.stateBranchOps.readFromStateBranch(
      `tff-state/${currentBranch}`,
      "branch-meta.json",
    );
    if (remoteMetaResult.ok && remoteMetaResult.data) {
      try {
        const remoteMeta = BranchMetaSchema.parse(JSON.parse(remoteMetaResult.data));
        if (remoteMeta.stateId === meta.stateId) {
          return { kind: "rename", newBranch: currentBranch };
        }
      } catch {
        // Parse failure → treat as switch (safe fallback)
      }
    }

    // stateId mismatch or unreadable → switch (restore)
    return { kind: "switch" };
  }

  private async handleRename(
    meta: BranchMeta,
    newBranch: string,
    tffDir: string,
  ): Promise<Result<void, SyncError>> {
    const oldStateBranch = meta.stateBranch;
    const newStateBranch = `tff-state/${newBranch}`;

    const renameResult = await this.stateBranchOps.renameBranch(oldStateBranch, newStateBranch);
    if (!renameResult.ok) {
      return err(new SyncError("RENAME_FAILED", `Failed to rename state branch: ${renameResult.error.message}`));
    }

    // Update local branch-meta.json
    const updatedMeta: BranchMeta = {
      ...meta,
      codeBranch: newBranch,
      stateBranch: newStateBranch,
    };
    const metaPath = join(tffDir, "branch-meta.json");
    writeFileSync(metaPath, JSON.stringify(updatedMeta, null, 2), "utf-8");

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
