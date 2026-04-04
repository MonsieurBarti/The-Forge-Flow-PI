import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SyncError } from "@kernel/errors";
import { err, ok, type Result } from "@kernel/result";
import type { GitError } from "@kernel/errors";
import type { StateBranchOpsPort } from "@kernel/ports/state-branch-ops.port";
import type { RestoreReport } from "@kernel/services/restore-state.use-case";
import type { RecoveryScenario } from "@kernel/schemas/recovery.schemas";
import { BackupService } from "@kernel/services/backup-service";
import { CrashRecoveryStrategy } from "./crash-recovery.strategy";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

class StubBackupService extends BackupService {
  restoreCalls: Array<{ backupPath: string; tffDir: string }> = [];
  restoreError: Error | null = null;

  override restoreFromBackup(backupPath: string, tffDir: string): void {
    this.restoreCalls.push({ backupPath, tffDir });
    if (this.restoreError) throw this.restoreError;
    // Simulate successful restore by writing branch-meta.json
    mkdirSync(tffDir, { recursive: true });
    writeFileSync(join(tffDir, "branch-meta.json"), JSON.stringify({ version: 1 }));
  }
}

class StubStateBranchOpsPort implements StateBranchOpsPort {
  private _branchExistsMap = new Map<string, boolean>();
  private _readResults = new Map<string, string | null>();

