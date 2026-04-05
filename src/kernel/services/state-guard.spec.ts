import { SyncError } from "@kernel/errors/sync.error";
import { LoggerPort } from "@kernel/ports/logger.port";
import { StateRecoveryPort } from "@kernel/ports/state-recovery.port";
import type { Result } from "@kernel/result";
import { err, ok } from "@kernel/result";
import type { RecoveryReport, RecoveryScenario } from "@kernel/schemas/recovery.schemas";
import { beforeEach, describe, expect, it } from "vitest";
import type { HealthCheckReport } from "./health-check.service";
import { StateGuard } from "./state-guard";

// ---------------------------------------------------------------------------
// StubStateRecoveryPort
// ---------------------------------------------------------------------------
class StubStateRecoveryPort extends StateRecoveryPort {
  detectCallCount = 0;
  recoverCallCount = 0;

  private detectResult: Result<RecoveryScenario, SyncError> = ok({
    type: "healthy",
    currentBranch: "main",
    branchMeta: null,
    backupPaths: [],
    stateBranchExists: false,
    parentStateBranch: null,
  });

  private recoverResult: Result<RecoveryReport, SyncError> = ok({
    type: "crash",
    action: "restored",
    source: "backup",
    filesRestored: 3,
    warnings: [],
  });

  givenDetectResult(result: Result<RecoveryScenario, SyncError>): void {
    this.detectResult = result;
  }

  givenRecoverResult(result: Result<RecoveryReport, SyncError>): void {
    this.recoverResult = result;
  }

  async detect(_tffDir: string): Promise<Result<RecoveryScenario, SyncError>> {
    this.detectCallCount++;
    return this.detectResult;
  }

  async recover(
    _scenario: RecoveryScenario,
    _tffDir: string,
  ): Promise<Result<RecoveryReport, SyncError>> {
    this.recoverCallCount++;
    return this.recoverResult;
  }
}

// ---------------------------------------------------------------------------
// StubHealthCheckService
// ---------------------------------------------------------------------------
class StubHealthCheckService {
  runAllCallCount = 0;

  async runAll(_tffDir: string): Promise<Result<HealthCheckReport, Error>> {
    this.runAllCallCount++;
    return ok({ fixed: [], warnings: [], driftDetails: [] });
  }
}

// ---------------------------------------------------------------------------
// StubLoggerPort
// ---------------------------------------------------------------------------
class StubLoggerPort extends LoggerPort {
  error(_message: string, _context?: Record<string, unknown>): void {}
  warn(_message: string, _context?: Record<string, unknown>): void {}
  info(_message: string, _context?: Record<string, unknown>): void {}
  debug(_message: string, _context?: Record<string, unknown>): void {}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
const TFF_DIR = "/fake/.tff";

describe("StateGuard", () => {
  let recoveryPort: StubStateRecoveryPort;
  let healthCheck: StubHealthCheckService;
  let logger: StubLoggerPort;
  let guard: StateGuard;

  beforeEach(() => {
    recoveryPort = new StubStateRecoveryPort();
    healthCheck = new StubHealthCheckService();
    logger = new StubLoggerPort();
    guard = new StateGuard(recoveryPort, healthCheck as never, logger);
  });

  it("healthy scenario — calls healthCheck.runAll + recoveryPort.detect, returns ok, recovery NOT called", async () => {
    recoveryPort.givenDetectResult(
      ok({
        type: "healthy",
        currentBranch: "main",
        branchMeta: null,
        backupPaths: [],
        stateBranchExists: false,
        parentStateBranch: null,
      }),
    );

    const result = await guard.ensure(TFF_DIR);

    expect(result.ok).toBe(true);
    expect(healthCheck.runAllCallCount).toBe(1);
    expect(recoveryPort.detectCallCount).toBe(1);
    expect(recoveryPort.recoverCallCount).toBe(0);
  });

  it("crash scenario — calls detect then recover, returns ok", async () => {
    recoveryPort.givenDetectResult(
      ok({
        type: "crash",
        currentBranch: "feature/x",
        branchMeta: null,
        backupPaths: ["/fake/.tff.backup.1"],
        stateBranchExists: true,
        parentStateBranch: null,
      }),
    );
    recoveryPort.givenRecoverResult(
      ok({
        type: "crash",
        action: "restored",
        source: "backup",
        filesRestored: 2,
        warnings: [],
      }),
    );

    const result = await guard.ensure(TFF_DIR);

    expect(result.ok).toBe(true);
    expect(recoveryPort.detectCallCount).toBe(1);
    expect(recoveryPort.recoverCallCount).toBe(1);
  });

  it("recovery fails — returns the SyncError from recover", async () => {
    recoveryPort.givenDetectResult(
      ok({
        type: "crash",
        currentBranch: "feature/x",
        branchMeta: null,
        backupPaths: [],
        stateBranchExists: false,
        parentStateBranch: null,
      }),
    );
    const syncError = new SyncError("RECOVER_FAILED", "Recovery failed");
    recoveryPort.givenRecoverResult(err(syncError));

    const result = await guard.ensure(TFF_DIR);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(syncError);
    }
  });

  it("detect fails — returns the SyncError from detect", async () => {
    const syncError = new SyncError("DETECT_FAILED", "Detect failed");
    recoveryPort.givenDetectResult(err(syncError));

    const result = await guard.ensure(TFF_DIR);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(syncError);
    }
    expect(recoveryPort.recoverCallCount).toBe(0);
  });

  it("idempotency — first call recovers crash, second call detects healthy → zero recovery calls on second invocation", async () => {
    // First call: crash scenario
    recoveryPort.givenDetectResult(
      ok({
        type: "crash",
        currentBranch: "feature/x",
        branchMeta: null,
        backupPaths: ["/fake/.tff.backup.1"],
        stateBranchExists: true,
        parentStateBranch: null,
      }),
    );
    recoveryPort.givenRecoverResult(
      ok({
        type: "crash",
        action: "restored",
        source: "backup",
        filesRestored: 5,
        warnings: [],
      }),
    );

    const firstResult = await guard.ensure(TFF_DIR);
    expect(firstResult.ok).toBe(true);
    expect(recoveryPort.recoverCallCount).toBe(1);

    // Second call: now healthy
    recoveryPort.givenDetectResult(
      ok({
        type: "healthy",
        currentBranch: "feature/x",
        branchMeta: null,
        backupPaths: [],
        stateBranchExists: true,
        parentStateBranch: null,
      }),
    );

    const secondResult = await guard.ensure(TFF_DIR);
    expect(secondResult.ok).toBe(true);
    // recoverCallCount should still be 1 — no new recovery on second call
    expect(recoveryPort.recoverCallCount).toBe(1);
    expect(recoveryPort.detectCallCount).toBe(2);
  });
});
