import type { GitError } from "@kernel/errors";
import { SyncError } from "@kernel/errors";
import type { SyncOptions } from "@kernel/ports/state-sync.port";
import type { SyncReport } from "@kernel/ports/state-sync.schemas";
import { err, ok, type Result } from "@kernel/result";
import { describe, expect, it } from "vitest";
import { ForceSyncUseCase } from "./force-sync.use-case";
import type { RestoreReport } from "./restore-state.use-case";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

class StubStateSyncPort {
  calls: Array<[string, string]> = [];
  result: Result<void, SyncError> = ok(undefined);

  async syncToStateBranch(
    codeBranch: string,
    tffDir: string,
    _options?: SyncOptions,
  ): Promise<Result<void, SyncError>> {
    this.calls.push([codeBranch, tffDir]);
    return this.result;
  }

  async restoreFromStateBranch(): Promise<Result<SyncReport, SyncError>> {
    return ok({ pulled: 0, conflicts: [], timestamp: new Date() });
  }
  async mergeStateBranches(): Promise<Result<void, SyncError>> {
    return ok(undefined);
  }
  async createStateBranch(): Promise<Result<void, SyncError>> {
    return ok(undefined);
  }
  async deleteStateBranch(): Promise<Result<void, SyncError>> {
    return ok(undefined);
  }
}

const RESTORE_REPORT: RestoreReport = {
  previousBranch: "main",
  restoredBranch: "feature/x",
  dirtySaved: false,
  backupPath: "/tmp/backup",
  filesRestored: 3,
  backupsCleaned: 1,
};

class StubRestoreStateUseCase {
  calls: string[] = [];
  result: Result<RestoreReport, SyncError> = ok(RESTORE_REPORT);

  async execute(targetCodeBranch: string): Promise<Result<RestoreReport, SyncError>> {
    this.calls.push(targetCodeBranch);
    return this.result;
  }
}

class StubGitPort {
  branch: string | null = "feature/x";
  error: GitError | null = null;

  async currentBranch(): Promise<Result<string | null, GitError>> {
    if (this.error) return err(this.error);
    return ok(this.branch);
  }

  // Unused — satisfy shape
  async listBranches(): Promise<Result<string[], GitError>> {
    return ok([]);
  }
  async createBranch(): Promise<Result<void, GitError>> {
    return ok(undefined);
  }
  async showFile(): Promise<Result<string | null, GitError>> {
    return ok(null);
  }
  async log(): Promise<Result<[], GitError>> {
    return ok([]);
  }
  async status(): Promise<Result<never, GitError>> {
    return err({} as GitError);
  }
  async commit(): Promise<Result<string, GitError>> {
    return ok("");
  }
  async revert(): Promise<Result<void, GitError>> {
    return ok(undefined);
  }
  async isAncestor(): Promise<Result<boolean, GitError>> {
    return ok(false);
  }
  async worktreeAdd(): Promise<Result<void, GitError>> {
    return ok(undefined);
  }
  async worktreeRemove(): Promise<Result<void, GitError>> {
    return ok(undefined);
  }
  async worktreeList(): Promise<Result<[], GitError>> {
    return ok([]);
  }
  async deleteBranch(): Promise<Result<void, GitError>> {
    return ok(undefined);
  }
  async statusAt(): Promise<Result<never, GitError>> {
    return err({} as GitError);
  }
  async diffNameOnly(): Promise<Result<string[], GitError>> {
    return ok([]);
  }
  async diff(): Promise<Result<string, GitError>> {
    return ok("");
  }
  async diffAgainst(): Promise<Result<string, GitError>> {
    return ok("");
  }
  async restoreWorktree(): Promise<Result<void, GitError>> {
    return ok(undefined);
  }
  async pushFrom(): Promise<Result<void, GitError>> {
    return ok(undefined);
  }
  async branchExists(): Promise<Result<boolean, GitError>> {
    return ok(false);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeUseCase(
  opts: {
    branch?: string | null;
    stateSyncResult?: Result<void, SyncError>;
    restoreResult?: Result<RestoreReport, SyncError>;
  } = {},
) {
  const stateSync = new StubStateSyncPort();
  if (opts.stateSyncResult !== undefined) stateSync.result = opts.stateSyncResult;

  const restoreUseCase = new StubRestoreStateUseCase();
  if (opts.restoreResult !== undefined) restoreUseCase.result = opts.restoreResult;

  const gitPort = new StubGitPort();
  if (opts.branch !== undefined) gitPort.branch = opts.branch;

  const useCase = new ForceSyncUseCase(
    stateSync as never,
    restoreUseCase as never,
    gitPort as never,
  );

  return { useCase, stateSync, restoreUseCase, gitPort };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ForceSyncUseCase", () => {
  describe("push()", () => {
    it("calls syncToStateBranch with current branch and returns ok", async () => {
      const { useCase, stateSync } = makeUseCase({ branch: "feature/x" });

      const result = await useCase.push("/project/.tff");

      expect(result.ok).toBe(true);
      expect(stateSync.calls).toHaveLength(1);
      expect(stateSync.calls[0]).toEqual(["feature/x", "/project/.tff"]);
    });

    it("returns error when HEAD is detached (currentBranch null)", async () => {
      const { useCase, stateSync } = makeUseCase({ branch: null });

      const result = await useCase.push("/project/.tff");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(SyncError);
        expect(result.error.code).toContain("DETACHED_HEAD");
      }
      expect(stateSync.calls).toHaveLength(0);
    });

    it("propagates error when syncToStateBranch fails", async () => {
      const syncError = new SyncError("EXPORT_FAILED", "disk full");
      const { useCase } = makeUseCase({
        branch: "main",
        stateSyncResult: err(syncError),
      });

      const result = await useCase.push("/project/.tff");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(syncError);
      }
    });
  });

  describe("pull()", () => {
    it("calls restoreUseCase.execute with current branch and returns restore report", async () => {
      const { useCase, restoreUseCase } = makeUseCase({ branch: "feature/x" });

      const result = await useCase.pull("/project/.tff");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual(RESTORE_REPORT);
      }
      expect(restoreUseCase.calls).toEqual(["feature/x"]);
    });

    it("returns error when HEAD is detached (currentBranch null)", async () => {
      const { useCase, restoreUseCase } = makeUseCase({ branch: null });

      const result = await useCase.pull("/project/.tff");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(SyncError);
        expect(result.error.code).toContain("DETACHED_HEAD");
      }
      expect(restoreUseCase.calls).toHaveLength(0);
    });
  });
});
