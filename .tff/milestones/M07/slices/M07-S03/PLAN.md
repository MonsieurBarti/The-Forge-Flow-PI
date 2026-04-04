# M07-S03: Restore + Post-Checkout Hook + Fallback — Implementation Plan

> For agentic workers: execute task-by-task with TDD. Fork from `slice/M07-S02` branch.

**Goal:** Add three-layer state restore: post-checkout hook (optimization), BranchConsistencyGuard (primary safety net), DoctorService (self-healing). All converge on RestoreStateUseCase.

**Architecture:** Hexagonal — new ports in `kernel/ports/`, adapters in `kernel/infrastructure/`, services in `kernel/services/`. RestoreStateUseCase is the sole lock holder; StateSyncPort methods accept optional lockToken to prevent deadlock.

**Tech Stack:** TypeScript, Vitest, Zod, better-sqlite3, Node crypto (SHA-256)

## File Structure

### New Files
| File | Responsibility |
|---|---|
| `src/kernel/services/canonical-hash.ts` | Deterministic SHA-256 of state snapshots (recursive key sort + hash) |
| `src/kernel/services/canonical-hash.spec.ts` | Tests for canonical hash |
| `src/kernel/ports/git-hook.port.ts` | GitHookPort abstract class + HookError |
| `src/kernel/infrastructure/git-hook/git-hook.adapter.ts` | Manages delimited section in `.git/hooks/post-checkout` |
| `src/kernel/infrastructure/git-hook/git-hook.adapter.spec.ts` | Tests for GitHookAdapter |
| `src/kernel/services/backup-service.ts` | Backup `.tff/` → `.tff.backup.<ts>`, cleanup, clear |
| `src/kernel/services/backup-service.spec.ts` | Tests for BackupService |
| `src/kernel/services/restore-state.use-case.ts` | 10-step restore protocol |
| `src/kernel/services/restore-state.use-case.spec.ts` | Tests for RestoreStateUseCase |
| `src/kernel/services/doctor-service.ts` | 5-check self-healing diagnostics |
| `src/kernel/services/doctor-service.spec.ts` | Tests for DoctorService |
| `src/kernel/services/branch-consistency-guard.ts` | Pre-command branch mismatch detection |
| `src/kernel/services/branch-consistency-guard.spec.ts` | Tests for BranchConsistencyGuard |
| `src/kernel/infrastructure/restore-entry.ts` | Minimal hook entry point (bootstrap + call RestoreStateUseCase) |

### Modified Files
| File | Change |
|---|---|
| `src/kernel/infrastructure/state-branch/state-snapshot.schemas.ts` | Add `lastSyncedHash` to BranchMetaSchema |
| `src/kernel/infrastructure/state-branch/state-snapshot.schemas.spec.ts` | Test `lastSyncedHash` default |
| `src/kernel/ports/git.port.ts` | Add `currentBranch()` abstract method |
| `src/kernel/infrastructure/git-cli.adapter.ts` | Implement `currentBranch()` |
| `src/kernel/infrastructure/in-memory-git.adapter.ts` | Implement `currentBranch()` stub |
| `src/kernel/ports/state-sync.port.ts` | Add optional `options?: { lockToken?: LockRelease }` to sync/restore |
| `src/kernel/infrastructure/state-branch/git-state-sync.adapter.ts` | Honor lockToken — skip lock acquire when provided |
| `src/kernel/infrastructure/state-branch/git-state-sync.adapter.spec.ts` | Add lockToken test |
| `src/hexagons/project/use-cases/init-project.use-case.ts` | Add GitHookPort dep, install hook at end |
| `src/cli/extension.ts` | Wire GitHookAdapter, BackupService, DoctorService, BranchConsistencyGuard, RestoreStateUseCase |
| `.gitignore` | Add `.tff.backup.*` |
| `src/kernel/ports/index.ts` | Export GitHookPort, HookError |
| `src/kernel/index.ts` | Export new ports/services |

---

## Wave 0 — Foundation (parallel, no dependencies)

### T01: BranchMetaSchema `lastSyncedHash` + canonical hash utility

**Files:**
- EDIT `src/kernel/infrastructure/state-branch/state-snapshot.schemas.ts` — add `lastSyncedHash`
- EDIT `src/kernel/infrastructure/state-branch/state-snapshot.schemas.spec.ts` — test default
- CREATE `src/kernel/services/canonical-hash.ts`
- CREATE `src/kernel/services/canonical-hash.spec.ts`

**Work:**

1. Add to `BranchMetaSchema`:
```typescript
lastSyncedHash: z.string().nullable().default(null),
```

