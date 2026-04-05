import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdvisoryLock } from "./advisory-lock";

describe("AdvisoryLock", () => {
  let lock: AdvisoryLock;
  let lockPath: string;
  let tmpDir: string;

  beforeEach(() => {
    lock = new AdvisoryLock();
    tmpDir = join(tmpdir(), `tff-lock-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    lockPath = join(tmpDir, ".lock");
  });

  afterEach(() => {
    try {
      unlinkSync(lockPath);
    } catch {
      // Already removed
    }
  });

  it("acquire succeeds when no lock exists", () => {
    const result = lock.acquire(lockPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(existsSync(lockPath)).toBe(true);
      result.data(); // release
    }
  });

  it("release removes lock file", () => {
    const result = lock.acquire(lockPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      result.data(); // release
      expect(existsSync(lockPath)).toBe(false);
    }
  });

  it("stale lock is broken automatically", () => {
    // Write a lock file with a PID that doesn't exist
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: 999999999, acquiredAt: new Date().toISOString() }),
    );
    const result = lock.acquire(lockPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      result.data(); // release
    }
  });

  it("contention returns LOCK_CONTENTION error on timeout", () => {
    // Acquire first lock (current process PID — not stale)
    const first = lock.acquire(lockPath);
    expect(first.ok).toBe(true);

    // Try to acquire again with very short timeout
    const second = lock.acquire(lockPath, 100);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe("SYNC.LOCK_CONTENTION");
    }

    // Clean up
    if (first.ok) first.data();
  });
});
