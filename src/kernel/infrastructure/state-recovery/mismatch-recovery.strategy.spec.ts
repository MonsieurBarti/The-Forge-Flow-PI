import { describe, it, expect } from 'vitest';
import { ok, err } from '@kernel/result';
import { SyncError } from '@kernel/errors';
import { MismatchRecoveryStrategy } from './mismatch-recovery.strategy';
import type { RestoreStateUseCase } from '@kernel/services/restore-state.use-case';
import type { RecoveryScenario } from '@kernel/schemas/recovery.schemas';

function makeRestoreUseCase(
  result: Awaited<ReturnType<RestoreStateUseCase['execute']>>,
): RestoreStateUseCase {
  return {
    execute: async (_branch: string) => result,
  } as unknown as RestoreStateUseCase;
}

const baseScenario: RecoveryScenario = {
  type: 'mismatch',
  currentBranch: 'feature/my-branch',
  branchMeta: null,
  backupPaths: [],
  stateBranchExists: true,
  parentStateBranch: null,
};

const tffDir = '/some/.tff';

describe('MismatchRecoveryStrategy', () => {
  it('handles mismatch type', () => {
    const strategy = new MismatchRecoveryStrategy(
      makeRestoreUseCase(ok({} as never)),
    );
    expect(strategy.handles).toBe('mismatch');
  });

  it('returns action=restored when restore succeeds', async () => {
    const restoreReport = {
      previousBranch: null,
      restoredBranch: 'feature/my-branch',
      dirtySaved: false,
      backupPath: '/backup/path',
      filesRestored: 3,
      backupsCleaned: 0,
    };
    const strategy = new MismatchRecoveryStrategy(
      makeRestoreUseCase(ok(restoreReport)),
    );

    const result = await strategy.execute(baseScenario, tffDir);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.action).toBe('restored');
    expect(result.data.type).toBe('mismatch');
    expect(result.data.source).toBe('tff-state/feature/my-branch');
    expect(result.data.filesRestored).toBe(3);
    expect(result.data.warnings).toEqual([]);
  });

  it('returns action=skipped when restore fails with LOCK_CONTENTION', async () => {
    const lockError = new SyncError('LOCK_CONTENTION', 'lock held by another process');
    const strategy = new MismatchRecoveryStrategy(
      makeRestoreUseCase(err(lockError)),
    );

    const result = await strategy.execute(baseScenario, tffDir);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.action).toBe('skipped');
    expect(result.data.type).toBe('mismatch');
    expect(result.data.source).toBe('tff-state/feature/my-branch');
  });

  it('returns action=skipped when restore fails with BRANCH_NOT_FOUND', async () => {
    const notFoundError = new SyncError('BRANCH_NOT_FOUND', 'state branch does not exist');
    const strategy = new MismatchRecoveryStrategy(
      makeRestoreUseCase(err(notFoundError)),
    );

    const result = await strategy.execute(baseScenario, tffDir);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.action).toBe('skipped');
  });

  it('returns err(SyncError RESTORE_FAILED) for other errors', async () => {
    const otherError = new SyncError('SOME_OTHER_ERROR', 'something went wrong');
    const strategy = new MismatchRecoveryStrategy(
      makeRestoreUseCase(err(otherError)),
    );

    const result = await strategy.execute(baseScenario, tffDir);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(SyncError);
    expect(result.error.code).toBe('SYNC.RESTORE_FAILED');
  });
});