2. Create canonical hash utility:
```typescript
// src/kernel/services/canonical-hash.ts
import { createHash } from "node:crypto";

function sortKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  return Object.keys(obj as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((sorted, key) => {
      sorted[key] = sortKeys((obj as Record<string, unknown>)[key]);
      return sorted;
    }, {});
}

export function computeStateHash(snapshot: unknown): string {
  const canonical = JSON.stringify(sortKeys(snapshot));
  return createHash("sha256").update(canonical).digest("hex");
}
```

**AC:** AC10

**Test:**
- `computeStateHash` produces consistent SHA-256 for same input
- Key order doesn't affect hash (objects with different key order → same hash)
- Nested objects and arrays handled correctly
- BranchMetaSchema parses with `lastSyncedHash: null` default

**Run:** `npx vitest run src/kernel/services/canonical-hash.spec.ts src/kernel/infrastructure/state-branch/state-snapshot.schemas.spec.ts`

**Commit:** `feat(S03/T01): add lastSyncedHash to BranchMetaSchema + canonical hash utility`

---

### T02: GitPort `currentBranch()` + GitCliAdapter implementation

**Files:**
- EDIT `src/kernel/ports/git.port.ts` — add abstract method
- EDIT `src/kernel/infrastructure/git-cli.adapter.ts` — implement
- EDIT `src/kernel/infrastructure/in-memory-git.adapter.ts` — add stub

**Work:**

1. Add to `GitPort`:
```typescript
abstract currentBranch(): Promise<Result<string | null, GitError>>;
```

2. Implement in `GitCliAdapter`:
```typescript
async currentBranch(): Promise<Result<string | null, GitError>> {
  const result = await this.runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!result.ok) return result;
  const branch = result.data.trim();
  return ok(branch === "HEAD" ? null : branch);
}
```

3. Stub in `InMemoryGitAdapter`:
```typescript
private _currentBranch: string | null = "main";

setCurrentBranch(branch: string | null): void {
  this._currentBranch = branch;
}

async currentBranch(): Promise<Result<string | null, GitError>> {
  return ok(this._currentBranch);
}
```

**AC:** AC5, AC14

**Test:** Integration test with real git repo — returns current branch name; returns `null` on detached HEAD.

**Run:** `npx vitest run src/kernel/infrastructure/git-cli.adapter`

**Commit:** `feat(S03/T02): add currentBranch() to GitPort + GitCliAdapter`

---

### T03: GitHookPort + GitHookAdapter

**Files:**
- CREATE `src/kernel/ports/git-hook.port.ts`
- CREATE `src/kernel/infrastructure/git-hook/git-hook.adapter.ts`
- CREATE `src/kernel/infrastructure/git-hook/git-hook.adapter.spec.ts`
- EDIT `src/kernel/ports/index.ts` — export GitHookPort, HookError

**Work:**

1. Port definition:
```typescript
// src/kernel/ports/git-hook.port.ts
import type { Result } from "@kernel/result";
import { BaseDomainError } from "@kernel/errors";

export type HookErrorCode = "HOOK_DIR_NOT_FOUND" | "PERMISSION_DENIED" | "WRITE_FAILED";

export class HookError extends BaseDomainError {
  readonly code: string;
  constructor(code: HookErrorCode, message: string) {
    super(message);
    this.code = `HOOK.${code}`;
  }
}

export abstract class GitHookPort {
  abstract installPostCheckoutHook(scriptContent: string): Promise<Result<void, HookError>>;
  abstract isPostCheckoutHookInstalled(): Promise<Result<boolean, HookError>>;
  abstract uninstallPostCheckoutHook(): Promise<Result<void, HookError>>;
}
```

