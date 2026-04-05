import { rmSync } from "node:fs";
import { join } from "node:path";
import type { MilestoneRepositoryPort } from "@hexagons/milestone/domain/ports/milestone-repository.port";
import { err, ok, PersistenceError, type Result } from "@kernel";
import type { GitPort } from "@kernel/ports/git.port";
import type { StateBranchOpsPort } from "@kernel/ports/state-branch-ops.port";
import type { WorktreePort } from "@kernel/ports/worktree.port";
import type { SliceRepositoryPort } from "../domain/ports/slice-repository.port";
import { Slice } from "../domain/slice.aggregate";

const REMOVABLE_STATUSES = new Set(["discussing", "researching"]);

export interface RemoveSliceInput {
  sliceLabel: string;
}

export interface RemoveSliceOutput {
  removedSliceId: string;
  removedLabel: string;
  cleanupActions: string[];
}

export class RemoveSliceUseCase {
  constructor(
    private readonly sliceRepo: SliceRepositoryPort,
    private readonly worktreePort: WorktreePort,
    private readonly stateBranchOps: StateBranchOpsPort,
    private readonly gitPort: GitPort,
    private readonly milestoneRepo?: MilestoneRepositoryPort,
    private readonly tffDir?: string,
  ) {}

  async execute(input: RemoveSliceInput): Promise<Result<RemoveSliceOutput, PersistenceError>> {
    // 1. Find slice
    const findResult = await this.sliceRepo.findByLabel(input.sliceLabel);
    if (!findResult.ok) return err(findResult.error);
    if (!findResult.data) {
      return err(new PersistenceError(`Slice not found: ${input.sliceLabel}`));
    }
    const slice = findResult.data;

    // 2. Guard: only discussing or researching
    if (!REMOVABLE_STATUSES.has(slice.status)) {
      return err(
        new PersistenceError(
          `Cannot remove slice in status "${slice.status}". Only discussing or researching slices can be removed.`,
        ),
      );
    }

    const cleanupActions: string[] = [];

    // 3. Cleanup (best-effort)
    // Worktree
    if (await this.worktreePort.exists(slice.id)) {
      const wtResult = await this.worktreePort.delete(slice.id);
      if (wtResult.ok) cleanupActions.push("deleted worktree");
    }

    // State branch
    const stateBranch = `tff-state/slice/${slice.label}`;
    const sbExists = await this.stateBranchOps.branchExists(stateBranch);
    if (sbExists.ok && sbExists.data) {
      const sbResult = await this.stateBranchOps.deleteBranch(stateBranch);
      if (sbResult.ok) cleanupActions.push("deleted state branch");
    }

    // Code branch
    const codeBranch = `slice/${slice.label}`;
    const cbResult = await this.gitPort.deleteBranch(codeBranch);
    if (cbResult.ok) cleanupActions.push("deleted code branch");

    // Artifact directory
    if (this.tffDir && slice.milestoneId && this.milestoneRepo) {
      const msResult = await this.milestoneRepo.findById(slice.milestoneId);
      if (msResult.ok && msResult.data) {
        const artifactDir = join(
          this.tffDir,
          "milestones",
          msResult.data.label,
          "slices",
          slice.label,
        );
        try {
          rmSync(artifactDir, { recursive: true, force: true });
          cleanupActions.push("deleted artifact directory");
        } catch {
          // best-effort
        }
      }
    }

    // 4. Delete from repository
    const deleteResult = await this.sliceRepo.delete(slice.id);
    if (!deleteResult.ok) return err(deleteResult.error);
    cleanupActions.push("deleted slice record");

    // 5. Recompact positions
    if (slice.milestoneId) {
      const siblingsResult = await this.sliceRepo.findByMilestoneId(slice.milestoneId);
      if (siblingsResult.ok) {
        const sorted = siblingsResult.data.sort((a, b) => a.position - b.position);
        for (let i = 0; i < sorted.length; i++) {
          if (sorted[i].position !== i) {
            const props = sorted[i].toJSON();
            props.position = i;
            const recompacted = Slice.reconstitute(props);
            await this.sliceRepo.save(recompacted);
          }
        }
      }
    }

    return ok({
      removedSliceId: slice.id,
      removedLabel: slice.label,
      cleanupActions,
    });
  }
}
