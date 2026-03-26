import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isErr, isOk } from "@kernel";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GitCliAdapter } from "./git-cli.adapter";

describe("GitCliAdapter", () => {
  let repoDir: string;
  let adapter: GitCliAdapter;

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "tff-git-test-"));
    execFileSync("git", ["init", "--initial-branch=main"], { cwd: repoDir });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: repoDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    writeFileSync(join(repoDir, "initial.txt"), "initial content");
    execFileSync("git", ["add", "initial.txt"], { cwd: repoDir });
    execFileSync("git", ["commit", "-m", "initial commit"], { cwd: repoDir });
    adapter = new GitCliAdapter(repoDir);
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    execFileSync("git", ["checkout", "main"], { cwd: repoDir });
    execFileSync("git", ["reset", "--hard", "HEAD"], { cwd: repoDir });
    execFileSync("git", ["clean", "-fd"], { cwd: repoDir });
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
});