2. Adapter — manages delimited section in `.git/hooks/post-checkout`:
```typescript
// src/kernel/infrastructure/git-hook/git-hook.adapter.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { ok, err, type Result } from "@kernel/result";
import { GitHookPort, HookError } from "@kernel/ports/git-hook.port";

const BEGIN_MARKER = "# --- TFF-PI BEGIN (do not edit) ---";
const END_MARKER = "# --- TFF-PI END ---";
const SHEBANG = "#!/bin/sh";

export class GitHookAdapter extends GitHookPort {
  constructor(private readonly gitDir: string) { super(); }

  async installPostCheckoutHook(scriptContent: string): Promise<Result<void, HookError>> {
    const hooksDir = join(this.gitDir, "hooks");
    if (!existsSync(this.gitDir)) {
      return err(new HookError("HOOK_DIR_NOT_FOUND", `.git directory not found: ${this.gitDir}`));
    }
    mkdirSync(hooksDir, { recursive: true });

    const hookPath = join(hooksDir, "post-checkout");
    let existing = "";
    if (existsSync(hookPath)) {
      existing = readFileSync(hookPath, "utf-8");
    }

    // Remove old TFF section if present
    const cleaned = this.removeSection(existing);

    // Build new content
    const section = `${BEGIN_MARKER}\n${scriptContent}\n${END_MARKER}`;
    let content: string;
    if (!cleaned || cleaned.trim() === "") {
      content = `${SHEBANG}\n\n${section}\n`;
    } else if (!cleaned.startsWith("#!")) {
      content = `${SHEBANG}\n\n${cleaned.trimEnd()}\n\n${section}\n`;
    } else {
      content = `${cleaned.trimEnd()}\n\n${section}\n`;
    }

    try {
      writeFileSync(hookPath, content);
      chmodSync(hookPath, 0o755);
      return ok(undefined);
    } catch (e) {
      return err(new HookError("WRITE_FAILED", e instanceof Error ? e.message : String(e)));
    }
  }

  async isPostCheckoutHookInstalled(): Promise<Result<boolean, HookError>> {
    const hookPath = join(this.gitDir, "hooks", "post-checkout");
    if (!existsSync(hookPath)) return ok(false);
    const content = readFileSync(hookPath, "utf-8");
    return ok(content.includes(BEGIN_MARKER));
  }

  async uninstallPostCheckoutHook(): Promise<Result<void, HookError>> {
    const hookPath = join(this.gitDir, "hooks", "post-checkout");
    if (!existsSync(hookPath)) return ok(undefined);
    const content = readFileSync(hookPath, "utf-8");
    const cleaned = this.removeSection(content);
    writeFileSync(hookPath, cleaned);
    return ok(undefined);
  }

  private removeSection(content: string): string {
    const beginIdx = content.indexOf(BEGIN_MARKER);
    if (beginIdx === -1) return content;
    const endIdx = content.indexOf(END_MARKER);
    if (endIdx === -1) return content;
    const before = content.slice(0, beginIdx);
    const after = content.slice(endIdx + END_MARKER.length);
    return (before + after).replace(/\n{3,}/g, "\n\n");
  }
}
```

Hook script content (passed by caller):
```bash
if [ "$3" = "1" ]; then
  node -e "require('./node_modules/.tff-restore.js')" 2>/dev/null || true
fi
```

**AC:** AC1, AC2, AC7, AC8

**Test:**
- `installPostCheckoutHook` creates hook file with markers + content + shebang + chmod +x
- Install on existing hook preserves user content outside markers
- Install is idempotent (second call replaces section, not duplicates)
- `isPostCheckoutHookInstalled` returns true after install, false before
- `uninstallPostCheckoutHook` removes delimited section, preserves user hooks
- Missing `.git` dir → `HOOK_DIR_NOT_FOUND`

**Run:** `npx vitest run src/kernel/infrastructure/git-hook/git-hook.adapter.spec.ts`

**Commit:** `feat(S03/T03): add GitHookPort + GitHookAdapter`

---

### T04: BackupService

**Files:**
- CREATE `src/kernel/services/backup-service.ts`
- CREATE `src/kernel/services/backup-service.spec.ts`

**Work:**