  setBranchExists(branchName: string, value: boolean): void {
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

class StubRestoreStateUseCase {
  calls: string[] = [];
  tffDir: string | null = null;
  result: Result<RestoreReport, SyncError> = ok({
    previousBranch: null,
    restoredBranch: "some-branch",
    dirtySaved: false,
    backupPath: "/tmp/backup",
    filesRestored: 3,
    backupsCleaned: 0,
  });

  async execute(targetBranch: string): Promise<Result<RestoreReport, SyncError>> {
    this.calls.push(targetBranch);
    // Simulate the real use case writing branch-meta.json
    if (this.result.ok && this.tffDir) {
      mkdirSync(this.tffDir, { recursive: true });
      writeFileSync(
        join(this.tffDir, "branch-meta.json"),
        JSON.stringify({ version: 1, codeBranch: targetBranch }),
      );
    }
    return this.result;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "tff-crash-recovery-test-"));
}

function buildBackupDir(projectRoot: string, name: string): string {
  const backupPath = join(projectRoot, name);
  mkdirSync(backupPath, { recursive: true });
  writeFileSync(
    join(backupPath, "branch-meta.json"),
    JSON.stringify({ version: 1, codeBranch: "main" }),
  );
  return backupPath;
}

function makeScenario(overrides: Partial<RecoveryScenario> = {}): RecoveryScenario {
  return {
    type: "crash",
    currentBranch: "main",
    branchMeta: null,
    backupPaths: [],
    stateBranchExists: false,
    parentStateBranch: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CrashRecoveryStrategy", () => {
  const tmps: string[] = [];
  let backupService: StubBackupService;
  let stateBranchOps: StubStateBranchOpsPort;
  let restoreUseCase: StubRestoreStateUseCase;
  let strategy: CrashRecoveryStrategy;

  beforeEach(() => {
    backupService = new StubBackupService();
    stateBranchOps = new StubStateBranchOpsPort();
    restoreUseCase = new StubRestoreStateUseCase();
    strategy = new CrashRecoveryStrategy(backupService, stateBranchOps, restoreUseCase as any);
  });

  afterEach(() => {
    for (const dir of tmps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("handles: 'crash'", () => {
    expect(strategy.handles).toBe("crash");
  });

  // Test 1: Backup exists + no state branch → restore newest backup, action='restored'
  it("restores from newest backup when no state branch exists", async () => {
    const root = makeTmpDir();
    tmps.push(root);
    const tffDir = join(root, ".tff");
    mkdirSync(tffDir, { recursive: true });

    const backupPath = buildBackupDir(root, ".tff.backup.2024-01-15T10-00-00-000Z");
    const scenario = makeScenario({
      currentBranch: "main",
      backupPaths: [backupPath],
      stateBranchExists: false,
    });

    const result = await strategy.execute(scenario, tffDir);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.action).toBe("restored");
    expect(result.data.type).toBe("crash");
    expect(backupService.restoreCalls).toHaveLength(1);
    expect(backupService.restoreCalls[0].backupPath).toBe(backupPath);
  });

  // Test 2: Backup exists + state branch exists + backup timestamp newer → restore from backup
  it("prefers backup when backup timestamp is newer than state branch lastSyncedAt", async () => {
    const root = makeTmpDir();
    tmps.push(root);
    const tffDir = join(root, ".tff");
    mkdirSync(tffDir, { recursive: true });

    const backupPath = buildBackupDir(root, ".tff.backup.2024-06-01T12-00-00-000Z");

    // State branch has older lastSyncedAt
    const olderMeta = JSON.stringify({
      version: 1,
      stateId: "00000000-0000-4000-a000-000000000001",
      codeBranch: "main",
      stateBranch: "tff-state/main",
      parentStateBranch: null,
      lastSyncedAt: "2024-01-01T00:00:00.000Z",
      lastJournalOffset: 0,
      dirty: false,
      lastSyncedHash: null,
    });
    stateBranchOps.setBranchExists("tff-state/main", true);
    stateBranchOps.setReadResult("tff-state/main", "branch-meta.json", olderMeta);

    const scenario = makeScenario({
      currentBranch: "main",
      backupPaths: [backupPath],
      stateBranchExists: true,
    });

    const result = await strategy.execute(scenario, tffDir);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.action).toBe("restored");
    expect(backupService.restoreCalls).toHaveLength(1);
    expect(restoreUseCase.calls).toHaveLength(0);
  });

  // Test 3: Backup exists + state branch exists + state branch lastSyncedAt newer → restore via RestoreStateUseCase
  it("prefers state branch when its lastSyncedAt is newer than backup timestamp", async () => {
    const root = makeTmpDir();
    tmps.push(root);
    const tffDir = join(root, ".tff");
    mkdirSync(tffDir, { recursive: true });
    restoreUseCase.tffDir = tffDir;

    const backupPath = buildBackupDir(root, ".tff.backup.2024-01-01T00-00-00-000Z");

    // State branch has newer lastSyncedAt
    const newerMeta = JSON.stringify({
      version: 1,
      stateId: "00000000-0000-4000-a000-000000000001",
      codeBranch: "main",
      stateBranch: "tff-state/main",
      parentStateBranch: null,
      lastSyncedAt: "2024-06-01T12:00:00.000Z",
      lastJournalOffset: 0,
      dirty: false,
      lastSyncedHash: null,
    });
    stateBranchOps.setBranchExists("tff-state/main", true);
    stateBranchOps.setReadResult("tff-state/main", "branch-meta.json", newerMeta);

    const scenario = makeScenario({
      currentBranch: "main",
      backupPaths: [backupPath],
      stateBranchExists: true,
    });

    const result = await strategy.execute(scenario, tffDir);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.action).toBe("restored");
    expect(restoreUseCase.calls).toHaveLength(1);
    expect(restoreUseCase.calls[0]).toBe("main");
    expect(backupService.restoreCalls).toHaveLength(0);
  });

  // Test 4: Backup restore fails → return report with action='created-fresh' (degradation signal)
  it("returns action='created-fresh' when backup restore throws", async () => {
    const root = makeTmpDir();
    tmps.push(root);
    const tffDir = join(root, ".tff");
    mkdirSync(tffDir, { recursive: true });

    const backupPath = buildBackupDir(root, ".tff.backup.2024-01-15T10-00-00-000Z");
    backupService.restoreError = new Error("disk full");

    const scenario = makeScenario({
      currentBranch: "main",
      backupPaths: [backupPath],
      stateBranchExists: false,
    });

    const result = await strategy.execute(scenario, tffDir);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.action).toBe("created-fresh");
    expect(result.data.warnings.length).toBeGreaterThan(0);
  });

  // Test 5: Multiple backups → sorts by filename descending, uses first (newest)
  it("sorts multiple backups by filename descending and uses the newest", async () => {
    const root = makeTmpDir();
    tmps.push(root);
    const tffDir = join(root, ".tff");
    mkdirSync(tffDir, { recursive: true });

    const oldBackup = buildBackupDir(root, ".tff.backup.2024-01-01T00-00-00-000Z");
    const midBackup = buildBackupDir(root, ".tff.backup.2024-06-01T00-00-00-000Z");
    const newestBackup = buildBackupDir(root, ".tff.backup.2024-12-31T23-59-59-999Z");

    // Pass in unsorted order
    const scenario = makeScenario({
      currentBranch: "main",
      backupPaths: [midBackup, oldBackup, newestBackup],
      stateBranchExists: false,
    });

    const result = await strategy.execute(scenario, tffDir);

    expect(result.ok).toBe(true);
    expect(backupService.restoreCalls).toHaveLength(1);
    expect(backupService.restoreCalls[0].backupPath).toBe(newestBackup);
  });
});
