import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitCliAdapter } from "./git-cli.adapter";

describe("GitCliAdapter — guardrail methods", () => {
  let repoDir: string;
  let adapter: GitCliAdapter;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "git-guardrail-"));
    execSync("git init && git commit --allow-empty -m init", { cwd: repoDir });
    adapter = new GitCliAdapter(repoDir);
  });

  afterEach(() => {
    execSync(`rm -rf "${repoDir}"`);
  });

  describe("diffNameOnly", () => {
    it("returns empty array when working tree is clean", async () => {
      const result = await adapter.diffNameOnly(repoDir);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toEqual([]);
    });

    it("returns changed file paths", async () => {
      writeFileSync(join(repoDir, "tracked.txt"), "initial");
      execSync("git add tracked.txt && git commit -m 'add tracked'", { cwd: repoDir });
      writeFileSync(join(repoDir, "tracked.txt"), "modified");
      const result = await adapter.diffNameOnly(repoDir);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toEqual(["tracked.txt"]);
    });
  });

  describe("diff", () => {
    it("returns empty string when clean", async () => {
      const result = await adapter.diff(repoDir);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toBe("");
    });

    it("returns unified diff", async () => {
      writeFileSync(join(repoDir, "file.txt"), "before");
      execSync("git add file.txt && git commit -m 'add file'", { cwd: repoDir });
      writeFileSync(join(repoDir, "file.txt"), "after");
      const result = await adapter.diff(repoDir);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toContain("-before");
        expect(result.data).toContain("+after");
      }
    });
  });

  describe("restoreWorktree", () => {
    it("discards uncommitted changes to tracked files", async () => {
      writeFileSync(join(repoDir, "file.txt"), "original");
      execSync("git add file.txt && git commit -m 'add file'", { cwd: repoDir });
      writeFileSync(join(repoDir, "file.txt"), "dirty");

      const result = await adapter.restoreWorktree(repoDir);
      expect(result.ok).toBe(true);

      const statusResult = await adapter.statusAt(repoDir);
      expect(statusResult.ok).toBe(true);
      if (statusResult.ok) expect(statusResult.data.clean).toBe(true);
    });

    it("preserves untracked files", async () => {
      writeFileSync(join(repoDir, "untracked.txt"), "keep me");
      const result = await adapter.restoreWorktree(repoDir);
      expect(result.ok).toBe(true);

      const statusResult = await adapter.statusAt(repoDir);
      expect(statusResult.ok).toBe(true);
      if (statusResult.ok) {
        const untracked = statusResult.data.entries.find((e) => e.path === "untracked.txt");
        expect(untracked).toBeDefined();
        expect(untracked?.status).toBe("untracked");
      }
    });
  });
});
