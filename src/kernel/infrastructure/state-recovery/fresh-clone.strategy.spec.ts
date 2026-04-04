import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok, err } from '@kernel/result';
import { SyncError } from '@kernel/errors';
import { GitError } from '@kernel/errors';
import { FreshCloneStrategy } from './fresh-clone.strategy';
import type { BackupService } from '@kernel/services/backup-service';
import type { StateBranchOpsPort } from '@kernel/ports/state-branch-ops.port';
import type { RestoreStateUseCase } from '@kernel/services/restore-state.use-case';
import type { HealthCheckService } from '@kernel/services/health-check.service';
import type { RecoveryScenario } from '@kernel/schemas/recovery.schemas';

// ── Stub factories ───────────────────────────────────────────────────────────

function makeBackupService(restoreResult: 'ok' | 'throw' = 'ok'): BackupService {
  return {
    restoreFromBackup: (_backupPath: string, _tffDir: string) => {
      if (restoreResult === 'throw') throw new Error('restore failed');
    },
    createBackup: (_tffDir: string) => '/backup/path',
    cleanOldBackups: (_projectRoot: string, _keep?: number) => 0,
    clearTffDir: (_tffDir: string) => {},
  } as unknown as BackupService;
}

function makeStateBranchOps(branchExistsMap: Record<string, boolean> = {}): StateBranchOpsPort {
  return {
    branchExists: async (branchName: string) => {
      const exists = branchExistsMap[branchName] ?? false;
      return ok(exists);
    },
    readFromStateBranch: async (_stateBranch: string, _path: string) => ok(null),
    createOrphan: async () => ok(undefined),
    forkBranch: async () => ok(undefined),
    deleteBranch: async () => ok(undefined),
    renameBranch: async () => ok(undefined),
    syncToStateBranch: async () => ok('abc123'),
    readAllFromStateBranch: async () => ok(new Map()),
  } as unknown as StateBranchOpsPort;
}

function makeRestoreUseCase(
  result: Awaited<ReturnType<RestoreStateUseCase['execute']>>,
): RestoreStateUseCase {
  return {
    execute: async (_branch: string) => result,
  } as unknown as RestoreStateUseCase;
}

function makeHealthCheckService(): HealthCheckService {
  return {
    runAll: async (_tffDir: string) => ok({ fixed: [], warnings: [] }),
    ensurePostCheckoutHook: async () => ok(null),
    ensureGitignore: async () => ok(null),
    cleanStaleLocks: (_tffDir: string) => ok(null),
    checkOrphanedState: async (_tffDir: string) => ok([]),
  } as unknown as HealthCheckService;
}

