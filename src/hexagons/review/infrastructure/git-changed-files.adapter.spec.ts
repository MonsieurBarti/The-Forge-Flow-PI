import { err, isErr, isOk, type Result } from "@kernel";
import { GitError } from "@kernel/errors";
import { InMemoryGitAdapter } from "@kernel/infrastructure/in-memory-git.adapter";
import { describe, expect, it } from "vitest";
import { GitChangedFilesAdapter } from "./git-changed-files.adapter";

type DiffResult = Result<string, GitError>;

/**
 * Extends InMemoryGitAdapter with configurable diffAgainst error injection.
 * Needed because InMemoryGitAdapter.diffAgainst always returns ok (via diff).
 */
class StubGitAdapter extends InMemoryGitAdapter {
  private _diffAgainstResult: DiffResult | undefined;
  capturedBase = "";
  capturedCwd = "";

  givenDiffAgainstResult(result: DiffResult): void {
    this._diffAgainstResult = result;
  }

  override async diffAgainst(base: string, cwd: string): Promise<DiffResult> {
    this.capturedBase = base;
    this.capturedCwd = cwd;
    if (this._diffAgainstResult !== undefined) {
      return this._diffAgainstResult;
    }
    return super.diffAgainst(base, cwd);
  }
}

describe("GitChangedFilesAdapter", () => {
  it("returns diff string on success", async () => {
    const gitPort = new StubGitAdapter();
    gitPort.givenDiffContent("diff --git a/foo.ts b/foo.ts\n+added line");
    const resolveBranch = () => "milestone/M05";
    const adapter = new GitChangedFilesAdapter(gitPort, resolveBranch);
    const result = await adapter.getDiff("slice-1", "/tmp/work");
    expect(isOk(result)).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data).toContain("foo.ts");
  });

  it("returns ChangedFilesError on git failure", async () => {
    const gitPort = new StubGitAdapter();
    gitPort.givenDiffAgainstResult(err(new GitError("COMMAND_FAILED", "git diff failed")));
    const adapter = new GitChangedFilesAdapter(gitPort, () => "milestone/M05");
    const result = await adapter.getDiff("slice-1", "/tmp/work");
    expect(isErr(result)).toBe(true);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("REVIEW.CHANGED_FILES_FAILED");
  });

  it("passes correct base branch to gitPort", async () => {
    const gitPort = new StubGitAdapter();
    const adapter = new GitChangedFilesAdapter(gitPort, () => "milestone/M05");
    await adapter.getDiff("slice-1", "/work/dir");
    expect(gitPort.capturedBase).toBe("milestone/M05");
    expect(gitPort.capturedCwd).toBe("/work/dir");
  });
});
