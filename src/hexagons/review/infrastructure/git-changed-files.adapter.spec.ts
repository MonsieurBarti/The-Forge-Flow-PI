import { err, isErr, isOk, ok, type Result } from "@kernel";
import { GitError } from "@kernel/errors";
import type { GitPort } from "@kernel/ports";
import { describe, expect, it } from "vitest";
import { GitChangedFilesAdapter } from "./git-changed-files.adapter";

type DiffResult = Result<string, GitError>;

// Minimal stub for GitPort — only need diffAgainst
class StubGitPort implements Pick<GitPort, "diffAgainst"> {
  private _result: DiffResult = ok("");
  givenDiffResult(result: DiffResult) {
    this._result = result;
  }
  async diffAgainst(_base: string, _cwd: string): Promise<DiffResult> {
    return this._result;
  }
}

describe("GitChangedFilesAdapter", () => {
  it("returns diff string on success", async () => {
    const gitPort = new StubGitPort();
    gitPort.givenDiffResult(ok("diff --git a/foo.ts b/foo.ts\n+added line"));
    const resolveBranch = () => "milestone/M05";
    const adapter = new GitChangedFilesAdapter(gitPort as unknown as GitPort, resolveBranch);
    const result = await adapter.getDiff("slice-1", "/tmp/work");
    expect(isOk(result)).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data).toContain("foo.ts");
  });

  it("returns ChangedFilesError on git failure", async () => {
    const gitPort = new StubGitPort();
    gitPort.givenDiffResult(err(new GitError("COMMAND_FAILED", "git diff failed")));
    const adapter = new GitChangedFilesAdapter(
      gitPort as unknown as GitPort,
      () => "milestone/M05",
    );
    const result = await adapter.getDiff("slice-1", "/tmp/work");
    expect(isErr(result)).toBe(true);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("REVIEW.CHANGED_FILES_FAILED");
  });

  it("passes correct base branch to gitPort", async () => {
    let capturedBase = "";
    let capturedCwd = "";
    const gitPort: Pick<GitPort, "diffAgainst"> = {
      async diffAgainst(base: string, cwd: string) {
        capturedBase = base;
        capturedCwd = cwd;
        return ok("");
      },
    };
    const adapter = new GitChangedFilesAdapter(
      gitPort as unknown as GitPort,
      () => "milestone/M05",
    );
    await adapter.getDiff("slice-1", "/work/dir");
    expect(capturedBase).toBe("milestone/M05");
    expect(capturedCwd).toBe("/work/dir");
  });
});
