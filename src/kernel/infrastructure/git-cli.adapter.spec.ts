import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GitCliAdapter } from "./git-cli.adapter";
import { InMemoryGitAdapter } from "./in-memory-git.adapter";

const exec = promisify(execFile);

describe("GitCliAdapter.currentBranch()", () => {
  let repoDir: string;
  let adapter: GitCliAdapter;

  beforeAll(async () => {
    const raw = await mkdtemp(join(tmpdir(), "git-cli-adapter-"));
    repoDir = realpathSync(raw);
    await exec("git", ["init", repoDir]);
    await exec("git", ["-C", repoDir, "config", "user.email", "test@test.com"]);
    await exec("git", ["-C", repoDir, "config", "user.name", "Test"]);
    await exec("git", ["-C", repoDir, "commit", "--allow-empty", "-m", "init"]);
    await exec("git", ["-C", repoDir, "checkout", "-b", "slice/M07-S03"]);
    adapter = new GitCliAdapter(repoDir);
  });

  afterAll(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it("returns the current branch name", async () => {
    const result = await adapter.currentBranch();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe("slice/M07-S03");
    }
  });

  it("returns null when HEAD is detached", async () => {
    // Get the current commit hash to detach HEAD
    const { stdout } = await exec("git", ["-C", repoDir, "rev-parse", "HEAD"]);
    const hash = stdout.trim();
    await exec("git", ["-C", repoDir, "checkout", "--detach", hash]);

    const result = await adapter.currentBranch();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeNull();
    }

    // Re-attach to branch for cleanup
    await exec("git", ["-C", repoDir, "checkout", "slice/M07-S03"]);
  });
});

describe("InMemoryGitAdapter.currentBranch()", () => {
  it("returns 'main' by default", async () => {
    const adapter = new InMemoryGitAdapter();
    const result = await adapter.currentBranch();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe("main");
    }
  });

  it("returns the branch set via setCurrentBranch()", async () => {
    const adapter = new InMemoryGitAdapter();
    adapter.setCurrentBranch("slice/M07-S03");
    const result = await adapter.currentBranch();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe("slice/M07-S03");
    }
  });

  it("returns null when setCurrentBranch(null) is called", async () => {
    const adapter = new InMemoryGitAdapter();
    adapter.setCurrentBranch(null);
    const result = await adapter.currentBranch();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeNull();
    }
  });
});
