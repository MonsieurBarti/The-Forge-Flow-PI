import type { GitError } from "@kernel/errors";
import type { Result } from "@kernel/result";
import type { GitLogEntry, GitStatus, GitWorktreeEntry } from "./git.schemas";

export abstract class GitPort {
  abstract listBranches(pattern: string): Promise<Result<string[], GitError>>;
  abstract createBranch(name: string, base: string): Promise<Result<void, GitError>>;
  abstract showFile(branch: string, path: string): Promise<Result<string | null, GitError>>;
  abstract log(branch: string, limit?: number): Promise<Result<GitLogEntry[], GitError>>;
  abstract status(): Promise<Result<GitStatus, GitError>>;
  abstract commit(message: string, paths: string[]): Promise<Result<string, GitError>>;
  abstract revert(commitHash: string): Promise<Result<void, GitError>>;
  abstract isAncestor(ancestor: string, descendant: string): Promise<Result<boolean, GitError>>;
  abstract worktreeAdd(
    path: string,
    branch: string,
    baseBranch: string,
  ): Promise<Result<void, GitError>>;
  abstract worktreeRemove(path: string): Promise<Result<void, GitError>>;
  abstract worktreeList(): Promise<Result<GitWorktreeEntry[], GitError>>;
  abstract deleteBranch(name: string, force?: boolean): Promise<Result<void, GitError>>;
  abstract statusAt(cwd: string): Promise<Result<GitStatus, GitError>>;
  abstract diffNameOnly(cwd: string): Promise<Result<string[], GitError>>;
  abstract diff(cwd: string): Promise<Result<string, GitError>>;
  abstract diffAgainst(base: string, cwd: string): Promise<Result<string, GitError>>;
  abstract restoreWorktree(cwd: string): Promise<Result<void, GitError>>;
}
