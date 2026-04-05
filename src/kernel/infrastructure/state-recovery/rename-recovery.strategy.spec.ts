import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitError, SyncError } from "@kernel/errors";
import type { StateBranchOpsPort } from "@kernel/ports/state-branch-ops.port";
import { err, ok, type Result } from "@kernel/result";
import type { BranchMeta } from "@kernel/schemas/branch-meta.schemas";
import type { RecoveryScenario } from "@kernel/schemas/recovery.schemas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RenameRecoveryStrategy } from "./rename-recovery.strategy";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_BRANCH_META: BranchMeta = {
  version: 1,
  stateId: "00000000-0000-4000-a000-000000000001",
  codeBranch: "old-branch",
  stateBranch: "tff-state/old-branch",
  parentStateBranch: null,
  lastSyncedAt: null,
  lastJournalOffset: 0,
  dirty: false,
  lastSyncedHash: null,
};

function makeRenameScenario(overrides: Partial<RecoveryScenario> = {}): RecoveryScenario {
  return {
    type: "rename",
    currentBranch: "new-branch",
    branchMeta: VALID_BRANCH_META,
    backupPaths: [],
    stateBranchExists: false,
    parentStateBranch: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Stub
// ---------------------------------------------------------------------------

class StubStateBranchOpsPort implements StateBranchOpsPort {
  renameCalls: Array<{ from: string; to: string }> = [];
  private _renameResult: Result<void, GitError> = ok(undefined);

  setRenameResult(result: Result<void, GitError>): void {
    this._renameResult = result;
  }

  renameBranch(oldName: string, newName: string): Promise<Result<void, GitError>> {
    this.renameCalls.push({ from: oldName, to: newName });
    return Promise.resolve(this._renameResult);
  }

  createOrphan(_branchName: string): Promise<Result<void, GitError>> {
    return Promise.resolve(ok(undefined));
  }
  forkBranch(_source: string, _target: string): Promise<Result<void, GitError>> {
    return Promise.resolve(ok(undefined));
  }
  deleteBranch(_branchName: string): Promise<Result<void, GitError>> {
    return Promise.resolve(ok(undefined));
  }
  branchExists(_branchName: string): Promise<Result<boolean, GitError>> {
    return Promise.resolve(ok(false));
  }
  syncToStateBranch(
    _stateBranch: string,
    _files: Map<string, string>,
  ): Promise<Result<string, GitError>> {
    return Promise.resolve(ok("abc123"));
  }
  readFromStateBranch(
    _stateBranch: string,
    _path: string,
  ): Promise<Result<string | null, GitError>> {
    return Promise.resolve(ok(null));
  }
  readAllFromStateBranch(_stateBranch: string): Promise<Result<Map<string, string>, GitError>> {
    return Promise.resolve(ok(new Map()));
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RenameRecoveryStrategy", () => {
  let tffDir: string;
  let stateBranchOps: StubStateBranchOpsPort;
  let strategy: RenameRecoveryStrategy;
  const tmps: string[] = [];

  beforeEach(() => {
    tffDir = mkdtempSync(join(tmpdir(), "tff-rename-strategy-test-"));
    tmps.push(tffDir);
    stateBranchOps = new StubStateBranchOpsPort();
    strategy = new RenameRecoveryStrategy(stateBranchOps);
  });

  afterEach(() => {
    for (const dir of tmps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("handles 'rename' scenario type", () => {
    expect(strategy.handles).toBe("rename");
  });

  it("renames state branch, updates branch-meta.json, and returns action='renamed'", async () => {
    // Write branch-meta.json so the strategy can read it
    writeFileSync(
      join(tffDir, "branch-meta.json"),
      JSON.stringify(VALID_BRANCH_META, null, 2),
      "utf-8",
    );

    const scenario = makeRenameScenario();
    const result = await strategy.execute(scenario, tffDir);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    // Report shape
    expect(result.data.type).toBe("rename");
    expect(result.data.action).toBe("renamed");

    // renameBranch was called with correct args
    expect(stateBranchOps.renameCalls).toHaveLength(1);
    expect(stateBranchOps.renameCalls[0]).toEqual({
      from: "tff-state/old-branch",
      to: "tff-state/new-branch",
    });

    // branch-meta.json was updated on disk
    const updated = JSON.parse(
      readFileSync(join(tffDir, "branch-meta.json"), "utf-8"),
    ) as BranchMeta;
    expect(updated.codeBranch).toBe("new-branch");
    expect(updated.stateBranch).toBe("tff-state/new-branch");
  });

  it("returns err(SyncError('RENAME_FAILED')) when renameBranch fails", async () => {
    writeFileSync(
      join(tffDir, "branch-meta.json"),
      JSON.stringify(VALID_BRANCH_META, null, 2),
      "utf-8",
    );

    stateBranchOps.setRenameResult(err(new GitError("GIT_COMMAND_FAILED", "git branch -m failed")));

    const scenario = makeRenameScenario();
    const result = await strategy.execute(scenario, tffDir);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBeInstanceOf(SyncError);
    expect(result.error.code).toContain("RENAME_FAILED");
  });
});
