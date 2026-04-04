import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncOptions } from "@kernel/ports/state-sync.port";
import type { SyncReport } from "@kernel/ports/state-sync.schemas";
import type { StateSnapshot } from "@kernel/infrastructure/state-branch/state-snapshot.schemas";
import type { LockAcquirer } from "./restore-state.use-case";
import { SyncError } from "@kernel/errors";
import { err, ok, type Result } from "@kernel/result";
import { computeStateHash } from "./canonical-hash";
import { BackupService } from "./backup-service";
import {
  RestoreStateUseCase,
  type RestoreStateUseCaseDeps,
} from "./restore-state.use-case";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "tff-restore-test-"));
}

function buildTffDir(root: string): string {
  const tffDir = join(root, ".tff");
  mkdirSync(tffDir, { recursive: true });
  mkdirSync(join(tffDir, "worktrees"), { recursive: true });
  writeFileSync(join(tffDir, "state.db"), "db");
  return tffDir;
}

const MINIMAL_SNAPSHOT: StateSnapshot = {
  version: 1,
  exportedAt: new Date("2026-01-01T00:00:00.000Z"),
  project: null,
  milestones: [],
  slices: [],
  tasks: [],
  shipRecords: [],
  completionRecords: [],
};

function makeSnapshot(seed = "a"): StateSnapshot {
  return { ...MINIMAL_SNAPSHOT, exportedAt: new Date(`2026-0${seed.charCodeAt(0) % 9 + 1}-01T00:00:00.000Z`) };
}

const SYNC_REPORT_OK: SyncReport = {
  pulled: 5,
  conflicts: [],
  timestamp: new Date("2026-01-01T00:00:00.000Z"),
};

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

interface StateSyncCalls {
  syncToStateBranch: Array<[string, string, SyncOptions | undefined]>;
  restoreFromStateBranch: Array<[string, string, SyncOptions | undefined]>;
}

class StubStateSyncPort {
  calls: StateSyncCalls = { syncToStateBranch: [], restoreFromStateBranch: [] };

  syncToStateBranchResult: Result<void, SyncError> = ok(undefined);
  restoreFromStateBranchResult: Result<SyncReport, SyncError> = ok(SYNC_REPORT_OK);

  async syncToStateBranch(
    codeBranch: string,
    tffDir: string,
    options?: SyncOptions,
  ): Promise<Result<void, SyncError>> {
    this.calls.syncToStateBranch.push([codeBranch, tffDir, options]);
    return this.syncToStateBranchResult;
  }

  async restoreFromStateBranch(
    codeBranch: string,
    tffDir: string,
    options?: SyncOptions,
  ): Promise<Result<SyncReport, SyncError>> {
    this.calls.restoreFromStateBranch.push([codeBranch, tffDir, options]);
    return this.restoreFromStateBranchResult;
  }

  // Unused methods — satisfy abstract class shape if needed
  async mergeStateBranches(): Promise<Result<void, SyncError>> { return ok(undefined); }
  async createStateBranch(): Promise<Result<void, SyncError>> { return ok(undefined); }
  async deleteStateBranch(): Promise<Result<void, SyncError>> { return ok(undefined); }
}

class StubStateExporter {
  result: Result<StateSnapshot, SyncError> = ok(MINIMAL_SNAPSHOT);

  async export(): Promise<Result<StateSnapshot, SyncError>> {
    return this.result;
  }
}

class StubAdvisoryLock implements LockAcquirer {
  shouldFail = false;
  released = false;

