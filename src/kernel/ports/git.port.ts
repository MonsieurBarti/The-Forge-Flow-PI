import type { GitError } from "@kernel/errors";
import type { Result } from "@kernel/result";
import type { GitLogEntry, GitStatus } from "./git.schemas";

export abstract class GitPort {
  abstract listBranches(pattern: string): Promise<Result<string[], GitError>>;
  abstract createBranch(name: string, base: string): Promise<Result<void, GitError>>;
  abstract showFile(branch: string, path: string): Promise<Result<string | null, GitError>>;
  abstract log(branch: string, limit?: number): Promise<Result<GitLogEntry[], GitError>>;
  abstract status(): Promise<Result<GitStatus, GitError>>;
  abstract commit(message: string, paths: string[]): Promise<Result<string, GitError>>;
}
