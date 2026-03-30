import type { Result } from "@kernel";
import type { WorktreeError } from "../errors/worktree.error";
import type { WorktreeHealth, WorktreeInfo } from "../worktree.schemas";

export abstract class WorktreePort {
  abstract create(
    sliceId: string,
    baseBranch: string,
  ): Promise<Result<WorktreeInfo, WorktreeError>>;
  abstract delete(sliceId: string): Promise<Result<void, WorktreeError>>;
  abstract list(): Promise<Result<WorktreeInfo[], WorktreeError>>;
  abstract exists(sliceId: string): Promise<boolean>;
  abstract validate(sliceId: string): Promise<Result<WorktreeHealth, WorktreeError>>;
}