  acquire(_lockPath: string): Result<() => void, SyncError> {
    if (this.shouldFail) {
      return err(new SyncError("LOCK_CONTENTION", "Lock held by another process"));
    }
    const release = () => { this.released = true; };
    return ok(release);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeDeps(overrides: {
  tffDir: string;
  stateSync?: StubStateSyncPort;
  stateExporter?: StubStateExporter;
  advisoryLock?: StubAdvisoryLock;
  backupService?: BackupService;
}): { deps: RestoreStateUseCaseDeps; stateSync: StubStateSyncPort; stateExporter: StubStateExporter; advisoryLock: StubAdvisoryLock } {
  const stateSync = overrides.stateSync ?? new StubStateSyncPort();
  const stateExporter = overrides.stateExporter ?? new StubStateExporter();
  const advisoryLock = overrides.advisoryLock ?? new StubAdvisoryLock();
  const backupService = overrides.backupService ?? new BackupService();

  const deps: RestoreStateUseCaseDeps = {
    stateSync: stateSync as unknown as RestoreStateUseCaseDeps["stateSync"],
    gitPort: {} as RestoreStateUseCaseDeps["gitPort"],
    advisoryLock,
    stateExporter: stateExporter as unknown as RestoreStateUseCaseDeps["stateExporter"],
    backupService,
    tffDir: overrides.tffDir,
  };

  return { deps, stateSync, stateExporter, advisoryLock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RestoreStateUseCase", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const r of roots.splice(0)) {
      rmSync(r, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------------------
  // 1. Happy path
  // ---------------------------------------------------------------------------

  it("happy path: dirty save → backup → clear → restore → update meta → clean backups", async () => {
    const root = makeTmpDir();
    roots.push(root);
    const tffDir = buildTffDir(root);

    const snapshot = makeSnapshot("a");
    const snapshotHash = computeStateHash(snapshot);
    const differentHash = "different-hash-not-matching";

    // Write branch-meta indicating previous branch with a different hash (dirty)
    const metaPath = join(tffDir, "branch-meta.json");
    const existingMeta = {
      version: 1,
      stateId: "a1b2c3d4-e5f6-4a7b-8c9d-aabbccddeeff",
      codeBranch: "feature/previous",
      stateBranch: "tff-state/feature/previous",
      parentStateBranch: null,
      lastSyncedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      lastJournalOffset: 0,
      dirty: false,
      lastSyncedHash: differentHash,
    };
    writeFileSync(metaPath, JSON.stringify(existingMeta));

    const stateExporter = new StubStateExporter();
    stateExporter.result = ok(snapshot);

    const { deps, stateSync } = makeDeps({ tffDir, stateExporter });
    const useCase = new RestoreStateUseCase(deps);

    const result = await useCase.execute("feature/target");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const report = result.data;
    expect(report.previousBranch).toBe("feature/previous");
    expect(report.restoredBranch).toBe("feature/target");
    expect(report.dirtySaved).toBe(true);
    expect(report.backupPath).toMatch(/\.tff\.backup\./);
    expect(report.filesRestored).toBe(5);
    expect(report.backupsCleaned).toBeGreaterThanOrEqual(0);

    // Both sync and restore should have been called
    expect(stateSync.calls.syncToStateBranch).toHaveLength(1);
    expect(stateSync.calls.syncToStateBranch[0][0]).toBe("feature/previous");
    expect(stateSync.calls.restoreFromStateBranch).toHaveLength(1);
    expect(stateSync.calls.restoreFromStateBranch[0][0]).toBe("feature/target");

    // branch-meta should be updated
    const updatedMeta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(updatedMeta.codeBranch).toBe("feature/target");
    expect(updatedMeta.stateBranch).toBe("tff-state/feature/target");
    expect(updatedMeta.dirty).toBe(false);
    expect(updatedMeta.lastJournalOffset).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 2. Clean state — skip dirty save
  // ---------------------------------------------------------------------------

  it("skips dirty save when hash matches lastSyncedHash", async () => {
    const root = makeTmpDir();
    roots.push(root);
    const tffDir = buildTffDir(root);

    const snapshot = makeSnapshot("b");
    const hash = computeStateHash(snapshot);

    const metaPath = join(tffDir, "branch-meta.json");
    writeFileSync(metaPath, JSON.stringify({
      version: 1,
      stateId: "b2c3d4e5-f6a7-4b8c-9d0e-aabbccddeeff",
      codeBranch: "feature/clean",
      stateBranch: "tff-state/feature/clean",
      parentStateBranch: null,
      lastSyncedAt: new Date().toISOString(),
      lastJournalOffset: 0,
      dirty: false,
      lastSyncedHash: hash,
    }));

    const stateExporter = new StubStateExporter();
    stateExporter.result = ok(snapshot);

    const { deps, stateSync } = makeDeps({ tffDir, stateExporter });
    const useCase = new RestoreStateUseCase(deps);

    const result = await useCase.execute("feature/target");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.dirtySaved).toBe(false);
    expect(stateSync.calls.syncToStateBranch).toHaveLength(0);
    expect(stateSync.calls.restoreFromStateBranch).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // 3. Lock contention
  // ---------------------------------------------------------------------------

  it("returns LOCK_CONTENTION error when lock cannot be acquired", async () => {
    const root = makeTmpDir();
    roots.push(root);
    const tffDir = buildTffDir(root);

    const lock = new StubAdvisoryLock();
    lock.shouldFail = true;

    const { deps, stateSync } = makeDeps({ tffDir, advisoryLock: lock });
    const useCase = new RestoreStateUseCase(deps);

    const result = await useCase.execute("feature/target");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toContain("LOCK_CONTENTION");
    expect(stateSync.calls.restoreFromStateBranch).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // 4. Target branch not found
  // ---------------------------------------------------------------------------

  it("returns RESTORE_FAILED when restoreFromStateBranch fails", async () => {
    const root = makeTmpDir();
    roots.push(root);
    const tffDir = buildTffDir(root);

    const stateSync = new StubStateSyncPort();
    stateSync.restoreFromStateBranchResult = err(
      new SyncError("BRANCH_NOT_FOUND", "tff-state/feature/missing not found"),
    );

    const { deps } = makeDeps({ tffDir, stateSync });
    const useCase = new RestoreStateUseCase(deps);

    const result = await useCase.execute("feature/missing");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toContain("RESTORE_FAILED");
  });

  // ---------------------------------------------------------------------------
  // 5. Dirty save fails — proceed anyway
  // ---------------------------------------------------------------------------

  it("proceeds with restore even when dirty save fails, sets dirtySaved=false", async () => {
    const root = makeTmpDir();
    roots.push(root);
    const tffDir = buildTffDir(root);

    const metaPath = join(tffDir, "branch-meta.json");
    writeFileSync(metaPath, JSON.stringify({
      version: 1,
      stateId: "c3d4e5f6-a7b8-4c9d-be1f-2a3b4c5d6e7f",
      codeBranch: "feature/dirty",
      stateBranch: "tff-state/feature/dirty",
      parentStateBranch: null,
      lastSyncedAt: new Date().toISOString(),
      lastJournalOffset: 0,
      dirty: false,
      lastSyncedHash: "old-hash",
    }));

    const stateSync = new StubStateSyncPort();
    stateSync.syncToStateBranchResult = err(
      new SyncError("EXPORT_FAILED", "dirty sync failed"),
    );

    const stateExporter = new StubStateExporter();
    stateExporter.result = ok(makeSnapshot("e"));

    const { deps } = makeDeps({ tffDir, stateSync, stateExporter });
    const useCase = new RestoreStateUseCase(deps);

    const result = await useCase.execute("feature/target");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.dirtySaved).toBe(false);
    expect(stateSync.calls.restoreFromStateBranch).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // 6. Restore fails — backup stays intact
  // ---------------------------------------------------------------------------

  it("returns RESTORE_FAILED and does not delete backup when restore fails", async () => {
    const root = makeTmpDir();
    roots.push(root);
    const tffDir = buildTffDir(root);

    const stateSync = new StubStateSyncPort();
    stateSync.restoreFromStateBranchResult = err(
      new SyncError("IMPORT_FAILED", "restore blew up"),
    );

    const { deps } = makeDeps({ tffDir, stateSync });
    const useCase = new RestoreStateUseCase(deps);

    const result = await useCase.execute("feature/target");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toContain("RESTORE_FAILED");
  });

  // ---------------------------------------------------------------------------
  // 7. branch-meta written with correct lastSyncedHash after restore
  // ---------------------------------------------------------------------------

  it("writes branch-meta.json with lastSyncedHash matching re-exported snapshot", async () => {
    const root = makeTmpDir();
    roots.push(root);
    const tffDir = buildTffDir(root);

    const postRestoreSnapshot = makeSnapshot("g");
    const expectedHash = computeStateHash(postRestoreSnapshot);

    // exporter always returns the same snapshot (pre and post restore)
    const stateExporter = new StubStateExporter();
    stateExporter.result = ok(postRestoreSnapshot);

    const { deps } = makeDeps({ tffDir, stateExporter });
    const useCase = new RestoreStateUseCase(deps);

    const result = await useCase.execute("feature/target");

    expect(result.ok).toBe(true);
    const metaPath = join(tffDir, "branch-meta.json");
    const written = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(written.lastSyncedHash).toBe(expectedHash);
  });

  // ---------------------------------------------------------------------------
  // 8. No branch-meta exists — skip dirty check, generate new stateId
  // ---------------------------------------------------------------------------

  it("skips dirty check and generates a new stateId when no branch-meta exists", async () => {
    const root = makeTmpDir();
    roots.push(root);
    const tffDir = buildTffDir(root);
    // Do NOT write branch-meta.json

    const { deps, stateSync } = makeDeps({ tffDir });
    const useCase = new RestoreStateUseCase(deps);

    const result = await useCase.execute("feature/target");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.previousBranch).toBeNull();
    expect(result.data.dirtySaved).toBe(false);
    expect(stateSync.calls.syncToStateBranch).toHaveLength(0);

    // A new stateId UUID should be in the written meta
    const metaPath = join(tffDir, "branch-meta.json");
    const written = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(typeof written.stateId).toBe("string");
    expect(written.stateId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  // ---------------------------------------------------------------------------
  // 9. Idempotency (AC6)
  // ---------------------------------------------------------------------------

  it("calling execute() twice with same target branch both succeed (full-snapshot replace)", async () => {
    const root = makeTmpDir();
    roots.push(root);
    const tffDir = buildTffDir(root);

    const { deps } = makeDeps({ tffDir });
    const useCase = new RestoreStateUseCase(deps);

    const first = await useCase.execute("feature/idempotent");
    expect(first.ok).toBe(true);

    const second = await useCase.execute("feature/idempotent");
    expect(second.ok).toBe(true);

    if (!first.ok || !second.ok) throw new Error("unreachable");
    expect(second.data.restoredBranch).toBe("feature/idempotent");
    expect(second.data.filesRestored).toBe(5);
  });

  // ---------------------------------------------------------------------------
  // Lock is always released
  // ---------------------------------------------------------------------------

  it("releases the advisory lock even when restore fails", async () => {
    const root = makeTmpDir();
    roots.push(root);
    const tffDir = buildTffDir(root);

    const lock = new StubAdvisoryLock();
    const stateSync = new StubStateSyncPort();
    stateSync.restoreFromStateBranchResult = err(
      new SyncError("IMPORT_FAILED", "oops"),
    );

    const { deps } = makeDeps({ tffDir, advisoryLock: lock, stateSync });
    const useCase = new RestoreStateUseCase(deps);

    await useCase.execute("feature/target");

    expect(lock.released).toBe(true);
  });
});