```typescript
// src/kernel/services/backup-service.ts
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export class BackupService {
  createBackup(tffDir: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${tffDir}.backup.${timestamp}`;

    cpSync(tffDir, backupPath, {
      recursive: true,
      filter: (src) => {
        const rel = src.slice(tffDir.length);
        if (rel.startsWith("/worktrees") || rel.startsWith("\\worktrees")) return false;
        if (basename(src) === ".lock") return false;
        return true;
      },
    });

    return backupPath;
  }

  cleanOldBackups(projectRoot: string, keep: number = 3): number {
    const entries = readdirSync(projectRoot)
      .filter((e) => e.startsWith(".tff.backup."))
      .map((e) => ({ name: e, path: join(projectRoot, e) }))
      .sort((a, b) => b.name.localeCompare(a.name)); // newest first

    let cleaned = 0;
    for (const entry of entries.slice(keep)) {
      rmSync(entry.path, { recursive: true, force: true });
      cleaned++;
    }
    return cleaned;
  }

  clearTffDir(tffDir: string): void {
    if (!existsSync(tffDir)) return;
    const entries = readdirSync(tffDir);
    for (const entry of entries) {
      if (entry === "worktrees" || entry === ".lock") continue;
      rmSync(join(tffDir, entry), { recursive: true, force: true });
    }
  }

  restoreFromBackup(backupPath: string, tffDir: string): void {
    this.clearTffDir(tffDir);
    cpSync(backupPath, tffDir, { recursive: true });
  }
}
```

**AC:** AC4, AC11, AC13

**Test:**
- `createBackup` copies `.tff/` to `.tff.backup.<ts>`, excludes `worktrees/` and `.lock`
- `cleanOldBackups` keeps last N, removes oldest beyond limit
- `clearTffDir` removes contents except `worktrees/` and `.lock`
- `restoreFromBackup` clears tffDir then copies backup contents in
- All use temp dirs for isolation

**Run:** `npx vitest run src/kernel/services/backup-service.spec.ts`

**Commit:** `feat(S03/T04): add BackupService`

---

## Wave 1 — Lock pass-through (depends on Wave 0)

### T05: StateSyncPort lockToken extension

**Files:**
- EDIT `src/kernel/ports/state-sync.port.ts` — add optional options param
- EDIT `src/kernel/infrastructure/state-branch/git-state-sync.adapter.ts` — honor lockToken
- EDIT `src/kernel/infrastructure/state-branch/git-state-sync.adapter.spec.ts` — test lockToken path

**Work:**

1. Add `SyncOptions` type and update port signatures:
```typescript
// src/kernel/ports/state-sync.port.ts
import type { LockRelease } from "@kernel/infrastructure/state-branch/advisory-lock";

export interface SyncOptions {
  lockToken?: LockRelease;
}

export abstract class StateSyncPort {
  abstract syncToStateBranch(
    codeBranch: string, tffDir: string, options?: SyncOptions,
  ): Promise<Result<void, SyncError>>;
  abstract restoreFromStateBranch(
    codeBranch: string, tffDir: string, options?: SyncOptions,
  ): Promise<Result<SyncReport, SyncError>>;
  // mergeStateBranches, createStateBranch, deleteStateBranch unchanged
}
```

2. Update adapter — when `options?.lockToken` provided, skip `acquire()` and don't release:
```typescript
// In GitStateSyncAdapter.syncToStateBranch and restoreFromStateBranch:
let release: LockRelease | undefined;
if (options?.lockToken) {
  // Caller holds the lock — don't acquire
} else {
  const lockResult = this.deps.advisoryLock.acquire(lockPath);
  if (!lockResult.ok) return lockResult;
  release = lockResult.data;
}
try {
  // ... existing logic unchanged ...
} finally {
  release?.();
}
```

**AC:** AC3

**Test:**
- With lockToken: adapter skips lock acquisition, operation succeeds
- Without lockToken: existing behavior unchanged (lock acquired internally)

**Run:** `npx vitest run src/kernel/infrastructure/state-branch/git-state-sync.adapter.spec.ts`

**Commit:** `feat(S03/T05): add lockToken pass-through to StateSyncPort`

---

## Wave 2 — Core restore (depends on T01, T02, T04, T05)

### T06: RestoreStateUseCase

**Files:**
- CREATE `src/kernel/services/restore-state.use-case.ts`
- CREATE `src/kernel/services/restore-state.use-case.spec.ts`

**Work:**

```typescript
// src/kernel/services/restore-state.use-case.ts
import type { StateSyncPort } from "@kernel/ports/state-sync.port";
import type { GitPort } from "@kernel/ports/git.port";
import type { AdvisoryLock, LockRelease } from "@kernel/infrastructure/state-branch/advisory-lock";
import type { StateExporter } from "@kernel/services/state-exporter";
import type { BackupService } from "./backup-service";
import { BranchMetaSchema, type BranchMeta } from "@kernel/infrastructure/state-branch/state-snapshot.schemas";
import { computeStateHash } from "./canonical-hash";
import { SyncError } from "@kernel/errors";
import { err, ok, type Result } from "@kernel/result";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface RestoreReport {
  previousBranch: string | null;
  restoredBranch: string;
  dirtySaved: boolean;
  backupPath: string;
  filesRestored: number;
  backupsCleaned: number;
}

export interface RestoreStateUseCaseDeps {
  stateSync: StateSyncPort;
  gitPort: GitPort;
  advisoryLock: AdvisoryLock;
  stateExporter: StateExporter;
  backupService: BackupService;
  tffDir: string;
}

export class RestoreStateUseCase {
  constructor(private readonly deps: RestoreStateUseCaseDeps) {}

