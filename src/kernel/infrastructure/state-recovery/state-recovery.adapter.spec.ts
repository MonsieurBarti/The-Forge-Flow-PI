import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SyncError } from "@kernel/errors";
import { ok, type Result } from "@kernel/result";
import type { GitError } from "@kernel/errors";
import type { GitLogEntry, GitStatus, GitWorktreeEntry } from "@kernel/ports/git.schemas";
import { GitPort } from "@kernel/ports/git.port";
import type { StateBranchOpsPort } from "@kernel/ports/state-branch-ops.port";
import type { RecoveryScenario, RecoveryReport, RecoveryType } from "@kernel/schemas/recovery.schemas";
import type { RecoveryStrategy } from "@kernel/ports/recovery-strategy";
import { StateRecoveryAdapter } from "./state-recovery.adapter";

// ---------------------------------------------------------------------------
// Fixtures
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

class StubGitPort extends GitPort {
  private _currentBranch: string | null = "main";
  private _existingBranches = new Set<string>(["main"]);

  setCurrentBranch(branch: string | null): void {
    this._currentBranch = branch;
  }

  seedBranch(name: string): void {
    this._existingBranches.add(name);
  }

  override currentBranch(): Promise<Result<string | null, GitError>> {
    return Promise.resolve(ok(this._currentBranch));
  }

