import { err, ok, type Result } from "@kernel/result";
import { WorktreeError } from "@kernel/errors/worktree.error";
import { WorktreePort } from "@kernel/ports/worktree.port";
import type { WorktreeHealth, WorktreeInfo } from "@kernel/ports/worktree.schemas";

export class InMemoryWorktreeAdapter extends WorktreePort {
  private store = new Map<string, WorktreeInfo>();

  async create(sliceId: string, baseBranch: string): Promise<Result<WorktreeInfo, WorktreeError>> {
    if (this.store.has(sliceId)) return err(WorktreeError.alreadyExists(sliceId));
    const info: WorktreeInfo = {
      sliceId,
      branch: `slice/${sliceId}`,
      path: `/mock/.tff/worktrees/${sliceId}`,
      baseBranch,
    };
    this.store.set(sliceId, info);
    return ok(info);
  }

  async delete(sliceId: string): Promise<Result<void, WorktreeError>> {
    if (!this.store.has(sliceId)) return err(WorktreeError.notFound(sliceId));
    this.store.delete(sliceId);
    return ok(undefined);
  }

  async list(): Promise<Result<WorktreeInfo[], WorktreeError>> {
    return ok([...this.store.values()]);
  }

  async exists(sliceId: string): Promise<boolean> {
    return this.store.has(sliceId);
  }

  async validate(sliceId: string): Promise<Result<WorktreeHealth, WorktreeError>> {
    if (!this.store.has(sliceId)) return err(WorktreeError.notFound(sliceId));
    return ok({
      sliceId,
      exists: true,
      branchValid: true,
      clean: true,
      reachable: true,
    });
  }

  seed(info: WorktreeInfo): void {
    this.store.set(info.sliceId, info);
  }

  reset(): void {
    this.store.clear();
  }
}
