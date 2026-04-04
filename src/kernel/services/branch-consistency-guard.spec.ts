import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SyncError } from "@kernel/errors";
import { err, ok, type Result } from "@kernel/result";
import type { GitError } from "@kernel/errors";
import type { GitLogEntry, GitStatus, GitWorktreeEntry } from "@kernel/ports/git.schemas";
import { GitPort } from "@kernel/ports/git.port";
import type { StateBranchOpsPort } from "@kernel/ports/state-branch-ops.port";
import type { DiagnosticReport } from "./doctor-service";
import type { RestoreReport } from "./restore-state.use-case";
import { BranchConsistencyGuard } from "./branch-consistency-guard";

// ---------------------------------------------------------------------------
// Valid branch-meta JSON fixture
// ---------------------------------------------------------------------------

const VALID_BRANCH_META = {
  version: 1,
  stateId: "00000000-0000-4000-a000-000000000001",
  codeBranch: "some-branch",
  stateBranch: "tff-state/some-branch",
  parentStateBranch: null,
  lastSyncedAt: null,
  lastJournalOffset: 0,
  dirty: false,
  lastSyncedHash: null,
};

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

class StubDoctorService {
  wasCalled = false;
  callOrder: string[] = [];

  async diagnoseAndFix(_tffDir: string): Promise<DiagnosticReport> {
    this.wasCalled = true;
    this.callOrder.push("diagnoseAndFix");
    return { fixed: [], warnings: [] };
  }
}

class StubGitPort extends GitPort {
  private _currentBranch: string | null = "main";
  callOrder: string[] = [];

  setCurrentBranch(branch: string | null): void {
    this._currentBranch = branch;
  }

  override currentBranch(): Promise<Result<string | null, GitError>> {
    this.callOrder.push("currentBranch");
    return Promise.resolve(ok(this._currentBranch));
  }

  override listBranches(_pattern: string): Promise<Result<string[], GitError>> {
    return Promise.resolve(ok([]));
  }
  override createBranch(_name: string, _base: string): Promise<Result<void, GitError>> {
    return Promise.resolve(ok(undefined));
  }
  override showFile(_branch: string, _path: string): Promise<Result<string | null, GitError>> {
    return Promise.resolve(ok(null));
  }
  override log(_branch: string, _limit?: number): Promise<Result<GitLogEntry[], GitError>> {
    return Promise.resolve(ok([]));
  }
  override status(): Promise<Result<GitStatus, GitError>> {
    return Promise.resolve(ok({ branch: "test", clean: true, entries: [] }));
  }
  override commit(_message: string, _paths: string[]): Promise<Result<string, GitError>> {
    return Promise.resolve(ok("abc123"));
  }
  override revert(_commitHash: string): Promise<Result<void, GitError>> {
    return Promise.resolve(ok(undefined));
  }
  override isAncestor(_ancestor: string, _descendant: string): Promise<Result<boolean, GitError>> {
    return Promise.resolve(ok(true));
  }
  override worktreeAdd(_path: string, _branch: string, _baseBranch: string): Promise<Result<void, GitError>> {
    return Promise.resolve(ok(undefined));
  }
  override worktreeRemove(_path: string): Promise<Result<void, GitError>> {
    return Promise.resolve(ok(undefined));
  }
  override worktreeList(): Promise<Result<GitWorktreeEntry[], GitError>> {
    return Promise.resolve(ok([]));
  }
  override deleteBranch(_name: string, _force?: boolean): Promise<Result<void, GitError>> {
    return Promise.resolve(ok(undefined));
  }
  override statusAt(_cwd: string): Promise<Result<GitStatus, GitError>> {
    return Promise.resolve(ok({ branch: "test", clean: true, entries: [] }));
  }
  override diffNameOnly(_cwd: string): Promise<Result<string[], GitError>> {
    return Promise.resolve(ok([]));
  }
  override diff(_cwd: string): Promise<Result<string, GitError>> {
    return Promise.resolve(ok(""));
  }
  override diffAgainst(_base: string, _cwd: string): Promise<Result<string, GitError>> {
    return Promise.resolve(ok(""));
  }
  override restoreWorktree(_cwd: string): Promise<Result<void, GitError>> {
    return Promise.resolve(ok(undefined));
  }
  override pushFrom(_cwd: string, _branch: string): Promise<Result<void, GitError>> {
    return Promise.resolve(ok(undefined));
  }
}

