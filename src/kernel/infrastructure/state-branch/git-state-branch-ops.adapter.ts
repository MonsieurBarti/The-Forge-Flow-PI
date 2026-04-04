import type { ExecFileException } from "node:child_process";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GitError } from "@kernel/errors/git.error";
import { StateBranchOpsPort } from "@kernel/ports/state-branch-ops.port";
import { err, ok, type Result } from "@kernel/result";

export class GitStateBranchOpsAdapter extends StateBranchOpsPort {
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

  private runGit(
    args: string[],
    opts?: { cwd?: string },
  ): Promise<Result<string, GitError>> {
    const cwd = opts?.cwd ?? this.cwd;

    return new Promise((resolve) => {
      execFile(
        "git",
        ["--no-pager", "-c", "color.ui=never", ...args],
        { cwd, env: this.cleanGitEnv(), encoding: "utf-8" },
        (error: ExecFileException | null, stdout: string, stderr: string) => {
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
    return new GitError("COMMAND_FAILED", msg);
  }

  private makeTmpPath(): string {
    return path.join(os.tmpdir(), `tff-state-wt-${randomUUID().slice(0, 8)}`);
  }

  async branchExists(branchName: string): Promise<Result<boolean, GitError>> {
    const result = await this.runGit(["rev-parse", "--verify", `refs/heads/${branchName}`]);
    if (result.ok) return ok(true);
    const msg = result.error.message;
    if (
      msg.includes("not a valid") ||
      msg.includes("Needed a single revision") ||
      result.error.code === "GIT.REF_NOT_FOUND"
    ) {
      return ok(false);
    }
    return result;
  }

  async deleteBranch(branchName: string): Promise<Result<void, GitError>> {
    const result = await this.runGit(["branch", "-D", branchName]);
    if (!result.ok) return result;
    return ok(undefined);
  }

  async forkBranch(source: string, target: string): Promise<Result<void, GitError>> {
    const result = await this.runGit(["branch", target, source]);
    if (!result.ok) return result;
    return ok(undefined);
  }

  async renameBranch(oldName: string, newName: string): Promise<Result<void, GitError>> {
    const result = await this.runGit(["branch", "-m", oldName, newName]);
    if (!result.ok) return result;
    return ok(undefined);
  }

  async createOrphan(branchName: string): Promise<Result<void, GitError>> {
    const tmpPath = this.makeTmpPath();

    const addResult = await this.runGit(["worktree", "add", "--detach", tmpPath]);
    if (!addResult.ok) return addResult;

    try {
      const checkoutResult = await this.runGit(["checkout", "--orphan", branchName], {
        cwd: tmpPath,
      });
      if (!checkoutResult.ok) return checkoutResult;

      const rmResult = await this.runGit(["rm", "-rf", "--cached", "."], { cwd: tmpPath });
      if (!rmResult.ok) return rmResult;

      const commitResult = await this.runGit(
        ["commit", "--allow-empty", "-m", "init: orphan branch"],
        { cwd: tmpPath },
      );
      if (!commitResult.ok) return commitResult;

      return ok(undefined);
    } finally {
      await this.runGit(["worktree", "remove", "--force", tmpPath]);
    }
  }

  async syncToStateBranch(
    stateBranch: string,
    files: Map<string, string>,
  ): Promise<Result<string, GitError>> {
    const tmpPath = this.makeTmpPath();

    const addResult = await this.runGit(["worktree", "add", tmpPath, stateBranch]);
    if (!addResult.ok) return addResult;

    try {
      for (const [filePath, content] of files) {
        if (filePath.includes("..")) {
          return err(new GitError("INVALID_PATH", `Path traversal detected in path: ${filePath}`));
        }
        const fullPath = path.join(tmpPath, filePath);
        await mkdir(path.dirname(fullPath), { recursive: true });
        await writeFile(fullPath, content);
      }

      const stageResult = await this.runGit(["add", "-A"], { cwd: tmpPath });
      if (!stageResult.ok) return stageResult;

      const commitResult = await this.runGit(["commit", "-m", "sync: state update"], {
        cwd: tmpPath,
      });
      if (!commitResult.ok) return commitResult;

      const match = commitResult.data.match(
        /\[[\w/.-]+\s+(?:\(root-commit\)\s+)?([a-f0-9]+)\]/,
      );
      const sha = match ? match[1] : commitResult.data.trim();
      return ok(sha);
    } finally {
      await this.runGit(["worktree", "remove", "--force", tmpPath]);
    }
  }

  async readFromStateBranch(
    stateBranch: string,
    filePath: string,
  ): Promise<Result<string | null, GitError>> {
    if (filePath.includes("..")) {
      return err(new GitError("INVALID_PATH", `Path traversal detected in path: ${filePath}`));
    }
    const result = await this.runGit(["show", `${stateBranch}:${filePath}`]);
    if (!result.ok) {
      const msg = result.error.message;
      if (
        msg.includes("does not exist in") ||
        msg.includes("path '") ||
        result.error.code === "GIT.REF_NOT_FOUND"
      ) {
        return ok(null);
      }
      return result;
    }
    return ok(result.data);
  }

  async readAllFromStateBranch(
    stateBranch: string,
  ): Promise<Result<Map<string, string>, GitError>> {
    const lsResult = await this.runGit(["ls-tree", "-r", "--name-only", stateBranch]);
    if (!lsResult.ok) return lsResult;

    const paths = lsResult.data
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    for (const p of paths) {
      if (p.includes("..")) {
        return err(new GitError("INVALID_PATH", `Path traversal detected in path: ${p}`));
      }
    }

    const result = new Map<string, string>();
    for (const p of paths) {
      const readResult = await this.readFromStateBranch(stateBranch, p);
      if (!readResult.ok) return readResult;
      if (readResult.data !== null) {
        result.set(p, readResult.data);
      }
    }

    return ok(result);
  }
}
