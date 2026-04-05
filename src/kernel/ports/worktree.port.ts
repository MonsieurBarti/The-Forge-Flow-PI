import type { WorktreeError } from "@kernel/errors/worktree.error";
import type { Result } from "@kernel/result";
import type { BranchMeta } from "@kernel/schemas/branch-meta.schemas";
import type { WorktreeHealth, WorktreeInfo } from "./worktree.schemas";

export abstract class WorktreePort {
  abstract create(
    sliceId: string,
    baseBranch: string,
  ): Promise<Result<WorktreeInfo, WorktreeError>>;
  abstract delete(sliceId: string): Promise<Result<void, WorktreeError>>;
  abstract list(): Promise<Result<WorktreeInfo[], WorktreeError>>;
  abstract exists(sliceId: string): Promise<boolean>;
  abstract validate(sliceId: string): Promise<Result<WorktreeHealth, WorktreeError>>;
  abstract initializeWorkspace(
    sliceId: string,
    sourceTffDir: string,
    branchMeta: BranchMeta,
  ): Promise<Result<void, WorktreeError>>;
  abstract resolveTffDir(sliceId: string): string;
}