  override branchExists(name: string): Promise<Result<boolean, GitError>> {
    return Promise.resolve(ok(this._existingBranches.has(name)));
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

class StubStateBranchOpsPort implements StateBranchOpsPort {
  private _branchExistsMap = new Map<string, boolean>();
  private _readResults = new Map<string, string | null>();

  setStateBranchExists(branchName: string, value: boolean): void {
    this._branchExistsMap.set(branchName, value);
  }

  setReadResult(stateBranch: string, path: string, value: string | null): void {
    this._readResults.set(`${stateBranch}:${path}`, value);
  }

  branchExists(branchName: string): Promise<Result<boolean, GitError>> {
    return Promise.resolve(ok(this._branchExistsMap.get(branchName) ?? false));
  }

  readFromStateBranch(stateBranch: string, path: string): Promise<Result<string | null, GitError>> {
    const key = `${stateBranch}:${path}`;
    return Promise.resolve(ok(this._readResults.get(key) ?? null));
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
  readAllFromStateBranch(_stateBranch: string): Promise<Result<Map<string, string>, GitError>> {
    return Promise.resolve(ok(new Map()));
  }
}

class StubRecoveryStrategy implements RecoveryStrategy {
  readonly handles: RecoveryType;
  executeCalls: Array<{ scenario: RecoveryScenario; tffDir: string }> = [];
  result: Result<RecoveryReport, SyncError> = ok({
    type: "crash",
    action: "restored",
    source: "test",
    filesRestored: 0,
    warnings: [],
  });

  constructor(type: RecoveryType) {
    this.handles = type;
  }

  execute(scenario: RecoveryScenario, tffDir: string): Promise<Result<RecoveryReport, SyncError>> {
    this.executeCalls.push({ scenario, tffDir });
    return Promise.resolve(this.result);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "tff-recovery-adapter-test-"));
}

function makeTffDir(projectRoot: string): string {
  const tffDir = join(projectRoot, ".tff");
  mkdirSync(tffDir, { recursive: true });
  return tffDir;
}

function writeBranchMeta(tffDir: string, overrides: Partial<typeof VALID_BRANCH_META> = {}): void {
  writeFileSync(
    join(tffDir, "branch-meta.json"),
    JSON.stringify({ ...VALID_BRANCH_META, ...overrides }),
  );
}

function createBackupDir(projectRoot: string, name: string): string {
  const backupPath = join(projectRoot, name);
  mkdirSync(backupPath, { recursive: true });
  writeFileSync(join(backupPath, "branch-meta.json"), JSON.stringify({ version: 1 }));
  return backupPath;
}

function makeStrategiesMap(
  ...strategies: StubRecoveryStrategy[]
): Map<RecoveryType, RecoveryStrategy> {
  const map = new Map<RecoveryType, RecoveryStrategy>();
  for (const s of strategies) {
    map.set(s.handles, s);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StateRecoveryAdapter", () => {
  const tmps: string[] = [];
  let projectRoot: string;
  let tffDir: string;
  let gitPort: StubGitPort;
  let stateBranchOps: StubStateBranchOpsPort;
  let crashStrategy: StubRecoveryStrategy;
  let mismatchStrategy: StubRecoveryStrategy;
  let renameStrategy: StubRecoveryStrategy;
  let freshCloneStrategy: StubRecoveryStrategy;
  let strategies: Map<RecoveryType, RecoveryStrategy>;
  let adapter: StateRecoveryAdapter;

  beforeEach(() => {
    projectRoot = makeTmpDir();
    tmps.push(projectRoot);
    tffDir = makeTffDir(projectRoot);

    gitPort = new StubGitPort();
    stateBranchOps = new StubStateBranchOpsPort();

    crashStrategy = new StubRecoveryStrategy("crash");
    crashStrategy.result = ok({
      type: "crash",
      action: "restored",
      source: "backup",
      filesRestored: 1,
      warnings: [],
    });

    mismatchStrategy = new StubRecoveryStrategy("mismatch");
    renameStrategy = new StubRecoveryStrategy("rename");
    freshCloneStrategy = new StubRecoveryStrategy("fresh-clone");

    strategies = makeStrategiesMap(crashStrategy, mismatchStrategy, renameStrategy, freshCloneStrategy);

    adapter = new StateRecoveryAdapter(strategies, gitPort, stateBranchOps, projectRoot);
  });

  afterEach(() => {
    for (const dir of tmps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // detect() — 10 cases
  // -------------------------------------------------------------------------

  // Test 1: .tff/ directory missing → fresh-clone
  it("detects 'fresh-clone' when .tff/ directory does not exist", async () => {
    rmSync(tffDir, { recursive: true, force: true });

    const result = await adapter.detect(tffDir);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.type).toBe("fresh-clone");
    expect(result.data.currentBranch).toBe("main");
    expect(result.data.branchMeta).toBeNull();
    expect(result.data.backupPaths).toEqual([]);
  });

  // Test 2: Detached HEAD → healthy
  it("detects 'healthy' when HEAD is detached (currentBranch is null)", async () => {
    gitPort.setCurrentBranch(null);

    const result = await adapter.detect(tffDir);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.type).toBe("healthy");
    expect(result.data.currentBranch).toBeNull();
  });

  // Test 3: branch-meta.json missing + backup dirs exist → crash
  it("detects 'crash' when branch-meta.json is missing but backup dirs exist", async () => {
    // No branch-meta.json in tffDir
    createBackupDir(projectRoot, ".tff.backup.2024-01-15T10-00-00-000Z");

    const result = await adapter.detect(tffDir);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.type).toBe("crash");
    expect(result.data.backupPaths).toHaveLength(1);
    expect(result.data.branchMeta).toBeNull();
  });

  // Test 4: branch-meta.json missing + no backups + .tff/ exists → fresh-clone
  it("detects 'fresh-clone' when branch-meta.json is missing, no backups, and .tff/ exists", async () => {
    // tffDir exists but no branch-meta.json, no backups

    const result = await adapter.detect(tffDir);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.type).toBe("fresh-clone");
    expect(result.data.backupPaths).toEqual([]);
  });

  // Test 5: codeBranch !== HEAD + old branch exists + state for current exists → mismatch
  it("detects 'mismatch' when old branch exists and state branch for current exists", async () => {
    writeBranchMeta(tffDir, { codeBranch: "old-branch" });
    gitPort.setCurrentBranch("new-branch");
    gitPort.seedBranch("old-branch");
    stateBranchOps.setStateBranchExists("tff-state/new-branch", true);

    const result = await adapter.detect(tffDir);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.type).toBe("mismatch");
    expect(result.data.currentBranch).toBe("new-branch");
  });

  // Test 6: codeBranch !== HEAD + old branch gone + no state for current → rename
  it("detects 'rename' when old branch is gone and no state branch for current", async () => {
    writeBranchMeta(tffDir, { codeBranch: "old-branch" });
    gitPort.setCurrentBranch("new-branch");
    // old-branch not seeded → does not exist
    stateBranchOps.setStateBranchExists("tff-state/new-branch", false);

    const result = await adapter.detect(tffDir);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.type).toBe("rename");
    expect(result.data.currentBranch).toBe("new-branch");
  });