const restoreReport = {
  previousBranch: null,
  restoredBranch: 'slice/M07-S05',
  dirtySaved: false,
  backupPath: '/backup/path',
  filesRestored: 5,
  backupsCleaned: 0,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeScenario(overrides: Partial<RecoveryScenario> = {}): RecoveryScenario {
  return {
    type: 'fresh-clone',
    currentBranch: 'slice/M07-S05',
    branchMeta: null,
    backupPaths: [],
    stateBranchExists: false,
    parentStateBranch: null,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('FreshCloneStrategy', () => {
  it('handles fresh-clone type', () => {
    const strategy = new FreshCloneStrategy(
      makeBackupService(),
      makeStateBranchOps(),
      makeRestoreUseCase(ok(restoreReport)),
      makeHealthCheckService(),
      '/project',
    );
    expect(strategy.handles).toBe('fresh-clone');
  });

  // TC1: backup files exist → restore newest backup
  it('TC1: restores from newest backup when backup files exist', async () => {
    const newestBackup = '/project/.tff.backup.2026-04-04T12-00-00';
    const olderBackup = '/project/.tff.backup.2026-04-04T10-00-00';
    const scenario = makeScenario({
      backupPaths: [olderBackup, newestBackup],
    });

    const strategy = new FreshCloneStrategy(
      makeBackupService(),
      makeStateBranchOps(),
      makeRestoreUseCase(ok(restoreReport)),
      makeHealthCheckService(),
      '/project',
    );

    const result = await strategy.execute(scenario, '/project/.tff');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.action).toBe('restored');
    expect(result.data.type).toBe('fresh-clone');
    expect(result.data.source).toBe(newestBackup);
  });

  // TC2: no backup + state branch exists → restore from state branch
  it('TC2: restores from state branch when no backup and state branch exists', async () => {
    const scenario = makeScenario({
      currentBranch: 'slice/M07-S05',
      backupPaths: [],
      stateBranchExists: true,
    });

    const strategy = new FreshCloneStrategy(
      makeBackupService(),
      makeStateBranchOps({ 'tff-state/slice/M07-S05': true }),
      makeRestoreUseCase(ok({ ...restoreReport, restoredBranch: 'slice/M07-S05', filesRestored: 5 })),
      makeHealthCheckService(),
      '/project',
    );

    const result = await strategy.execute(scenario, '/project/.tff');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.action).toBe('restored');
    expect(result.data.source).toBe('tff-state/slice/M07-S05');
    expect(result.data.filesRestored).toBe(5);
  });

  // TC3: no backup + no state branch + slice/M07-S05 → parent tff-state/milestone/M07
  it('TC3: restores from parent milestone state branch for slice/ branch', async () => {
    const scenario = makeScenario({
      currentBranch: 'slice/M07-S05',
      backupPaths: [],
      stateBranchExists: false,
    });

    const strategy = new FreshCloneStrategy(
      makeBackupService(),
      makeStateBranchOps({ 'tff-state/milestone/M07': true }),
      makeRestoreUseCase(ok({ ...restoreReport, restoredBranch: 'milestone/M07', filesRestored: 3 })),
      makeHealthCheckService(),
      '/project',
    );

    const result = await strategy.execute(scenario, '/project/.tff');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.action).toBe('restored');
    expect(result.data.source).toBe('tff-state/milestone/M07');
  });

  // TC4: milestone/M07 branch → parent is tff-state/main
  it('TC4: restores from tff-state/main for milestone/ branch', async () => {
    const scenario = makeScenario({
      currentBranch: 'milestone/M07',
      backupPaths: [],
      stateBranchExists: false,
    });

    const strategy = new FreshCloneStrategy(
      makeBackupService(),
      makeStateBranchOps({ 'tff-state/main': true }),
      makeRestoreUseCase(ok({ ...restoreReport, restoredBranch: 'main', filesRestored: 2 })),
      makeHealthCheckService(),
      '/project',
    );

    const result = await strategy.execute(scenario, '/project/.tff');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.action).toBe('restored');
    expect(result.data.source).toBe('tff-state/main');
  });

  // TC5: main branch → no parent → scaffold
  it('TC5: scaffolds fresh .tff/ for main branch (no parent)', async () => {
    let tempDir: string | null = null;
    try {
      tempDir = mkdtempSync(join(tmpdir(), 'tff-fresh-clone-test-'));
      const tffDir = join(tempDir, '.tff');

      const scenario = makeScenario({
        currentBranch: 'main',
        backupPaths: [],
        stateBranchExists: false,
      });

      const strategy = new FreshCloneStrategy(
        makeBackupService(),
        makeStateBranchOps(),
        makeRestoreUseCase(ok(restoreReport)),
        makeHealthCheckService(),
        tempDir,
      );

      const result = await strategy.execute(scenario, tffDir);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.action).toBe('created-fresh');
      expect(result.data.type).toBe('fresh-clone');
      expect(existsSync(tffDir)).toBe(true);
    } finally {
      if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // TC6: non-conventional branch feature/foo → no parent → scaffold
  it('TC6: scaffolds fresh .tff/ for non-conventional branch', async () => {
    let tempDir: string | null = null;
    try {
      tempDir = mkdtempSync(join(tmpdir(), 'tff-fresh-clone-test-'));
      const tffDir = join(tempDir, '.tff');

      const scenario = makeScenario({
        currentBranch: 'feature/foo',
        backupPaths: [],
        stateBranchExists: false,
      });

      const strategy = new FreshCloneStrategy(
        makeBackupService(),
        makeStateBranchOps(),
        makeRestoreUseCase(ok(restoreReport)),
        makeHealthCheckService(),
        tempDir,
      );

      const result = await strategy.execute(scenario, tffDir);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.action).toBe('created-fresh');
    } finally {
      if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // TC7: scaffold creates .tff/ with PROJECT.md, settings.yaml, branch-meta.json
  it('TC7: scaffold creates required files with valid content', async () => {
    let tempDir: string | null = null;
    try {
      tempDir = mkdtempSync(join(tmpdir(), 'tff-fresh-clone-test-'));
      const tffDir = join(tempDir, '.tff');

      const scenario = makeScenario({
        currentBranch: 'feature/new',
        backupPaths: [],
        stateBranchExists: false,
      });

      const strategy = new FreshCloneStrategy(
        makeBackupService(),
        makeStateBranchOps(),
        makeRestoreUseCase(ok(restoreReport)),
        makeHealthCheckService(),
        tempDir,
      );

      const result = await strategy.execute(scenario, tffDir);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const files = readdirSync(tffDir);
      expect(files).toContain('PROJECT.md');
      expect(files).toContain('settings.yaml');
      expect(files).toContain('branch-meta.json');

      const { readFileSync } = await import('node:fs');
      const meta = JSON.parse(readFileSync(join(tffDir, 'branch-meta.json'), 'utf-8'));
      expect(meta.version).toBe(1);
      expect(typeof meta.stateId).toBe('string');
      expect(meta.stateId.length).toBeGreaterThan(0);
      expect(meta.codeBranch).toBe('feature/new');
    } finally {
      if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