class StubRestoreStateUseCase {
  calls: string[] = [];
  result: Result<RestoreReport, SyncError> = ok({
    previousBranch: null,
    restoredBranch: "some-branch",
    dirtySaved: false,
    backupPath: "/tmp/backup",
    filesRestored: 0,
    backupsCleaned: 0,
  });

  async execute(targetBranch: string): Promise<Result<RestoreReport, SyncError>> {
    this.calls.push(targetBranch);
    return this.result;
  }
}

class StubStateBranchOpsPort implements StateBranchOpsPort {
  private _branchExistsResult: Result<boolean, GitError> = ok(false);

  setBranchExists(value: boolean): void {
    this._branchExistsResult = ok(value);
  }

  branchExists(_branchName: string): Promise<Result<boolean, GitError>> {
    return Promise.resolve(this._branchExistsResult);
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
  renameBranch(_oldName: string, _newName: string): Promise<Result<void, GitError>> {
    return Promise.resolve(ok(undefined));
  }
  syncToStateBranch(_stateBranch: string, _files: Map<string, string>): Promise<Result<string, GitError>> {
    return Promise.resolve(ok("abc123"));
  }
  readFromStateBranch(_stateBranch: string, _path: string): Promise<Result<string | null, GitError>> {
    return Promise.resolve(ok(null));
  }
  readAllFromStateBranch(_stateBranch: string): Promise<Result<Map<string, string>, GitError>> {
    return Promise.resolve(ok(new Map()));
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "tff-guard-test-"));
}

