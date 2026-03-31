import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { isOk } from "@kernel";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GitCliAdapter } from "./git-cli.adapter";

const exec = promisify(execFile);

describe("GitCliAdapter — worktree operations", () => {
  let repoDir: string;
  let adapter: GitCliAdapter;

  beforeAll(async () => {
    const raw = await mkdtemp(join(tmpdir(), "git-wt-test-"));
    repoDir = realpathSync(raw);
    await exec("git", ["init", repoDir]);
    await exec("git", ["-C", repoDir, "commit", "--allow-empty", "-m", "init"]);
    await exec("git", ["-C", repoDir, "checkout", "-b", "base-branch"]);
  });

  afterAll(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    adapter = new GitCliAdapter(repoDir);
  });

  it("worktreeAdd creates worktree and branch", async () => {
    const wtPath = join(repoDir, "wt-test-add");
    const result = await adapter.worktreeAdd(wtPath, "test-branch-add", "base-branch");
    expect(isOk(result)).toBe(true);
    await adapter.worktreeRemove(wtPath);
    await adapter.deleteBranch("test-branch-add", true);
  });

  it("worktreeAdd fails if branch already exists", async () => {
    const wtPath = join(repoDir, "wt-test-dup");
    await adapter.worktreeAdd(wtPath, "dup-branch", "base-branch");
    const result = await adapter.worktreeAdd(
      join(repoDir, "wt-test-dup2"),
      "dup-branch",
      "base-branch",
    );
    expect(isOk(result)).toBe(false);
    await adapter.worktreeRemove(wtPath);
    await adapter.deleteBranch("dup-branch", true);
  });

  it("worktreeList returns entries including main worktree", async () => {
    const result = await adapter.worktreeList();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.length).toBeGreaterThanOrEqual(1);
      expect(result.data[0].path).toBeTruthy();
    }
  });

  it("worktreeRemove removes worktree", async () => {
    const wtPath = join(repoDir, "wt-test-remove");
    await adapter.worktreeAdd(wtPath, "remove-branch", "base-branch");
    const result = await adapter.worktreeRemove(wtPath);
    expect(isOk(result)).toBe(true);
    await adapter.deleteBranch("remove-branch", true);
  });

  it("deleteBranch deletes a branch", async () => {
    await exec("git", ["-C", repoDir, "branch", "to-delete", "base-branch"]);
    const result = await adapter.deleteBranch("to-delete");
    expect(isOk(result)).toBe(true);
  });

  it("statusAt returns status for a different cwd", async () => {
    const wtPath = join(repoDir, "wt-test-status");
    await adapter.worktreeAdd(wtPath, "status-branch", "base-branch");
    const result = await adapter.statusAt(wtPath);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.branch).toBe("status-branch");
      expect(result.data.clean).toBe(true);
    }
    await adapter.worktreeRemove(wtPath);
    await adapter.deleteBranch("status-branch", true);
  });
});
