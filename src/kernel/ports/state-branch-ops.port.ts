import type { GitError } from "@kernel/errors";
import type { Result } from "@kernel/result";

export abstract class StateBranchOpsPort {
  abstract createOrphan(branchName: string): Promise<Result<void, GitError>>;
  abstract forkBranch(source: string, target: string): Promise<Result<void, GitError>>;
  abstract deleteBranch(branchName: string): Promise<Result<void, GitError>>;
  abstract branchExists(branchName: string): Promise<Result<boolean, GitError>>;
  abstract renameBranch(oldName: string, newName: string): Promise<Result<void, GitError>>;
  abstract syncToStateBranch(stateBranch: string, files: Map<string, string>): Promise<Result<string, GitError>>;
  abstract readFromStateBranch(stateBranch: string, path: string): Promise<Result<string | null, GitError>>;
  abstract readAllFromStateBranch(stateBranch: string): Promise<Result<Map<string, string>, GitError>>;
}
