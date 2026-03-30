import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { err, isOk, ok, type Result } from "@kernel";
import type { GitPort } from "@kernel/ports/git.port";
import { WorktreeError } from "../domain/errors/worktree.error";
import { WorktreePort } from "../domain/ports/worktree.port";
import type { WorktreeHealth, WorktreeInfo } from "../domain/worktree.schemas";

export class GitWorktreeAdapter extends WorktreePort {
  private readonly resolvedRoot: string;

  constructor(
    private readonly gitPort: GitPort,
    projectRoot: string,
  ) {
    super();
    this.resolvedRoot = resolve(projectRoot);
  }

  private branchFor(sliceId: string): string {
    return `slice/${sliceId}`;
  }

  private pathFor(sliceId: string): string {
    return join(this.resolvedRoot, ".tff", "worktrees", sliceId);
  }

  private baseBranchFor(sliceId: string): string {
    const milestone = sliceId.split("-")[0];
    return `milestone/${milestone}`;
  }

  async create(sliceId: string, baseBranch: string): Promise<Result<WorktreeInfo, WorktreeError>> {
    const branch = this.branchFor(sliceId);
    const wtPath = this.pathFor(sliceId);

    const result = await this.gitPort.worktreeAdd(wtPath, branch, baseBranch);
    if (!isOk(result)) {
      const msg = result.error.message;
      if (msg.includes("already exists")) {
        return err(WorktreeError.alreadyExists(sliceId));
      }
      return err(WorktreeError.creationFailed(sliceId, result.error));
    }

    return ok({ sliceId, branch, path: wtPath, baseBranch });
  }

  async delete(sliceId: string): Promise<Result<void, WorktreeError>> {
    if (!(await this.exists(sliceId))) {
      return err(WorktreeError.notFound(sliceId));
    }

    const wtPath = this.pathFor(sliceId);
    const removeResult = await this.gitPort.worktreeRemove(wtPath);
    if (!isOk(removeResult)) {
      return err(WorktreeError.deletionFailed(sliceId, removeResult.error));
    }

    const branch = this.branchFor(sliceId);
    const branchResult = await this.gitPort.deleteBranch(branch);
    if (!isOk(branchResult)) {
      return err(WorktreeError.deletionFailed(sliceId, branchResult.error));
    }

    return ok(undefined);
  }

  async list(): Promise<Result<WorktreeInfo[], WorktreeError>> {
    const result = await this.gitPort.worktreeList();
    if (!isOk(result)) {
      return err(WorktreeError.operationFailed("list", result.error));
    }

    const prefix = resolve(join(this.resolvedRoot, ".tff", "worktrees"));
    const worktrees: WorktreeInfo[] = [];

    for (const entry of result.data) {
      const resolvedPath = resolve(entry.path);
      if (!resolvedPath.startsWith(prefix)) continue;

      const sliceId = resolvedPath.slice(prefix.length + 1);
      if (!sliceId || sliceId.includes("/")) continue;

      worktrees.push({
        sliceId,
        branch: entry.branch ?? `slice/${sliceId}`,
        path: resolvedPath,
        baseBranch: "",
      });
    }

    return ok(worktrees);
  }

  async exists(sliceId: string): Promise<boolean> {
    const listResult = await this.list();
    if (!isOk(listResult)) return false;
    return listResult.data.some((w) => w.sliceId === sliceId);
  }

  async validate(sliceId: string): Promise<Result<WorktreeHealth, WorktreeError>> {
    if (!(await this.exists(sliceId))) {
      return err(WorktreeError.notFound(sliceId));
    }

    const wtPath = this.pathFor(sliceId);
    const branch = this.branchFor(sliceId);

    let dirExists = true;
    try {
      await access(wtPath);
    } catch {
      dirExists = false;
    }

    const branchResult = await this.gitPort.listBranches(branch);
    const branchValid = isOk(branchResult) && branchResult.data.includes(branch);

    let clean = true;
    if (dirExists) {
      const statusResult = await this.gitPort.statusAt(wtPath);
      if (isOk(statusResult)) {
        clean = statusResult.data.clean;
      }
    }

    let reachable = true;
    if (branchValid) {
      const baseBranch = this.baseBranchFor(sliceId);
      const ancestorResult = await this.gitPort.isAncestor(baseBranch, branch);
      if (isOk(ancestorResult)) {
        reachable = ancestorResult.data;
      }
    }

    return ok({ sliceId, exists: dirExists, branchValid, clean, reachable });
  }
}
