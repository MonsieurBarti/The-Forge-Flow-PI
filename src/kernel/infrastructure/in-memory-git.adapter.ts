import { GitError } from "@kernel/errors/git.error";
import { GitPort } from "@kernel/ports/git.port";
import type { GitLogEntry, GitStatus, GitWorktreeEntry } from "@kernel/ports/git.schemas";
import { err, ok, type Result } from "@kernel/result";

/**
 * In-memory test double for GitPort.
 * Use given* methods to seed canned responses; use tracking properties to assert side-effects.
 */
export class InMemoryGitAdapter extends GitPort {
  // ── Tracking ──────────────────────────────────────────────────────────────
  restoreWorktreeCalls: string[] = [];
  revertCalls: string[] = [];

  // ── Configurable failure injection ────────────────────────────────────────
  revertFailAt: string | null = null;
  isAncestorResults = new Map<string, boolean>();

  // ── Seeded state ──────────────────────────────────────────────────────────
  private _diffFiles: string[] = [];
  private _diffContent = "";

  // ── Seed helpers ──────────────────────────────────────────────────────────
  givenDiffFiles(files: string[]): void {
    this._diffFiles = files;
  }

  givenDiffContent(content: string): void {
    this._diffContent = content;
  }

  reset(): void {
    this.restoreWorktreeCalls = [];
    this.revertCalls = [];
    this.revertFailAt = null;
    this.isAncestorResults = new Map<string, boolean>();
    this._diffFiles = [];
    this._diffContent = "";
  }

  // ── GitPort implementation ────────────────────────────────────────────────
  override listBranches(_pattern: string): Promise<Result<string[], GitError>> {
    return Promise.resolve(ok([]));
  }

  override createBranch(_name: string, _base: string): Promise<Result<void, GitError>> {
    return Promise.resolve(ok(undefined));
  }

  override showFile(_branch: string, _path: string): Promise<Result<string | null, GitError>> {
    return Promise.resolve(ok(null));
  }

  override log(_branch: string, _limit?: number): Promise<Result<GitLogEntry[], GitError>> {
    return Promise.resolve(ok([]));
  }

  override status(): Promise<Result<GitStatus, GitError>> {
    return Promise.resolve(ok({ branch: "test", clean: true, entries: [] }));
  }

  override commit(_message: string, _paths: string[]): Promise<Result<string, GitError>> {
    return Promise.resolve(ok("abc123"));
  }

  override revert(commitHash: string): Promise<Result<void, GitError>> {
    this.revertCalls.push(commitHash);
    if (this.revertFailAt === commitHash) {
      return Promise.resolve(err(new GitError("COMMAND_FAILED", "revert conflict")));
    }
    return Promise.resolve(ok(undefined));
  }

  override isAncestor(ancestor: string, descendant: string): Promise<Result<boolean, GitError>> {
    const key = `${ancestor}:${descendant}`;
    return Promise.resolve(ok(this.isAncestorResults.get(key) ?? true));
  }

  override worktreeAdd(
    _path: string,
    _branch: string,
    _baseBranch: string,
  ): Promise<Result<void, GitError>> {
    return Promise.resolve(ok(undefined));
  }

  override worktreeRemove(_path: string): Promise<Result<void, GitError>> {
    return Promise.resolve(ok(undefined));
  }

  override worktreeList(): Promise<Result<GitWorktreeEntry[], GitError>> {
    return Promise.resolve(ok([]));
  }

  override deleteBranch(_name: string, _force?: boolean): Promise<Result<void, GitError>> {
    return Promise.resolve(ok(undefined));
  }

  override statusAt(_cwd: string): Promise<Result<GitStatus, GitError>> {
    return Promise.resolve(ok({ branch: "test", clean: true, entries: [] }));
  }

  override diffNameOnly(_cwd: string): Promise<Result<string[], GitError>> {
    return Promise.resolve(ok(this._diffFiles));
  }

  override diff(_cwd: string): Promise<Result<string, GitError>> {
    return Promise.resolve(ok(this._diffContent));
  }

  override diffAgainst(_base: string, cwd: string): Promise<Result<string, GitError>> {
    return this.diff(cwd);
  }

  override restoreWorktree(cwd: string): Promise<Result<void, GitError>> {
    this.restoreWorktreeCalls.push(cwd);
    return Promise.resolve(ok(undefined));
  }

  override pushFrom(_cwd: string, _branch: string): Promise<Result<void, GitError>> {
    return Promise.resolve(ok(undefined));
  }

  private _currentBranch: string | null = "main";

  setCurrentBranch(branch: string | null): void {
    this._currentBranch = branch;
  }

  override currentBranch(): Promise<Result<string | null, GitError>> {
    return Promise.resolve(ok(this._currentBranch));
  }
}