  async execute(targetCodeBranch: string): Promise<Result<RestoreReport, SyncError>> {
    const { stateSync, advisoryLock, stateExporter, backupService, tffDir } = this.deps;
    const lockPath = join(tffDir, ".lock");
    const metaPath = join(tffDir, "branch-meta.json");
    const projectRoot = join(tffDir, "..");

    // 1. Acquire lock
    const lockResult = advisoryLock.acquire(lockPath);
    if (!lockResult.ok) return lockResult;
    const release = lockResult.data;
    const lockToken: LockRelease = () => {}; // no-op — this use case holds real lock

    try {
      // 2. Read branch-meta → previousBranch
      let previousBranch: string | null = null;
      let meta: BranchMeta | null = null;
      if (existsSync(metaPath)) {
        const raw = JSON.parse(readFileSync(metaPath, "utf-8"));
        meta = BranchMetaSchema.parse(raw);
        previousBranch = meta.codeBranch;
      }

      // 3. Dirty check: export → hash → compare to lastSyncedHash
      let dirtySaved = false;
      if (meta && previousBranch) {
        const exportResult = await stateExporter.export();
        if (exportResult.ok) {
          const currentHash = computeStateHash(exportResult.data);
          if (meta.lastSyncedHash !== currentHash) {
            const syncResult = await stateSync.syncToStateBranch(
              previousBranch, tffDir, { lockToken },
            );
            dirtySaved = syncResult.ok;
            // If dirty save fails, proceed — backup is safety net
          }
        }
      }

      // 4. Backup .tff/
      const backupPath = backupService.createBackup(tffDir);

      // 5. Clear .tff/ (preserve worktrees/, .lock)
      backupService.clearTffDir(tffDir);

      // 6. Restore from target state branch
      const restoreResult = await stateSync.restoreFromStateBranch(
        targetCodeBranch, tffDir, { lockToken },
      );
      if (!restoreResult.ok) {
        return err(new SyncError(
          "RESTORE_FAILED",
          `Restore from tff-state/${targetCodeBranch} failed: ${restoreResult.error.message}`,
        ));
      }

      // 7. Journal catch-up
      // S02's restoreFromStateBranch() does full-snapshot import (StateImporter.import)
      // which replaces all DB state from the snapshot. The journal.jsonl is written to
      // disk as a file by restoreFromStateBranch. Since the snapshot IS the full state,
      // journal replay on top of a full import is a no-op — the snapshot already contains
      // the result of all journal entries. Journal offset is reset to 0 for the new branch.
      // AC6 (idempotency) is satisfied: re-running restore with the same snapshot produces
      // identical state because StateImporter.import() clears + re-inserts.
      const filesRestored = restoreResult.data.pulled;

      // 8. Update branch-meta.json
      const exportAfter = await stateExporter.export();
      const newHash = exportAfter.ok ? computeStateHash(exportAfter.data) : null;
      const restoredMeta: BranchMeta = {
        version: 1,
        stateId: meta?.stateId ?? crypto.randomUUID(),
        codeBranch: targetCodeBranch,
        stateBranch: `tff-state/${targetCodeBranch}`,
        parentStateBranch: meta?.parentStateBranch ?? null,
        lastSyncedAt: new Date(),
        lastJournalOffset: 0,
        dirty: false,
        lastSyncedHash: newHash,
      };
      writeFileSync(metaPath, JSON.stringify(restoredMeta, null, 2));

      // 9. Clean old backups (keep last 3)
      const backupsCleaned = backupService.cleanOldBackups(projectRoot, 3);

      // 10. Release lock (in finally)
      return ok({
        previousBranch,
        restoredBranch: targetCodeBranch,
        dirtySaved,
        backupPath,
        filesRestored,
        backupsCleaned,
      });
    } finally {
      release();
    }
  }
}
```

**AC:** AC1, AC3, AC4, AC6, AC10, AC11

**Test (stubs for ports):**
- Happy path: dirty save → backup → clear → restore → update meta → clean backups
- Clean state (hash matches): skip dirty save, `dirtySaved = false`
- Lock contention: return `LOCK_CONTENTION` without blocking
- Target branch not found: return `BRANCH_NOT_FOUND`
- Dirty save fails: proceed with restore anyway (backup is safety net)
- Restore fails: leave backup intact, return `RESTORE_FAILED`
- Branch-meta written with correct `lastSyncedHash` after restore
- No branch-meta exists: skip dirty check, generate new `stateId`
- `filesRestored` reports file count from state branch (not journal entries)
- **Idempotency (AC6):** calling `execute()` twice with same target branch produces identical DB state. Second run detects no dirty changes (hash matches), skips dirty save, and full-snapshot import via `StateImporter.import()` replaces all state (clear + re-insert). Assert: DB contents after first restore === DB contents after second restore. This relies on `StateImporter.import()` performing clear-before-insert — document this contract explicitly.

**Run:** `npx vitest run src/kernel/services/restore-state.use-case.spec.ts`

**Commit:** `feat(S03/T06): add RestoreStateUseCase`

---

## Wave 3 — Safety services (depends on T03, T06)

### T07: DoctorService

**Files:**
- CREATE `src/kernel/services/doctor-service.ts`
- CREATE `src/kernel/services/doctor-service.spec.ts`

**Work:**

```typescript
// src/kernel/services/doctor-service.ts
import type { GitHookPort } from "@kernel/ports/git-hook.port";
import type { StateBranchOpsPort } from "@kernel/ports/state-branch-ops.port";
import type { GitPort } from "@kernel/ports/git.port";
import type { BackupService } from "./backup-service";
import { existsSync, readFileSync, readdirSync, unlinkSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export interface DiagnosticReport {
  fixed: string[];
  warnings: string[];
}

export interface DoctorServiceDeps {
  gitHookPort: GitHookPort;
  stateBranchOps: StateBranchOpsPort;
  gitPort: GitPort;
  backupService: BackupService;
  hookScriptContent: string;
  projectRoot: string;
}

export class DoctorService {
  constructor(private readonly deps: DoctorServiceDeps) {}

  async diagnoseAndFix(tffDir: string): Promise<DiagnosticReport> {
    const report: DiagnosticReport = { fixed: [], warnings: [] };

    // Check 1: Crash recovery — backup exists + branch-meta missing
    this.checkCrashRecovery(tffDir, report);

    // Check 2: Post-checkout hook missing
    await this.checkHook(report);

    // Check 3: branch-meta missing but state branch exists
    await this.checkOrphanedState(tffDir, report);

    // Check 4: .gitignore missing entries
    this.checkGitignore(report);

    // Check 5: Stale lock
    this.checkStaleLock(tffDir, report);

    return report;
  }

  private checkCrashRecovery(tffDir: string, report: DiagnosticReport): void {
    const projectRoot = this.deps.projectRoot;
    const metaPath = join(tffDir, "branch-meta.json");
    if (existsSync(metaPath)) return; // meta exists — no crash

    const backups = readdirSync(projectRoot)
      .filter((e) => e.startsWith(".tff.backup."))
      .sort()
      .reverse(); // newest first

    if (backups.length === 0) return;

    const newestBackup = join(projectRoot, backups[0]);
    this.deps.backupService.restoreFromBackup(newestBackup, tffDir);
    report.fixed.push(`Crash recovery: restored from ${backups[0]}`);
  }

  private async checkHook(report: DiagnosticReport): Promise<void> {
    const result = await this.deps.gitHookPort.isPostCheckoutHookInstalled();
    if (!result.ok || result.data) return; // installed or error

    const installResult = await this.deps.gitHookPort.installPostCheckoutHook(
      this.deps.hookScriptContent,
    );
    if (installResult.ok) {
      report.fixed.push("Post-checkout hook installed");
    }
  }

  private async checkOrphanedState(tffDir: string, report: DiagnosticReport): Promise<void> {
    const metaPath = join(tffDir, "branch-meta.json");
    if (existsSync(metaPath)) return;

    const branchResult = await this.deps.gitPort.currentBranch();
    if (!branchResult.ok || branchResult.data === null) return;

    const stateBranch = `tff-state/${branchResult.data}`;
    const existsResult = await this.deps.stateBranchOps.branchExists(stateBranch);
    if (existsResult.ok && existsResult.data) {
      report.warnings.push(`State branch ${stateBranch} exists but no branch-meta.json — restore needed`);
    }
  }

  private checkGitignore(report: DiagnosticReport): void {
    const gitignorePath = join(this.deps.projectRoot, ".gitignore");
    if (!existsSync(gitignorePath)) return;

    const content = readFileSync(gitignorePath, "utf-8");
    const lines = content.split("\n");
    const missing: string[] = [];

    if (!lines.some((l) => l.trim() === ".tff/")) missing.push(".tff/");
    if (!lines.some((l) => l.trim() === ".tff.backup.*")) missing.push(".tff.backup.*");

    if (missing.length > 0) {
      const suffix = (content.endsWith("\n") ? "" : "\n") + missing.join("\n") + "\n";
      appendFileSync(gitignorePath, suffix);
      report.fixed.push(`.gitignore: added ${missing.join(", ")}`);
    }
  }

  private checkStaleLock(tffDir: string, report: DiagnosticReport): void {
    const lockPath = join(tffDir, ".lock");
    if (!existsSync(lockPath)) return;

    try {
      const raw = JSON.parse(readFileSync(lockPath, "utf-8"));
      const pid = raw.pid as number;
      const acquiredAt = new Date(raw.acquiredAt as string);

      // Check if PID is alive
      try {
        process.kill(pid, 0);
        // Process alive — check age fallback
        const ageMs = Date.now() - acquiredAt.getTime();
        if (ageMs > 5 * 60 * 1000) {
          unlinkSync(lockPath);
          report.fixed.push(`Stale lock removed (age: ${Math.round(ageMs / 1000)}s, PID ${pid})`);
        }
      } catch {
        // ESRCH — process dead
        unlinkSync(lockPath);
        report.fixed.push(`Stale lock removed (dead PID ${pid})`);
      }
    } catch {
      // Malformed lock — remove
      unlinkSync(lockPath);
      report.fixed.push("Stale lock removed (malformed)");
    }
  }
}
```

**AC:** AC8, AC9, AC12, AC13

**Test:**
- Crash recovery: backup exists + no branch-meta → restored from backup
- Hook missing → installed
- branch-meta missing + state branch exists → warning emitted
- .gitignore missing `.tff.backup.*` → appended
- .gitignore already has entries → no change
- Stale lock with dead PID → removed
- Fresh lock with live PID → left alone
- Stale lock older than 5min even with live PID → removed (age fallback)
- Malformed lock file → removed
- Non-throwing: all checks complete even if individual checks error

**Run:** `npx vitest run src/kernel/services/doctor-service.spec.ts`

**Commit:** `feat(S03/T07): add DoctorService`

---

### T08: BranchConsistencyGuard

**Files:**
- CREATE `src/kernel/services/branch-consistency-guard.ts`
- CREATE `src/kernel/services/branch-consistency-guard.spec.ts`

**Work:**

```typescript
// src/kernel/services/branch-consistency-guard.ts
import { SyncError } from "@kernel/errors";
import { ok, err, type Result } from "@kernel/result";
import type { GitPort } from "@kernel/ports/git.port";
import type { StateBranchOpsPort } from "@kernel/ports/state-branch-ops.port";
import type { DoctorService } from "./doctor-service";
import type { RestoreStateUseCase } from "./restore-state.use-case";
import { BranchMetaSchema } from "@kernel/infrastructure/state-branch/state-snapshot.schemas";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export class BranchConsistencyGuard {
  constructor(
    private readonly doctor: DoctorService,
    private readonly gitPort: GitPort,
    private readonly restoreUseCase: RestoreStateUseCase,
    private readonly stateBranchOps: StateBranchOpsPort,
  ) {}

  async ensure(tffDir: string): Promise<Result<void, SyncError>> {
    // 1. Self-heal first
    await this.doctor.diagnoseAndFix(tffDir);

    // 2. Get current branch
    const branchResult = await this.gitPort.currentBranch();
    if (!branchResult.ok) return ok(undefined);
    const currentBranch = branchResult.data;

    // 3. Detached HEAD → skip
    if (currentBranch === null) return ok(undefined);

    // 4. Read branch-meta
    const metaPath = join(tffDir, "branch-meta.json");
    if (existsSync(metaPath)) {
      const meta = BranchMetaSchema.parse(JSON.parse(readFileSync(metaPath, "utf-8")));

      // 5. Match → ok
      if (meta.codeBranch === currentBranch) return ok(undefined);

      // 6. Mismatch → restore
      return this.tryRestore(currentBranch);
    }

    // 7. No meta — check if state branch exists for current branch
    const stateBranch = `tff-state/${currentBranch}`;
    const existsResult = await this.stateBranchOps.branchExists(stateBranch);
    if (existsResult.ok && existsResult.data) {
      return this.tryRestore(currentBranch);
    }

    // No state branch — ok (untracked branch)
    return ok(undefined);
  }

  private async tryRestore(targetBranch: string): Promise<Result<void, SyncError>> {
    const restoreResult = await this.restoreUseCase.execute(targetBranch);
    if (restoreResult.ok) return ok(undefined);

    const code = restoreResult.error.code;
    if (code === "SYNC.LOCK_CONTENTION" || code === "SYNC.BRANCH_NOT_FOUND") {
      // Non-fatal — proceed with existing state
      return ok(undefined);
    }

    return err(new SyncError("RESTORE_FAILED", restoreResult.error.message));
  }
}
```

**AC:** AC5, AC12, AC14, AC15

**Test (stubs):**
- Branch matches meta → ok, no restore triggered
- Branch mismatch → triggers `RestoreStateUseCase.execute()`
- Detached HEAD → ok, skips restore
- No meta + state branch exists → triggers restore
- No meta + no state branch → ok (untracked branch)
- Restore fails with RESTORE_FAILED → returns error (command must abort)
- Restore fails with LOCK_CONTENTION → returns ok (warn and proceed)
- Restore fails with BRANCH_NOT_FOUND → returns ok
- Doctor runs before branch check

**Run:** `npx vitest run src/kernel/services/branch-consistency-guard.spec.ts`

**Commit:** `feat(S03/T08): add BranchConsistencyGuard`

---

## Wave 4 — Integration wiring (depends on all)

### T09: Hook entry point + InitProjectUseCase wiring + extension wiring

**Files:**
- CREATE `src/kernel/infrastructure/restore-entry.ts`
- EDIT `src/hexagons/project/use-cases/init-project.use-case.ts` — add GitHookPort
- EDIT `src/cli/extension.ts` — wire all new components
- EDIT `.gitignore` — add `.tff.backup.*`
- EDIT `src/kernel/ports/index.ts` — export GitHookPort, HookError
- EDIT `src/kernel/index.ts` — export new public types

**Work:**

1. **Hook entry point** (`src/kernel/infrastructure/restore-entry.ts`):
Minimal bootstrap for post-checkout hook — locates project root, opens DBs, constructs RestoreStateUseCase, calls execute. Exits 0 regardless (non-blocking). Uses dynamic imports to avoid loading deps when `.tff/` doesn't exist.

2. **InitProjectUseCase** — add optional `GitHookPort` to constructor:
```typescript
constructor(
  private readonly projectRepo: ProjectRepositoryPort,
  private readonly projectFs: ProjectFileSystemPort,
  private readonly mergeSettings: MergeSettingsUseCase,
  private readonly eventBus: EventBusPort,
  private readonly dateProvider: DateProviderPort,
  private readonly gitHookPort?: GitHookPort,
) {}

// At end of execute(), after publishing events:
if (this.gitHookPort) {
  const hookScript = [
    'if [ "$3" = "1" ]; then',
    '  node -e "require(\'./node_modules/.tff-restore.js\')" 2>/dev/null || true',
    'fi',
  ].join('\n');
  await this.gitHookPort.installPostCheckoutHook(hookScript);
}
```

3. **Extension wiring** (`createTffExtension`) — after state sync wiring:
```typescript
const gitHookAdapter = new GitHookAdapter(join(options.projectRoot, ".git"));
const backupService = new BackupService();
const restoreUseCase = new RestoreStateUseCase({
  stateSync: gitStateSyncAdapter,
  gitPort,
  advisoryLock: new AdvisoryLock(),
  stateExporter,
  backupService,
  tffDir,
});
const hookScript = 'if [ "$3" = "1" ]; then\n  node -e "require(\'./node_modules/.tff-restore.js\')" 2>/dev/null || true\nfi';
const doctorService = new DoctorService({
  gitHookPort: gitHookAdapter,
  stateBranchOps,
  gitPort,
  backupService,
  hookScriptContent: hookScript,
  projectRoot: options.projectRoot,
});
const guard = new BranchConsistencyGuard(doctorService, gitPort, restoreUseCase, stateBranchOps);

// Run guard eagerly at extension init — ensures state consistency before any command.
// The PI extension API calls createTffExtension() on every tff command invocation,
// so guard.ensure() runs before every command by design.
// AC15: RESTORE_FAILED must abort — check the Result, don't fire-and-forget.
const guardResult = await guard.ensure(tffDir);
if (!guardResult.ok) {
  logger.error(`State restore failed: ${guardResult.error.message}`);
  throw new Error(`TFF state restore failed — aborting command. ${guardResult.error.message}`);
}
```

4. **.gitignore** — add `.tff.backup.*` entry

5. **Barrel exports** — export `GitHookPort`, `HookError` from `kernel/ports/index.ts` and `kernel/index.ts`

6. **Hook script delivery** — The restore entry point (`src/kernel/infrastructure/restore-entry.ts`) is compiled as part of the TypeScript build. At `tff init` / hook install time, the hook script references `node_modules/.tff-restore.js` which is a stub that `require`s the compiled restore-entry from the plugin's dist. If the require fails (e.g., plugin not installed), the hook silently exits 0 (the `|| true` ensures this). The guard is the primary safety net — the hook is just an optimization for CLI users.

**AC:** AC1, AC2, AC7, AC8, AC12

**Test:** No new test file — verified via existing tests + manual integration. Confirm `npx vitest run` passes all.

**Run:** `npx vitest run`

**Commit:** `feat(S03/T09): wire hook entry + guard + doctor into extension`