function writeBranchMeta(dir: string, overrides: Partial<typeof VALID_BRANCH_META> = {}): void {
  writeFileSync(
    join(dir, "branch-meta.json"),
    JSON.stringify({ ...VALID_BRANCH_META, ...overrides }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BranchConsistencyGuard", () => {
  const tmps: string[] = [];
  let tffDir: string;
  let doctor: StubDoctorService;
  let gitPort: StubGitPort;
  let restoreUseCase: StubRestoreStateUseCase;
  let stateBranchOps: StubStateBranchOpsPort;
  let guard: BranchConsistencyGuard;

  beforeEach(() => {
    tffDir = makeTmpDir();
    tmps.push(tffDir);
    doctor = new StubDoctorService();
    gitPort = new StubGitPort();
    restoreUseCase = new StubRestoreStateUseCase();
    stateBranchOps = new StubStateBranchOpsPort();
    guard = new BranchConsistencyGuard(
      doctor as unknown as import("./doctor-service").DoctorService,
      gitPort,
      restoreUseCase as unknown as import("./restore-state.use-case").RestoreStateUseCase,
      stateBranchOps,
    );
  });

  afterEach(() => {
    for (const dir of tmps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // 1. Branch matches meta → ok, RestoreStateUseCase NOT called
  it("returns ok and skips restore when branch matches branch-meta", async () => {
    writeBranchMeta(tffDir, { codeBranch: "some-branch" });
    gitPort.setCurrentBranch("some-branch");

    const result = await guard.ensure(tffDir);

    expect(result.ok).toBe(true);
    expect(restoreUseCase.calls).toHaveLength(0);
  });

  // 2. Branch mismatch → triggers RestoreStateUseCase.execute() with current branch
  it("triggers restore when current branch differs from branch-meta codeBranch", async () => {
    writeBranchMeta(tffDir, { codeBranch: "old-branch" });
    gitPort.setCurrentBranch("new-branch");

    const result = await guard.ensure(tffDir);

    expect(result.ok).toBe(true);
    expect(restoreUseCase.calls).toHaveLength(1);
    expect(restoreUseCase.calls[0]).toBe("new-branch");
  });

  // 3. Detached HEAD → ok, skips restore
  it("returns ok and skips restore when HEAD is detached (currentBranch returns null)", async () => {
    gitPort.setCurrentBranch(null);

    const result = await guard.ensure(tffDir);

    expect(result.ok).toBe(true);
    expect(restoreUseCase.calls).toHaveLength(0);
  });

  // 4. No meta + state branch exists → triggers restore
  it("triggers restore when no branch-meta but state branch exists for current branch", async () => {
    gitPort.setCurrentBranch("tracked-branch");
    stateBranchOps.setBranchExists(true);

    const result = await guard.ensure(tffDir);

    expect(result.ok).toBe(true);
    expect(restoreUseCase.calls).toHaveLength(1);
    expect(restoreUseCase.calls[0]).toBe("tracked-branch");
  });

  // 5. No meta + no state branch → ok (untracked branch)
  it("returns ok when no branch-meta and no state branch exists", async () => {
    gitPort.setCurrentBranch("untracked-branch");
    stateBranchOps.setBranchExists(false);

    const result = await guard.ensure(tffDir);

    expect(result.ok).toBe(true);
    expect(restoreUseCase.calls).toHaveLength(0);
  });

  // 6. Restore fails with RESTORE_FAILED → returns err
  it("returns err with RESTORE_FAILED when restore returns an unhandled SyncError", async () => {
    writeBranchMeta(tffDir, { codeBranch: "old-branch" });
    gitPort.setCurrentBranch("new-branch");
    restoreUseCase.result = err(new SyncError("RESTORE_FAILED", "something went wrong"));

    const result = await guard.ensure(tffDir);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toContain("RESTORE_FAILED");
  });

  // 7. Restore fails with LOCK_CONTENTION → returns ok (non-fatal)
  it("returns ok when restore fails with LOCK_CONTENTION (non-fatal)", async () => {
    writeBranchMeta(tffDir, { codeBranch: "old-branch" });
    gitPort.setCurrentBranch("new-branch");
    restoreUseCase.result = err(new SyncError("LOCK_CONTENTION", "lock held"));

    const result = await guard.ensure(tffDir);

    expect(result.ok).toBe(true);
  });

  // 8. Restore fails with BRANCH_NOT_FOUND → returns ok (non-fatal)
  it("returns ok when restore fails with BRANCH_NOT_FOUND (non-fatal)", async () => {
    writeBranchMeta(tffDir, { codeBranch: "old-branch" });
    gitPort.setCurrentBranch("new-branch");
    restoreUseCase.result = err(new SyncError("BRANCH_NOT_FOUND", "branch not found"));

    const result = await guard.ensure(tffDir);

    expect(result.ok).toBe(true);
  });

  // 9. Doctor runs before branch check
  it("calls diagnoseAndFix before any branch operations", async () => {
    // Track ordering: diagnoseAndFix must precede currentBranch
    let doctorCallIndex = -1;
    let branchCallIndex = -1;
    let callCount = 0;

    const trackingDoctor = {
      async diagnoseAndFix(_tffDir: string): Promise<DiagnosticReport> {
        doctorCallIndex = callCount++;
        return { fixed: [], warnings: [] };
      },
    };

    const trackingGit = new StubGitPort();
    const origCurrentBranch = trackingGit.currentBranch.bind(trackingGit);
    trackingGit.currentBranch = () => {
      branchCallIndex = callCount++;
      return origCurrentBranch();
    };

    const g = new BranchConsistencyGuard(
      trackingDoctor as unknown as import("./doctor-service").DoctorService,
      trackingGit,
      restoreUseCase as unknown as import("./restore-state.use-case").RestoreStateUseCase,
      stateBranchOps,
    );

    await g.ensure(tffDir);

    expect(doctorCallIndex).toBeGreaterThanOrEqual(0);
    expect(branchCallIndex).toBeGreaterThanOrEqual(0);
    expect(doctorCallIndex).toBeLessThan(branchCallIndex);
  });
});
