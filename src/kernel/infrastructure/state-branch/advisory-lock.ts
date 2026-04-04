import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { SyncError } from "@kernel/errors";
import { err, ok, type Result } from "@kernel/result";

interface LockData {
  pid: number;
  acquiredAt: string;
}

export type LockRelease = () => void;

export class AdvisoryLock {
  private static readonly DEFAULT_TIMEOUT_MS = 5000;
  private static readonly POLL_INTERVAL_MS = 50;

  acquire(
    lockPath: string,
    timeoutMs: number = AdvisoryLock.DEFAULT_TIMEOUT_MS,
  ): Result<LockRelease, SyncError> {
    const deadline = Date.now() + timeoutMs;

    while (true) {
      try {
        writeFileSync(lockPath, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() } satisfies LockData), { flag: "wx" });
        const release = () => {
          try {
            unlinkSync(lockPath);
          } catch {
            // Already removed — safe to ignore
          }
        };
        return ok(release);
      } catch {
        // File exists — check if stale
        if (this.isStale(lockPath)) {
          try {
            unlinkSync(lockPath);
          } catch {
            // Race with another process — continue loop
          }
          continue;
        }

        if (Date.now() >= deadline) {
          return err(new SyncError("LOCK_CONTENTION", `Lock contention on ${lockPath} — timed out after ${timeoutMs}ms`));
        }

        // Busy-wait (synchronous lock)
        const waitUntil = Date.now() + AdvisoryLock.POLL_INTERVAL_MS;
        while (Date.now() < waitUntil) {
          // spin
        }
      }
    }
  }

  private isStale(lockPath: string): boolean {
    try {
      if (!existsSync(lockPath)) return true;
      const content = readFileSync(lockPath, "utf-8");
      const data: LockData = JSON.parse(content);
      try {
        process.kill(data.pid, 0);
        return false; // Process is alive
      } catch {
        return true; // Process is dead — stale lock
      }
    } catch {
      return true; // Malformed lock file — treat as stale
    }
  }
}
