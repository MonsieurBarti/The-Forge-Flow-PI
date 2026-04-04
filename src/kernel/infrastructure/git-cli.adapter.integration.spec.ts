import type { ExecFileSyncOptions } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isErr, isOk } from "@kernel";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GitCliAdapter } from "./git-cli.adapter";

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith("GIT_")) env[k] = v;
  }
  return env;
}

function git(args: string[], repoDir: string, opts?: ExecFileSyncOptions): string {
  return execFileSync("git", args, {
    cwd: repoDir,
    encoding: "utf-8",
    env: cleanEnv(),
    ...opts,
  }) as string;
}

describe("GitCliAdapter", () => {
  let repoDir: string;
  let adapter: GitCliAdapter;

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "tff-git-test-"));
    git(["init", "--initial-branch=main"], repoDir);
    git(["config", "user.name", "Test User"], repoDir);
    git(["config", "user.email", "test@example.com"], repoDir);
    git(["config", "core.hooksPath", "/dev/null"], repoDir);
    writeFileSync(join(repoDir, "initial.txt"), "initial content");
    git(["add", "initial.txt"], repoDir);
    git(["commit", "-m", "initial commit"], repoDir);
    adapter = new GitCliAdapter(repoDir);
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    git(["checkout", "main"], repoDir);
    git(["reset", "--hard", "HEAD"], repoDir);
    git(["clean", "-fd"], repoDir);
    const branches = git(["branch", "--format=%(refname:short)"], repoDir)
      .split("\n")
      .filter((b) => b.trim() && b.trim() !== "main");
    for (const branch of branches) {
      git(["branch", "-D", branch.trim()], repoDir);
    }
  });

  describe("runGit + error mapping", () => {
    it("returns NOT_A_REPO error for non-git directory", async () => {
      const nonGitDir = mkdtempSync(join(tmpdir(), "tff-nongit-"));
      const badAdapter = new GitCliAdapter(nonGitDir);
      const result = await badAdapter.status();
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe("GIT.NOT_A_REPO");
      }
      rmSync(nonGitDir, { recursive: true, force: true });
    });

    it("succeeds for valid git repository", async () => {
      const result = await adapter.status();
      expect(isOk(result)).toBe(true);
    });
  });

  describe("status", () => {
    it("reports clean repo", async () => {
      const result = await adapter.status();
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data.branch).toBe("main");
        expect(result.data.clean).toBe(true);
        expect(result.data.entries).toEqual([]);
      }
    });

    it("reports modified file", async () => {
      writeFileSync(join(repoDir, "initial.txt"), "modified content");
      const result = await adapter.status();
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data.clean).toBe(false);
        expect(result.data.entries).toContainEqual({ path: "initial.txt", status: "modified" });
      }
    });

    it("reports untracked file", async () => {
      writeFileSync(join(repoDir, "untracked.txt"), "new file");
      const result = await adapter.status();
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data.entries).toContainEqual({ path: "untracked.txt", status: "untracked" });
      }
    });
  });

  describe("commit", () => {
    it("commits files and returns short hash", async () => {
      writeFileSync(join(repoDir, "commit-test.txt"), "commit content");
      const result = await adapter.commit("test commit", ["commit-test.txt"]);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toMatch(/^[a-f0-9]+$/);
      }
    });

    it("returns COMMAND_FAILED for empty paths", async () => {
      const result = await adapter.commit("no paths", []);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe("GIT.COMMAND_FAILED");
      }
    });
  });

  describe("listBranches", () => {
    it("returns main branch", async () => {
      const result = await adapter.listBranches("*");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toContain("main");
      }
    });

    it("returns matching branches for pattern", async () => {
      git(["branch", "feature/test", "main"], repoDir);
      const result = await adapter.listBranches("feature/*");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toEqual(["feature/test"]);
      }
    });

    it("returns empty array for no matches", async () => {
      const result = await adapter.listBranches("nonexistent/*");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toEqual([]);
      }
    });
  });

  describe("createBranch", () => {
    it("creates branch from base", async () => {
      const result = await adapter.createBranch("new-branch", "main");
      expect(isOk(result)).toBe(true);
      const branches = await adapter.listBranches("new-branch");
      if (isOk(branches)) {
        expect(branches.data).toContain("new-branch");
      }
    });

    it("returns REF_NOT_FOUND for invalid base", async () => {
      const result = await adapter.createBranch("bad-branch", "nonexistent-ref");
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe("GIT.REF_NOT_FOUND");
      }
    });
  });

  describe("showFile", () => {
    it("returns file content from branch", async () => {
      const result = await adapter.showFile("main", "initial.txt");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toBe("initial content");
      }
    });

    it("returns null for missing file", async () => {
      const result = await adapter.showFile("main", "nonexistent.txt");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toBeNull();
      }
    });

    it("returns REF_NOT_FOUND for invalid branch", async () => {
      const result = await adapter.showFile("nonexistent-branch", "initial.txt");
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe("GIT.REF_NOT_FOUND");
      }
    });
  });

  describe("log", () => {
    it("returns commit entries with hash, message, author, date", async () => {
      const result = await adapter.log("main");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data.length).toBeGreaterThanOrEqual(1);
        const entry = result.data[result.data.length - 1];
        expect(entry.hash).toMatch(/^[a-f0-9]{40}$/);
        expect(entry.message).toBe("initial commit");
        expect(entry.author).toBe("Test User");
        expect(entry.date).toBeInstanceOf(Date);
      }
    });

    it("respects limit parameter", async () => {
      writeFileSync(join(repoDir, "second.txt"), "second");
      git(["add", "second.txt"], repoDir);
      git(["commit", "-m", "second commit"], repoDir);
      const result = await adapter.log("main", 1);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].message).toBe("second commit");
      }
    });

    it("returns REF_NOT_FOUND for unknown branch", async () => {
      const result = await adapter.log("nonexistent-branch");
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe("GIT.REF_NOT_FOUND");
      }
    });
  });

  describe("revert", () => {
    it("reverts a commit", async () => {
      writeFileSync(join(repoDir, "revert-test.txt"), "content");
      git(["add", "revert-test.txt"], repoDir);
      git(["commit", "-m", "add revert-test"], repoDir);
      const logResult = await adapter.log("HEAD", 1);
      expect(isOk(logResult)).toBe(true);
      const hash = isOk(logResult) ? logResult.data[0].hash : "";
      const result = await adapter.revert(hash);
      expect(isOk(result)).toBe(true);
    });

    it("returns error for invalid commit hash", async () => {
      const result = await adapter.revert("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
      expect(isErr(result)).toBe(true);
    });
  });

  describe("isAncestor", () => {
    it("returns true when commit is ancestor", async () => {
      writeFileSync(join(repoDir, "ancestor-test.txt"), "content");
      git(["add", "ancestor-test.txt"], repoDir);
      git(["commit", "-m", "ancestor test"], repoDir);
      const logResult = await adapter.log("HEAD", 2);
      expect(isOk(logResult)).toBe(true);
      if (isOk(logResult) && logResult.data.length >= 2) {
        const child = logResult.data[0];
        const parent = logResult.data[1];
        const result = await adapter.isAncestor(parent.hash, child.hash);
        expect(isOk(result)).toBe(true);
        if (isOk(result)) expect(result.data).toBe(true);
      }
    });

    it("returns false when commit is not ancestor", async () => {
      const logResult = await adapter.log("HEAD", 2);
      expect(isOk(logResult)).toBe(true);
      if (isOk(logResult) && logResult.data.length >= 2) {
        const child = logResult.data[0];
        const parent = logResult.data[1];
        const result = await adapter.isAncestor(child.hash, parent.hash);
        expect(isOk(result)).toBe(true);
        if (isOk(result)) expect(result.data).toBe(false);
      }
    });
  });

  describe("branchExists", () => {
    it("returns true for existing branch", async () => {
      const result = await adapter.branchExists("main");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.data).toBe(true);
    });

    it("returns false for non-existent branch", async () => {
      const result = await adapter.branchExists("no-such-branch-xyz");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.data).toBe(false);
    });
  });
});
