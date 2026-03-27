import type { ExecFileException } from "node:child_process";
import { execFile } from "node:child_process";
import { GitError } from "@kernel/errors/git.error";
import { GitPort } from "@kernel/ports/git.port";
import {
  type GitFileStatus,
  type GitLogEntry,
  GitLogEntrySchema,
  type GitStatus,
  type GitStatusEntry,
} from "@kernel/ports/git.schemas";
import { err, ok, type Result } from "@kernel/result";

export class GitCliAdapter extends GitPort {
  constructor(private readonly cwd: string) {
    super();
  }

  private cleanGitEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && !k.startsWith("GIT_")) env[k] = v;
    }
    return env;
  }

  private runGit(args: string[]): Promise<Result<string, GitError>> {
    return new Promise((resolve) => {
      execFile(
        "git",
        ["--no-pager", "-c", "color.ui=never", ...args],
        { cwd: this.cwd, encoding: "utf-8", env: this.cleanGitEnv() },
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
      msg.includes("invalid object name") ||
      msg.includes("not a valid object name")
    )
      return new GitError("REF_NOT_FOUND", msg);
    if (msg.includes("CONFLICT") || msg.includes("conflict")) return new GitError("CONFLICT", msg);
    return new GitError("COMMAND_FAILED", msg);
  }

  async listBranches(pattern: string): Promise<Result<string[], GitError>> {
    const result = await this.runGit(["branch", "--list", pattern, "--format=%(refname:short)"]);
    if (!result.ok) return result;
    const branches = result.data
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    return ok(branches);
  }

  async createBranch(name: string, base: string): Promise<Result<void, GitError>> {
    const result = await this.runGit(["branch", name, base]);
    if (!result.ok) return result;
    return ok(undefined);
  }

  async showFile(branch: string, path: string): Promise<Result<string | null, GitError>> {
    const result = await this.runGit(["show", `${branch}:${path}`]);
    if (!result.ok) {
      if (
        result.error.message.includes("does not exist in") ||
        (result.error.message.includes("path") && result.error.message.includes("does not exist"))
      )
        return ok(null);
      return result;
    }
    return ok(result.data);
  }

  async log(branch: string, limit = 20): Promise<Result<GitLogEntry[], GitError>> {
    const result = await this.runGit([
      "log",
      branch,
      "--format=%H%n%s%n%an%n%aI",
      "-n",
      String(limit),
    ]);
    if (!result.ok) return result;
    const lines = result.data.split("\n").filter(Boolean);
    const entries: GitLogEntry[] = [];
    try {
      for (let i = 0; i + 3 < lines.length; i += 4) {
        entries.push(
          GitLogEntrySchema.parse({
            hash: lines[i],
            message: lines[i + 1],
            author: lines[i + 2],
            date: lines[i + 3],
          }),
        );
      }
    } catch (_error: unknown) {
      return err(new GitError("COMMAND_FAILED", "Failed to parse git log output"));
    }
    return ok(entries);
  }

  async status(): Promise<Result<GitStatus, GitError>> {
    const result = await this.runGit(["status", "--porcelain=v1", "--branch"]);
    if (!result.ok) return result;
    const lines = result.data.split("\n").filter(Boolean);
    const branchLine = lines[0] ?? "## HEAD";
    let branch = branchLine.replace(/^##\s*/, "");
    if (branch.includes("(no branch)")) {
      branch = "HEAD";
    } else {
      branch = branch.split("...")[0];
    }
    const entries: GitStatusEntry[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const x = line[0];
      const y = line[1];
      let path = line.slice(3);
      if (x === "!" && y === "!") continue;
      const isConflict =
        x === "U" || y === "U" || (x === "D" && y === "D") || (x === "A" && y === "A");
      if (isConflict) {
        return err(new GitError("CONFLICT", `Merge conflict detected: ${path}`));
      }
      let status: GitFileStatus;
      if (x === "?" && y === "?") status = "untracked";
      else if (x === "A") status = "added";
      else if (x === "R") {
        status = "renamed";
        const arrowIdx = path.indexOf(" -> ");
        if (arrowIdx !== -1) path = path.slice(arrowIdx + 4);
      } else if (x === "D" || y === "D") status = "deleted";
      else if (x === "M" || y === "M") status = "modified";
      else continue;
      entries.push({ path, status });
    }
    return ok({ branch, clean: entries.length === 0, entries });
  }

  async commit(message: string, paths: string[]): Promise<Result<string, GitError>> {
    if (paths.length === 0) return err(new GitError("COMMAND_FAILED", "No paths to commit"));
    const addResult = await this.runGit(["add", ...paths]);
    if (!addResult.ok) return addResult;
    const commitResult = await this.runGit(["commit", "-m", message]);
    if (!commitResult.ok) return commitResult;
    const match = commitResult.data.match(/\[\S+\s+(?:\(root-commit\)\s+)?([a-f0-9]+)\]/);
    return ok(match ? match[1] : commitResult.data.trim());
  }
}
