import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { isOk } from "@kernel";
import { GitCliAdapter } from "@kernel/infrastructure/git-cli.adapter";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GitWorktreeAdapter } from "./git-worktree.adapter";
import { runWorktreeContractTests } from "./worktree.contract.spec";

const exec = promisify(execFile);

describe("GitWorktreeAdapter", () => {
  let repoDir: string;
  let gitPort: GitCliAdapter;

  beforeAll(async () => {
    const raw = await mkdtemp(join(tmpdir(), "git-wt-adapter-"));
    repoDir = realpathSync(raw);
    await exec("git", ["init", repoDir]);
    await exec("git", ["-C", repoDir, "commit", "--allow-empty", "-m", "init"]);
    await exec("git", ["-C", repoDir, "checkout", "-b", "milestone/M04"]);
    gitPort = new GitCliAdapter(repoDir);
  });

  afterAll(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  runWorktreeContractTests("GitWorktreeAdapter", () => {
    const adapter = new GitWorktreeAdapter(gitPort, repoDir);
    return Object.assign(adapter, {
      reset: async () => {
        const listResult = await adapter.list();
        if (isOk(listResult)) {
          for (const wt of listResult.data) {
            await adapter.delete(wt.sliceId);
          }
        }
      },
    });
  });

  describe("baseBranchFor (via list)", () => {
    it("M07-S01 → milestone/M07", async () => {
      const adapter = new GitWorktreeAdapter(gitPort, repoDir);
      await adapter.create("M07-S01", "milestone/M04");
      const result = await adapter.list();
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        const wt = result.data.find((w) => w.sliceId === "M07-S01");
        expect(wt?.baseBranch).toBe("milestone/M07");
      }
      await adapter.delete("M07-S01");
    });

    it("Q-01 → main", async () => {
      const adapter = new GitWorktreeAdapter(gitPort, repoDir);
      await adapter.create("Q-01", "milestone/M04");
      const result = await adapter.list();
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        const wt = result.data.find((w) => w.sliceId === "Q-01");
        expect(wt?.baseBranch).toBe("main");
      }
      await adapter.delete("Q-01");
    });

    it("D-01 → main", async () => {
      const adapter = new GitWorktreeAdapter(gitPort, repoDir);
      await adapter.create("D-01", "milestone/M04");
      const result = await adapter.list();
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        const wt = result.data.find((w) => w.sliceId === "D-01");
        expect(wt?.baseBranch).toBe("main");
      }
      await adapter.delete("D-01");
    });
  });

  describe("adapter-specific", () => {
    it("validate detects missing directory (AC4)", async () => {
      const adapter = new GitWorktreeAdapter(gitPort, repoDir);
      await adapter.create("M04-S99", "milestone/M04");
      const wtPath = join(repoDir, ".tff", "worktrees", "M04-S99");
      await rm(wtPath, { recursive: true, force: true });

      const result = await adapter.validate("M04-S99");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data.exists).toBe(false);
      }

      // cleanup git metadata
      await exec("git", ["-C", repoDir, "worktree", "prune"]);
      await exec("git", ["-C", repoDir, "branch", "-D", "slice/M04-S99"]);
    });

    it("validate detects unreachable base (AC4)", async () => {
      const adapter = new GitWorktreeAdapter(gitPort, repoDir);
      // Create worktree on milestone/M04
      await adapter.create("M04-S98", "milestone/M04");

      // Reset the slice branch to an orphan commit unreachable from milestone/M04
      const wtPath = join(repoDir, ".tff", "worktrees", "M04-S98");
      await exec("git", ["-C", wtPath, "checkout", "--orphan", "orphan-tmp"]);
      await exec("git", ["-C", wtPath, "commit", "--allow-empty", "-m", "orphan"]);
      // Replace slice branch with the orphan
      await exec("git", ["-C", repoDir, "branch", "-M", "orphan-tmp", "slice/M04-S98"]);
      // Point worktree back to the renamed branch
      await exec("git", ["-C", wtPath, "checkout", "slice/M04-S98"]);

      const result = await adapter.validate("M04-S98");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data.reachable).toBe(false);
      }

      // cleanup
      await adapter.delete("M04-S98");
    });
  });
});
