import type { ExecFileException } from "node:child_process";
import { execFile } from "node:child_process";
import { GitError } from "@kernel/errors/git.error";
import { GitPort } from "@kernel/ports/git.port";
import type { GitLogEntry, GitStatus } from "@kernel/ports/git.schemas";
import { err, ok, type Result } from "@kernel/result";

export class GitCliAdapter extends GitPort {
  constructor(private readonly cwd: string) {
    super();
  }

  private runGit(args: string[]): Promise<Result<string, GitError>> {
    return new Promise((resolve) => {
      execFile(
        "git",
        ["--no-pager", "-c", "color.ui=never", ...args],
        { cwd: this.cwd, encoding: "utf-8" },
        (error, stdout, stderr) => {
          if (error) {
            resolve(err(this.mapError(error, stderr)));
            return;
          }
          resolve(ok(stdout));
        },
      );
    });
  }

  private mapError(error: ExecFileException, stderr: string): GitError {
    const msg = stderr.trim() || error.message;
    if (error.code === "ENOENT") return new GitError("NOT_FOUND", "git binary not found");
    if (msg.includes("not a git repository")) return new GitError("NOT_A_REPO", msg);
    if (
      msg.includes("did not match any") ||
      msg.includes("unknown revision") ||
      msg.includes("invalid object name")
    )
      return new GitError("REF_NOT_FOUND", msg);
    if (msg.includes("CONFLICT") || msg.includes("conflict")) return new GitError("CONFLICT", msg);
    return new GitError("COMMAND_FAILED", msg);
  }

  async listBranches(_pattern: string): Promise<Result<string[], GitError>> {
    throw new Error("Not implemented");
  }

  async createBranch(_name: string, _base: string): Promise<Result<void, GitError>> {
    throw new Error("Not implemented");
  }

  async showFile(_branch: string, _path: string): Promise<Result<string | null, GitError>> {
    throw new Error("Not implemented");
  }

  async log(_branch: string, _limit?: number): Promise<Result<GitLogEntry[], GitError>> {
    throw new Error("Not implemented");
  }

  async status(): Promise<Result<GitStatus, GitError>> {
    const result = await this.runGit(["status", "--porcelain=v1", "--branch"]);
    if (!result.ok) return result;
    return ok({ branch: "", clean: true, entries: [] });
  }

  async commit(_message: string, _paths: string[]): Promise<Result<string, GitError>> {
    throw new Error("Not implemented");
  }
}