  // Test 7: codeBranch !== HEAD + old branch gone + state exists + stateId matches → rename
  it("detects 'rename' when old branch gone, state branch exists, and stateId matches", async () => {
    writeBranchMeta(tffDir, { codeBranch: "old-branch" });
    gitPort.setCurrentBranch("new-branch");
    stateBranchOps.setStateBranchExists("tff-state/new-branch", true);
    stateBranchOps.setReadResult(
      "tff-state/new-branch",
      "branch-meta.json",
      JSON.stringify({
        ...VALID_BRANCH_META,
        codeBranch: "new-branch",
        stateBranch: "tff-state/new-branch",
        // stateId matches VALID_BRANCH_META
      }),
    );

    const result = await adapter.detect(tffDir);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.type).toBe("rename");
  });

  // Test 8: codeBranch !== HEAD + old branch gone + state exists + stateId mismatches → mismatch
  it("detects 'mismatch' when old branch gone, state branch exists, and stateId mismatches", async () => {
    writeBranchMeta(tffDir, { codeBranch: "old-branch" });
    gitPort.setCurrentBranch("new-branch");
    stateBranchOps.setStateBranchExists("tff-state/new-branch", true);
    stateBranchOps.setReadResult(
      "tff-state/new-branch",
      "branch-meta.json",
      JSON.stringify({
        ...VALID_BRANCH_META,
        stateId: "99999999-9999-4999-b999-999999999999",
        codeBranch: "new-branch",
        stateBranch: "tff-state/new-branch",
      }),
    );

    const result = await adapter.detect(tffDir);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.type).toBe("mismatch");
  });

  // Test 9: codeBranch !== HEAD + old branch exists + no state for current → untracked
  it("detects 'untracked' when old branch exists and no state branch for current", async () => {
    writeBranchMeta(tffDir, { codeBranch: "old-branch" });
    gitPort.setCurrentBranch("new-branch");
    gitPort.seedBranch("old-branch");
    stateBranchOps.setStateBranchExists("tff-state/new-branch", false);

    const result = await adapter.detect(tffDir);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.type).toBe("untracked");
  });

  // Test 10: codeBranch === HEAD → healthy
  it("detects 'healthy' when codeBranch matches currentBranch", async () => {
    writeBranchMeta(tffDir, { codeBranch: "main" });
    gitPort.setCurrentBranch("main");

    const result = await adapter.detect(tffDir);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.type).toBe("healthy");
    expect(result.data.branchMeta).not.toBeNull();
    expect(result.data.branchMeta?.codeBranch).toBe("main");
  });

  // -------------------------------------------------------------------------
  // recover() — 3 cases
  // -------------------------------------------------------------------------

  // Test 11: recover() with healthy → returns skipped report
  it("recover() returns skipped report for 'healthy' scenario", async () => {
    const scenario: RecoveryScenario = {
      type: "healthy",
      currentBranch: "main",
      branchMeta: null,
      backupPaths: [],
      stateBranchExists: false,
      parentStateBranch: null,
    };

    const result = await adapter.recover(scenario, tffDir);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.action).toBe("skipped");
    expect(result.data.type).toBe("healthy");
    expect(crashStrategy.executeCalls).toHaveLength(0);
  });

  // Test 12: recover() with crash → delegates to crash strategy
  it("recover() delegates to crash strategy for 'crash' scenario", async () => {
    const scenario: RecoveryScenario = {
      type: "crash",
      currentBranch: "main",
      branchMeta: null,
      backupPaths: ["/tmp/backup"],
      stateBranchExists: false,
      parentStateBranch: null,
    };

    const result = await adapter.recover(scenario, tffDir);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.action).toBe("restored");
    expect(crashStrategy.executeCalls).toHaveLength(1);
    expect(crashStrategy.executeCalls[0].scenario).toBe(scenario);
    expect(crashStrategy.executeCalls[0].tffDir).toBe(tffDir);
  });

  // Test 13: recover() with untracked → returns skipped report
  it("recover() returns skipped report for 'untracked' scenario", async () => {
    const scenario: RecoveryScenario = {
      type: "untracked",
      currentBranch: "feature-branch",
      branchMeta: null,
      backupPaths: [],
      stateBranchExists: false,
      parentStateBranch: null,
    };

    const result = await adapter.recover(scenario, tffDir);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.action).toBe("skipped");
    expect(result.data.type).toBe("untracked");
    expect(crashStrategy.executeCalls).toHaveLength(0);
  });
});
