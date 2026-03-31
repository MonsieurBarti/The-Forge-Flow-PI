# M04-S04: Worktree Management — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Implement `WorktreePort` with create/delete/list/exists/validate, extend `GitPort` with 5 worktree/branch methods, build git + in-memory adapters with contract tests, and a `CleanupOrphanedWorktreesUseCase`.

**Architecture:** Hexagonal — port in execution/domain/ports, adapters in execution/infrastructure, use case in execution/application. GitPort extended in kernel/ports.

**Tech Stack:** TypeScript, Zod schemas, vitest, Result<T,E> pattern, `node:child_process` for git operations.

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/kernel/ports/git.schemas.ts` | Modify | Add `GitWorktreeEntrySchema` + type |
| `src/kernel/ports/git.port.ts` | Modify | Add 5 abstract methods |
| `src/kernel/infrastructure/git-cli.adapter.ts` | Modify | Implement 5 new methods |
| `src/kernel/index.ts` | Modify | Export new schema/type |
| `src/hexagons/execution/application/rollback-slice.use-case.spec.ts` | Modify | Add 5 stubs to MockGitPort |
| `src/hexagons/execution/domain/worktree.schemas.ts` | Create | WorktreeInfo, WorktreeHealth, CleanupReport |
| `src/hexagons/execution/domain/errors/worktree.error.ts` | Create | WorktreeError with 7 factory methods |
| `src/hexagons/execution/domain/ports/worktree.port.ts` | Create | Abstract WorktreePort |
| `src/hexagons/execution/domain/ports/slice-status-provider.port.ts` | Create | SliceStatusProvider interface |
| `src/hexagons/execution/infrastructure/in-memory-worktree.adapter.ts` | Create | Map-based test adapter |
| `src/hexagons/execution/infrastructure/in-memory-worktree.adapter.spec.ts` | Create | Contract test wiring |
| `src/hexagons/execution/infrastructure/worktree.contract.spec.ts` | Create | Shared contract tests |
| `src/hexagons/execution/infrastructure/git-worktree.adapter.ts` | Create | Production adapter composing GitPort |
| `src/hexagons/execution/infrastructure/git-worktree.adapter.spec.ts` | Create | Contract test wiring + integration tests |
| `src/hexagons/execution/application/cleanup-orphaned-worktrees.use-case.ts` | Create | Cleanup orchestration |
| `src/hexagons/execution/application/cleanup-orphaned-worktrees.use-case.spec.ts` | Create | Use case unit tests |
| `src/hexagons/execution/index.ts` | Modify | Export new artifacts |

---

## Wave 0 (parallel — no dependencies)

### T01: Worktree schemas and types
**Files:** Create `src/hexagons/execution/domain/worktree.schemas.ts`
**Traces to:** AC1 (WorktreeInfo returned by create), AC4 (WorktreeHealth from validate), AC5 (CleanupReport)

- [ ] Step 1: Write test file `src/hexagons/execution/domain/worktree.schemas.spec.ts`:
  ```typescript
  import { describe, expect, it } from "vitest";
  import {
    CleanupReportSchema,
    WorktreeHealthSchema,
    WorktreeInfoSchema,
  } from "./worktree.schemas";

  describe("WorktreeInfoSchema", () => {
    it("parses valid worktree info", () => {
      const result = WorktreeInfoSchema.safeParse({
        sliceId: "M04-S04",
        branch: "slice/M04-S04",
        path: "/abs/path/.tff/worktrees/M04-S04",
        baseBranch: "milestone/M04",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing sliceId", () => {
      const result = WorktreeInfoSchema.safeParse({
        branch: "slice/M04-S04",
        path: "/abs/path",
        baseBranch: "milestone/M04",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("WorktreeHealthSchema", () => {
    it("parses valid health check", () => {
      const result = WorktreeHealthSchema.safeParse({
        sliceId: "M04-S04",
        exists: true,
        branchValid: true,
        clean: true,
        reachable: true,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("CleanupReportSchema", () => {
    it("parses valid cleanup report", () => {
      const result = CleanupReportSchema.safeParse({
        deleted: ["M04-S01"],
        skipped: ["M04-S02"],
        errors: [{ sliceId: "M04-S03", reason: "failed to delete" }],
      });
      expect(result.success).toBe(true);
    });
  });
  ```
- [ ] Step 2: Run `npx vitest run src/hexagons/execution/domain/worktree.schemas.spec.ts`, verify FAIL
- [ ] Step 3: Implement `src/hexagons/execution/domain/worktree.schemas.ts`:
  ```typescript
  import { z } from "zod";

  // Note: sliceId uses z.string() (not IdSchema/uuid) because worktree port
  // operates on human-readable slice labels like "M04-S04", not UUIDs.
  export const WorktreeInfoSchema = z.object({
    sliceId: z.string().min(1),
    branch: z.string().min(1),
    path: z.string().min(1),
    baseBranch: z.string().min(1),
  });
  export type WorktreeInfo = z.infer<typeof WorktreeInfoSchema>;

  export const WorktreeHealthSchema = z.object({
    sliceId: z.string().min(1),
    exists: z.boolean(),
    branchValid: z.boolean(),
    clean: z.boolean(),
    reachable: z.boolean(),
  });
  export type WorktreeHealth = z.infer<typeof WorktreeHealthSchema>;

  export const CleanupReportSchema = z.object({
    deleted: z.array(z.string()),
    skipped: z.array(z.string()),
    errors: z.array(z.object({ sliceId: z.string(), reason: z.string() })),
  });
  export type CleanupReport = z.infer<typeof CleanupReportSchema>;
  ```
- [ ] Step 4: Run `npx vitest run src/hexagons/execution/domain/worktree.schemas.spec.ts`, verify PASS
- [ ] Step 5: `git add src/hexagons/execution/domain/worktree.schemas.ts src/hexagons/execution/domain/worktree.schemas.spec.ts && git commit -m "feat(S04/T01): worktree schemas — WorktreeInfo, WorktreeHealth, CleanupReport"`

---

### T02: Worktree errors
**Files:** Create `src/hexagons/execution/domain/errors/worktree.error.ts`
**Traces to:** AC6 (notFound), AC7 (alreadyExists)

- [ ] Step 1: Write test file `src/hexagons/execution/domain/errors/worktree.error.spec.ts`:
  ```typescript
  import { describe, expect, it } from "vitest";
  import { WorktreeError } from "./worktree.error";

  describe("WorktreeError", () => {
    it("creationFailed includes sliceId and cause", () => {
      const e = WorktreeError.creationFailed("M04-S04", "git error");
      expect(e.code).toBe("WORKTREE.CREATION_FAILED");
      expect(e.message).toContain("M04-S04");
      expect(e.metadata?.sliceId).toBe("M04-S04");
    });

    it("notFound includes sliceId", () => {
      const e = WorktreeError.notFound("M04-S04");
      expect(e.code).toBe("WORKTREE.NOT_FOUND");
      expect(e.metadata?.sliceId).toBe("M04-S04");
    });

    it("alreadyExists includes sliceId", () => {
      const e = WorktreeError.alreadyExists("M04-S04");
      expect(e.code).toBe("WORKTREE.ALREADY_EXISTS");
    });

    it("deletionFailed includes sliceId and cause", () => {
      const e = WorktreeError.deletionFailed("M04-S04", "branch unmerged");
      expect(e.code).toBe("WORKTREE.DELETION_FAILED");
    });

    it("unhealthy includes health in metadata", () => {
      const health = { sliceId: "id", exists: false, branchValid: true, clean: true, reachable: true };
      const e = WorktreeError.unhealthy("M04-S04", health);
      expect(e.code).toBe("WORKTREE.UNHEALTHY");
      expect(e.metadata?.health).toEqual(health);
    });

    it("branchConflict includes branch name", () => {
      const e = WorktreeError.branchConflict("M04-S04", "slice/M04-S04");
      expect(e.code).toBe("WORKTREE.BRANCH_CONFLICT");
    });

    it("operationFailed includes operation name", () => {
      const e = WorktreeError.operationFailed("list", "git error");
      expect(e.code).toBe("WORKTREE.OPERATION_FAILED");
      expect(e.metadata?.operation).toBe("list");
    });

    it("extends Error", () => {
      const e = WorktreeError.notFound("x");
      expect(e).toBeInstanceOf(Error);
    });
  });
  ```
- [ ] Step 2: Run `npx vitest run src/hexagons/execution/domain/errors/worktree.error.spec.ts`, verify FAIL
- [ ] Step 3: Implement `src/hexagons/execution/domain/errors/worktree.error.ts`:
  ```typescript
  import { BaseDomainError } from "@kernel";
  import type { WorktreeHealth } from "../worktree.schemas";

  export class WorktreeError extends BaseDomainError {
    readonly code: string;

    private constructor(code: string, message: string, metadata?: Record<string, unknown>) {
      super(message, metadata);
      this.code = code;
    }

    static creationFailed(sliceId: string, cause: unknown): WorktreeError {
      const msg = cause instanceof Error ? cause.message : String(cause);
      return new WorktreeError(
        "WORKTREE.CREATION_FAILED",
        `Failed to create worktree for slice ${sliceId}: ${msg}`,
        { sliceId, cause: msg },
      );
    }

    static deletionFailed(sliceId: string, cause: unknown): WorktreeError {
      const msg = cause instanceof Error ? cause.message : String(cause);
      return new WorktreeError(
        "WORKTREE.DELETION_FAILED",
        `Failed to delete worktree for slice ${sliceId}: ${msg}`,
        { sliceId, cause: msg },
      );
    }

    static notFound(sliceId: string): WorktreeError {
      return new WorktreeError(
        "WORKTREE.NOT_FOUND",
        `No worktree found for slice ${sliceId}`,
        { sliceId },
      );
    }

    static alreadyExists(sliceId: string): WorktreeError {
      return new WorktreeError(
        "WORKTREE.ALREADY_EXISTS",
        `Worktree already exists for slice ${sliceId}`,
        { sliceId },
      );
    }

    static unhealthy(sliceId: string, health: WorktreeHealth): WorktreeError {
      return new WorktreeError(
        "WORKTREE.UNHEALTHY",
        `Worktree for slice ${sliceId} is unhealthy`,
        { sliceId, health },
      );
    }

    static branchConflict(sliceId: string, branch: string): WorktreeError {
      return new WorktreeError(
        "WORKTREE.BRANCH_CONFLICT",
        `Branch ${branch} already in use for slice ${sliceId}`,
        { sliceId, branch },
      );
    }

    static operationFailed(operation: string, cause: unknown): WorktreeError {
      const msg = cause instanceof Error ? cause.message : String(cause);
      return new WorktreeError(
        "WORKTREE.OPERATION_FAILED",
        `Worktree operation '${operation}' failed: ${msg}`,
        { operation, cause: msg },
      );
    }
  }
  ```
- [ ] Step 4: Run `npx vitest run src/hexagons/execution/domain/errors/worktree.error.spec.ts`, verify PASS
- [ ] Step 5: `git add src/hexagons/execution/domain/errors/worktree.error.ts src/hexagons/execution/domain/errors/worktree.error.spec.ts && git commit -m "feat(S04/T02): WorktreeError with 7 factory methods"`

---

### T03: Extend GitPort with worktree + branch operations
**Files:** Modify `src/kernel/ports/git.schemas.ts`, `src/kernel/ports/git.port.ts`, `src/kernel/infrastructure/git-cli.adapter.ts`, `src/hexagons/execution/application/rollback-slice.use-case.spec.ts`, `src/kernel/index.ts`
**Traces to:** AC8 (GitPort extended, existing tests pass)

- [ ] Step 1: Write integration test `src/kernel/infrastructure/git-cli.adapter.worktree.spec.ts`:
  ```typescript
  import { mkdtemp, rm, realpathSync } from "node:fs";
  import { mkdtemp as mkdtempAsync, rm as rmAsync } from "node:fs/promises";
  import { tmpdir } from "node:os";
  import { join } from "node:path";
  import { execFile } from "node:child_process";
  import { promisify } from "node:util";
  import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
  import { isOk } from "@kernel";
  import { GitCliAdapter } from "./git-cli.adapter";

  const exec = promisify(execFile);

  describe("GitCliAdapter — worktree operations", () => {
    let repoDir: string;
    let adapter: GitCliAdapter;

    beforeAll(async () => {
      const raw = await mkdtempAsync(join(tmpdir(), "git-wt-test-"));
      repoDir = realpathSync(raw);
      await exec("git", ["init", repoDir]);
      await exec("git", ["-C", repoDir, "commit", "--allow-empty", "-m", "init"]);
      await exec("git", ["-C", repoDir, "checkout", "-b", "base-branch"]);
    });

    afterAll(async () => {
      await rmAsync(repoDir, { recursive: true, force: true });
    });

    beforeEach(() => {
      adapter = new GitCliAdapter(repoDir);
    });

    it("worktreeAdd creates worktree and branch", async () => {
      const wtPath = join(repoDir, "wt-test-add");
      const result = await adapter.worktreeAdd(wtPath, "test-branch-add", "base-branch");
      expect(isOk(result)).toBe(true);
      // cleanup
      await adapter.worktreeRemove(wtPath);
      await adapter.deleteBranch("test-branch-add", true);
    });

    it("worktreeAdd fails if branch already exists", async () => {
      const wtPath = join(repoDir, "wt-test-dup");
      await adapter.worktreeAdd(wtPath, "dup-branch", "base-branch");
      const result = await adapter.worktreeAdd(join(repoDir, "wt-test-dup2"), "dup-branch", "base-branch");
      expect(isOk(result)).toBe(false);
      // cleanup
      await adapter.worktreeRemove(wtPath);
      await adapter.deleteBranch("dup-branch", true);
    });

    it("worktreeList returns entries including main worktree", async () => {
      const result = await adapter.worktreeList();
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data.length).toBeGreaterThanOrEqual(1);
        expect(result.data[0].path).toBeTruthy();
      }
    });

    it("worktreeRemove removes worktree", async () => {
      const wtPath = join(repoDir, "wt-test-remove");
      await adapter.worktreeAdd(wtPath, "remove-branch", "base-branch");
      const result = await adapter.worktreeRemove(wtPath);
      expect(isOk(result)).toBe(true);
      await adapter.deleteBranch("remove-branch", true);
    });

    it("deleteBranch deletes a branch", async () => {
      await exec("git", ["-C", repoDir, "branch", "to-delete", "base-branch"]);
      const result = await adapter.deleteBranch("to-delete");
      expect(isOk(result)).toBe(true);
    });

    it("statusAt returns status for a different cwd", async () => {
      const wtPath = join(repoDir, "wt-test-status");
      await adapter.worktreeAdd(wtPath, "status-branch", "base-branch");
      const result = await adapter.statusAt(wtPath);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data.branch).toBe("status-branch");
        expect(result.data.clean).toBe(true);
      }
      await adapter.worktreeRemove(wtPath);
      await adapter.deleteBranch("status-branch", true);
    });
  });
  ```
- [ ] Step 2: Run `npx vitest run src/kernel/infrastructure/git-cli.adapter.worktree.spec.ts`, verify FAIL (methods don't exist)
- [ ] Step 3: Implement changes across 5 files:

  **3a.** Add `GitWorktreeEntrySchema` to `src/kernel/ports/git.schemas.ts`:
  ```typescript
  export const GitWorktreeEntrySchema = z.object({
    path: z.string(),
    branch: z.string().optional(),
    head: z.string(),
    bare: z.boolean(),
  });
  export type GitWorktreeEntry = z.infer<typeof GitWorktreeEntrySchema>;
  ```

  **3b.** Add 5 abstract methods to `src/kernel/ports/git.port.ts`:
  ```typescript
  import type { GitLogEntry, GitStatus, GitWorktreeEntry } from "./git.schemas";
  // ... add after isAncestor:
  abstract worktreeAdd(path: string, branch: string, baseBranch: string): Promise<Result<void, GitError>>;
  abstract worktreeRemove(path: string): Promise<Result<void, GitError>>;
  abstract worktreeList(): Promise<Result<GitWorktreeEntry[], GitError>>;
  abstract deleteBranch(name: string, force?: boolean): Promise<Result<void, GitError>>;
  abstract statusAt(cwd: string): Promise<Result<GitStatus, GitError>>;
  ```

  **3c.** Implement in `src/kernel/infrastructure/git-cli.adapter.ts`:
  - `worktreeAdd`: `runGit(["worktree", "add", "-b", branch, path, baseBranch])`
  - `worktreeRemove`: `runGit(["worktree", "remove", "--force", path])`
  - `worktreeList`: `runGit(["worktree", "list", "--porcelain"])` + parse records (split on `\n\n`, extract `worktree`, `HEAD`, `branch`, `bare` fields)
  - `deleteBranch`: `runGit(["branch", force ? "-D" : "-d", name])`
  - `statusAt`: First, **extract** the existing `status()` parse logic (lines 119-151) into a new `private parseStatusOutput(stdout: string): GitStatus` method. Then implement `statusAt` as: `runGit(["-C", cwd, "status", "--porcelain=v1", "--branch"])` → `parseStatusOutput(result.data)`. Update existing `status()` to also call `parseStatusOutput`. The `-C` flag works correctly with `runGit` because git processes global flags (`--no-pager`, `-c`) before `-C`.
  - Add to `mapError`: pattern `"already exists"` → `BRANCH_EXISTS`, `"is not a working tree"` → `NOT_A_WORKTREE`

  **3d.** Add 5 stubs to `MockGitPort` in `src/hexagons/execution/application/rollback-slice.use-case.spec.ts`:
  ```typescript
  async worktreeAdd(): Promise<Result<void, GitError>> { return ok(undefined); }
  async worktreeRemove(): Promise<Result<void, GitError>> { return ok(undefined); }
  async worktreeList(): Promise<Result<GitWorktreeEntry[], GitError>> { return ok([]); }
  async deleteBranch(): Promise<Result<void, GitError>> { return ok(undefined); }
  async statusAt(): Promise<Result<GitStatus, GitError>> { return ok({ branch: "test", clean: true, entries: [] }); }
  ```
  Add import: `import type { GitWorktreeEntry } from "@kernel/ports/git.schemas";`

  **3e.** Add exports to `src/kernel/index.ts` (in the ports section):
  ```typescript
  // Add to type exports:
  GitWorktreeEntry,
  // Add to value exports:
  GitWorktreeEntrySchema,
  ```

- [ ] Step 4: Run `npx vitest run src/kernel/infrastructure/git-cli.adapter.worktree.spec.ts && npx vitest run src/hexagons/execution/application/rollback-slice.use-case.spec.ts`, verify both PASS
- [ ] Step 5: `git add src/kernel/ src/hexagons/execution/application/rollback-slice.use-case.spec.ts && git commit -m "feat(S04/T03): extend GitPort with worktree/branch operations"`

---

## Wave 1 (depends on T01, T02)

### T04: WorktreePort + SliceStatusProvider interfaces
**Files:** Create `src/hexagons/execution/domain/ports/worktree.port.ts`, Create `src/hexagons/execution/domain/ports/slice-status-provider.port.ts`
**Traces to:** AC1-AC7 (port contract), AC5 (SliceStatusProvider for cleanup)

No TDD cycle — these are abstract/interface definitions. Tests come via contract tests (T05) and use case tests (T06).

- [ ] Step 1: Create `src/hexagons/execution/domain/ports/worktree.port.ts`:
  ```typescript
  import type { Result } from "@kernel";
  import type { WorktreeError } from "../errors/worktree.error";
  import type { WorktreeHealth, WorktreeInfo } from "../worktree.schemas";

  export abstract class WorktreePort {
    abstract create(sliceId: string, baseBranch: string): Promise<Result<WorktreeInfo, WorktreeError>>;
    abstract delete(sliceId: string): Promise<Result<void, WorktreeError>>;
    abstract list(): Promise<Result<WorktreeInfo[], WorktreeError>>;
    abstract exists(sliceId: string): Promise<boolean>;
    abstract validate(sliceId: string): Promise<Result<WorktreeHealth, WorktreeError>>;
  }
  ```

- [ ] Step 2: Create `src/hexagons/execution/domain/ports/slice-status-provider.port.ts`:
  ```typescript
  import type { Result } from "@kernel";
  import type { SliceStatus } from "@hexagons/slice";

  export interface SliceStatusProvider {
    getStatus(sliceId: string): Promise<Result<SliceStatus, Error>>;
  }
  ```

- [ ] Step 3: Run `npx vitest run src/hexagons/execution/` to verify no compilation errors
- [ ] Step 4: `git add src/hexagons/execution/domain/ports/worktree.port.ts src/hexagons/execution/domain/ports/slice-status-provider.port.ts && git commit -m "feat(S04/T04): WorktreePort + SliceStatusProvider interfaces"`

---

## Wave 2 (depends on T04)

### T05: InMemoryWorktreeAdapter + contract tests
**Files:** Create `src/hexagons/execution/infrastructure/worktree.contract.spec.ts`, Create `src/hexagons/execution/infrastructure/in-memory-worktree.adapter.ts`, Create `src/hexagons/execution/infrastructure/in-memory-worktree.adapter.spec.ts`
**Traces to:** AC1, AC2, AC3, AC6, AC7, AC9

- [ ] Step 1: Write contract test `src/hexagons/execution/infrastructure/worktree.contract.spec.ts`:
  ```typescript
  import { isOk } from "@kernel";
  import { beforeEach, describe, expect, it } from "vitest";
  import type { WorktreePort } from "../domain/ports/worktree.port";

  export function runWorktreeContractTests(
    name: string,
    factory: () => WorktreePort & { reset(): void | Promise<void> },
  ) {
    describe(`${name} contract`, () => {
      let adapter: WorktreePort & { reset(): void | Promise<void> };

      beforeEach(async () => {
        adapter = factory();
        await adapter.reset();
      });

      it("create + exists roundtrip (AC1)", async () => {
        const result = await adapter.create("M04-S04", "milestone/M04");
        expect(isOk(result)).toBe(true);
        if (isOk(result)) {
          expect(result.data.sliceId).toBe("M04-S04");
          expect(result.data.branch).toBe("slice/M04-S04");
        }
        const exists = await adapter.exists("M04-S04");
        expect(exists).toBe(true);
      });

      it("exists returns false for non-existent (AC6)", async () => {
        const exists = await adapter.exists("M04-S99");
        expect(exists).toBe(false);
      });

      it("create + delete + exists returns false (AC2, AC3)", async () => {
        await adapter.create("M04-S04", "milestone/M04");
        const delResult = await adapter.delete("M04-S04");
        expect(isOk(delResult)).toBe(true);
        const exists = await adapter.exists("M04-S04");
        expect(exists).toBe(false);
      });

      it("list returns created worktrees", async () => {
        await adapter.create("M04-S04", "milestone/M04");
        await adapter.create("M04-S05", "milestone/M04");
        const result = await adapter.list();
        expect(isOk(result)).toBe(true);
        if (isOk(result)) {
          const ids = result.data.map(w => w.sliceId);
          expect(ids).toContain("M04-S04");
          expect(ids).toContain("M04-S05");
        }
      });

      it("duplicate create returns alreadyExists error (AC7)", async () => {
        await adapter.create("M04-S04", "milestone/M04");
        const result = await adapter.create("M04-S04", "milestone/M04");
        expect(isOk(result)).toBe(false);
        if (!isOk(result)) {
          expect(result.error.code).toBe("WORKTREE.ALREADY_EXISTS");
        }
      });

      it("delete non-existent returns notFound error (AC6)", async () => {
        const result = await adapter.delete("M04-S99");
        expect(isOk(result)).toBe(false);
        if (!isOk(result)) {
          expect(result.error.code).toBe("WORKTREE.NOT_FOUND");
        }
      });

      it("validate returns health for existing worktree (AC4)", async () => {
        await adapter.create("M04-S04", "milestone/M04");
        const result = await adapter.validate("M04-S04");
        expect(isOk(result)).toBe(true);
        if (isOk(result)) {
          expect(result.data.sliceId).toBe("M04-S04");
          expect(result.data.exists).toBe(true);
          expect(result.data.branchValid).toBe(true);
        }
      });

      it("validate non-existent returns notFound (AC6)", async () => {
        const result = await adapter.validate("M04-S99");
        expect(isOk(result)).toBe(false);
        if (!isOk(result)) {
          expect(result.error.code).toBe("WORKTREE.NOT_FOUND");
        }
      });
    });
  }
  ```

- [ ] Step 2: Write `src/hexagons/execution/infrastructure/in-memory-worktree.adapter.spec.ts`:
  ```typescript
  import { runWorktreeContractTests } from "./worktree.contract.spec";
  import { InMemoryWorktreeAdapter } from "./in-memory-worktree.adapter";

  runWorktreeContractTests("InMemoryWorktreeAdapter", () => new InMemoryWorktreeAdapter());
  ```
  Run `npx vitest run src/hexagons/execution/infrastructure/in-memory-worktree.adapter.spec.ts`, verify FAIL

- [ ] Step 3: Implement `src/hexagons/execution/infrastructure/in-memory-worktree.adapter.ts`:
  ```typescript
  import { err, ok, type Result } from "@kernel";
  import { WorktreePort } from "../domain/ports/worktree.port";
  import { WorktreeError } from "../domain/errors/worktree.error";
  import type { WorktreeHealth, WorktreeInfo } from "../domain/worktree.schemas";

  export class InMemoryWorktreeAdapter extends WorktreePort {
    private store = new Map<string, WorktreeInfo>();

    async create(sliceId: string, baseBranch: string): Promise<Result<WorktreeInfo, WorktreeError>> {
      if (this.store.has(sliceId)) return err(WorktreeError.alreadyExists(sliceId));
      const info: WorktreeInfo = {
        sliceId,
        branch: `slice/${sliceId}`,
        path: `/mock/.tff/worktrees/${sliceId}`,
        baseBranch,
      };
      this.store.set(sliceId, info);
      return ok(info);
    }

    async delete(sliceId: string): Promise<Result<void, WorktreeError>> {
      if (!this.store.has(sliceId)) return err(WorktreeError.notFound(sliceId));
      this.store.delete(sliceId);
      return ok(undefined);
    }

    async list(): Promise<Result<WorktreeInfo[], WorktreeError>> {
      return ok([...this.store.values()]);
    }

    async exists(sliceId: string): Promise<boolean> {
      return this.store.has(sliceId);
    }

    async validate(sliceId: string): Promise<Result<WorktreeHealth, WorktreeError>> {
      if (!this.store.has(sliceId)) return err(WorktreeError.notFound(sliceId));
      return ok({
        sliceId,
        exists: true,
        branchValid: true,
        clean: true,
        reachable: true,
      });
    }

    seed(info: WorktreeInfo): void {
      this.store.set(info.sliceId, info);
    }

    reset(): void {
      this.store.clear();
    }
  }
  ```

- [ ] Step 4: Run `npx vitest run src/hexagons/execution/infrastructure/in-memory-worktree.adapter.spec.ts`, verify PASS
- [ ] Step 5: `git add src/hexagons/execution/infrastructure/worktree.contract.spec.ts src/hexagons/execution/infrastructure/in-memory-worktree.adapter.ts src/hexagons/execution/infrastructure/in-memory-worktree.adapter.spec.ts && git commit -m "feat(S04/T05): InMemoryWorktreeAdapter + contract tests"`

---

## Wave 3 (depends on T05; T06 and T07 are parallel)

### T06: CleanupOrphanedWorktreesUseCase
**Files:** Create `src/hexagons/execution/application/cleanup-orphaned-worktrees.use-case.ts`, Create `src/hexagons/execution/application/cleanup-orphaned-worktrees.use-case.spec.ts`
**Traces to:** AC5

- [ ] Step 1: Write test `src/hexagons/execution/application/cleanup-orphaned-worktrees.use-case.spec.ts`:
  ```typescript
  import { err, isOk, ok, type Result } from "@kernel";
  import { beforeEach, describe, expect, it } from "vitest";
  import type { SliceStatusProvider } from "../domain/ports/slice-status-provider.port";
  import type { WorktreeInfo } from "../domain/worktree.schemas";
  import { InMemoryWorktreeAdapter } from "../infrastructure/in-memory-worktree.adapter";
  import { CleanupOrphanedWorktreesUseCase } from "./cleanup-orphaned-worktrees.use-case";
  import type { SliceStatus } from "@hexagons/slice";

  class StubSliceStatusProvider implements SliceStatusProvider {
    private statuses = new Map<string, SliceStatus>();

    givenStatus(sliceId: string, status: SliceStatus): void {
      this.statuses.set(sliceId, status);
    }

    async getStatus(sliceId: string): Promise<Result<SliceStatus, Error>> {
      const status = this.statuses.get(sliceId);
      if (!status) return err(new Error(`Slice ${sliceId} not found`));
      return ok(status);
    }
  }

  function makeInfo(sliceId: string): WorktreeInfo {
    return { sliceId, branch: `slice/${sliceId}`, path: `/mock/${sliceId}`, baseBranch: "milestone/M04" };
  }

  describe("CleanupOrphanedWorktreesUseCase", () => {
    let worktreeAdapter: InMemoryWorktreeAdapter;
    let statusProvider: StubSliceStatusProvider;
    let useCase: CleanupOrphanedWorktreesUseCase;

    beforeEach(() => {
      worktreeAdapter = new InMemoryWorktreeAdapter();
      statusProvider = new StubSliceStatusProvider();
      useCase = new CleanupOrphanedWorktreesUseCase(worktreeAdapter, statusProvider);
    });

    it("deletes worktrees for closed slices (AC5)", async () => {
      worktreeAdapter.seed(makeInfo("M04-S01"));
      worktreeAdapter.seed(makeInfo("M04-S02"));
      statusProvider.givenStatus("M04-S01", "closed");
      statusProvider.givenStatus("M04-S02", "executing");

      const result = await useCase.execute();
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data.deleted).toEqual(["M04-S01"]);
        expect(result.data.skipped).toEqual(["M04-S02"]);
      }
      expect(await worktreeAdapter.exists("M04-S01")).toBe(false);
      expect(await worktreeAdapter.exists("M04-S02")).toBe(true);
    });

    it("skips on status-lookup failure (AC5)", async () => {
      worktreeAdapter.seed(makeInfo("M04-S01"));
      // no status provided → getStatus will return err

      const result = await useCase.execute();
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data.skipped).toEqual(["M04-S01"]);
        expect(result.data.deleted).toEqual([]);
      }
    });

    it("returns empty report when no worktrees exist", async () => {
      const result = await useCase.execute();
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data.deleted).toEqual([]);
        expect(result.data.skipped).toEqual([]);
        expect(result.data.errors).toEqual([]);
      }
    });

    it("does not delete worktrees in completing status", async () => {
      worktreeAdapter.seed(makeInfo("M04-S01"));
      statusProvider.givenStatus("M04-S01", "completing");

      const result = await useCase.execute();
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data.skipped).toEqual(["M04-S01"]);
        expect(result.data.deleted).toEqual([]);
      }
    });
  });
  ```
- [ ] Step 2: Run `npx vitest run src/hexagons/execution/application/cleanup-orphaned-worktrees.use-case.spec.ts`, verify FAIL
- [ ] Step 3: Implement `src/hexagons/execution/application/cleanup-orphaned-worktrees.use-case.ts`:
  ```typescript
  import { isOk, ok, type Result } from "@kernel";
  import type { SliceStatusProvider } from "../domain/ports/slice-status-provider.port";
  import type { WorktreePort } from "../domain/ports/worktree.port";
  import { WorktreeError } from "../domain/errors/worktree.error";
  import type { CleanupReport } from "../domain/worktree.schemas";

  export class CleanupOrphanedWorktreesUseCase {
    constructor(
      private readonly worktreePort: WorktreePort,
      private readonly sliceStatusProvider: SliceStatusProvider,
    ) {}

    async execute(): Promise<Result<CleanupReport, WorktreeError>> {
      const listResult = await this.worktreePort.list();
      if (!isOk(listResult)) return listResult;

      const report: CleanupReport = { deleted: [], skipped: [], errors: [] };

      for (const worktree of listResult.data) {
        const statusResult = await this.sliceStatusProvider.getStatus(worktree.sliceId);
        if (!isOk(statusResult)) {
          report.skipped.push(worktree.sliceId);
          continue;
        }
        if (statusResult.data !== "closed") {
          report.skipped.push(worktree.sliceId);
          continue;
        }
        const deleteResult = await this.worktreePort.delete(worktree.sliceId);
        if (isOk(deleteResult)) {
          report.deleted.push(worktree.sliceId);
        } else {
          report.errors.push({ sliceId: worktree.sliceId, reason: deleteResult.error.message });
        }
      }

      return ok(report);
    }
  }
  ```
- [ ] Step 4: Run `npx vitest run src/hexagons/execution/application/cleanup-orphaned-worktrees.use-case.spec.ts`, verify PASS
- [ ] Step 5: `git add src/hexagons/execution/application/cleanup-orphaned-worktrees.use-case.ts src/hexagons/execution/application/cleanup-orphaned-worktrees.use-case.spec.ts && git commit -m "feat(S04/T06): CleanupOrphanedWorktreesUseCase"`

---

### T07: GitWorktreeAdapter + contract test wiring
**Files:** Create `src/hexagons/execution/infrastructure/git-worktree.adapter.ts`, Create `src/hexagons/execution/infrastructure/git-worktree.adapter.spec.ts`
**Traces to:** AC1, AC2, AC3, AC4, AC6, AC7, AC9

- [ ] Step 1: Write test file `src/hexagons/execution/infrastructure/git-worktree.adapter.spec.ts`:
  ```typescript
  import { mkdtemp, rm } from "node:fs/promises";
  import { tmpdir } from "node:os";
  import { join } from "node:path";
  import { execFile } from "node:child_process";
  import { promisify } from "node:util";
  import { realpathSync } from "node:fs";
  import { afterAll, beforeAll, describe, expect, it } from "vitest";
  import { isOk } from "@kernel";
  import { GitCliAdapter } from "@kernel/infrastructure/git-cli.adapter";
  import { runWorktreeContractTests } from "./worktree.contract.spec";
  import { GitWorktreeAdapter } from "./git-worktree.adapter";

  const exec = promisify(execFile);

  describe("GitWorktreeAdapter", () => {
    let repoDir: string;
    let gitPort: GitCliAdapter;

    beforeAll(async () => {
      const raw = await mkdtemp(join(tmpdir(), "git-wt-adapter-"));
      repoDir = realpathSync(raw);
      await exec("git", ["init", repoDir]);
      await exec("git", ["-C", repoDir, "commit", "--allow-empty", "-m", "init"]);
      await exec("git", ["-C", repoDir, "checkout", "-b", "milestone/M04"]);
      gitPort = new GitCliAdapter(repoDir);
    });

    afterAll(async () => {
      await rm(repoDir, { recursive: true, force: true });
    });

    runWorktreeContractTests("GitWorktreeAdapter", () => {
      const adapter = new GitWorktreeAdapter(gitPort, repoDir);
      return Object.assign(adapter, {
        reset: async () => {
          // Clean up all slice worktrees between tests
          const listResult = await adapter.list();
          if (isOk(listResult)) {
            for (const wt of listResult.data) {
              await adapter.delete(wt.sliceId);
            }
          }
        },
      });
    });

    describe("adapter-specific", () => {
      it("validate detects missing directory (AC4)", async () => {
        // Create then manually remove the directory
        const adapter = new GitWorktreeAdapter(gitPort, repoDir);
        await adapter.create("M04-S99", "milestone/M04");
        const wtPath = join(repoDir, ".tff", "worktrees", "M04-S99");
        await rm(wtPath, { recursive: true, force: true });

        const result = await adapter.validate("M04-S99");
        expect(isOk(result)).toBe(true);
        if (isOk(result)) {
          expect(result.data.exists).toBe(false);
        }

        // cleanup git metadata
        await exec("git", ["-C", repoDir, "worktree", "prune"]);
        await exec("git", ["-C", repoDir, "branch", "-D", "slice/M04-S99"]);
      });
    });
  });
  ```

- [ ] Step 2: Run `npx vitest run src/hexagons/execution/infrastructure/git-worktree.adapter.spec.ts`, verify FAIL
- [ ] Step 3: Implement `src/hexagons/execution/infrastructure/git-worktree.adapter.ts`:
  ```typescript
  import { access } from "node:fs/promises";
  import { join, resolve } from "node:path";
  import { err, isOk, ok, type Result } from "@kernel";
  import type { GitPort } from "@kernel/ports/git.port";
  import { WorktreePort } from "../domain/ports/worktree.port";
  import { WorktreeError } from "../domain/errors/worktree.error";
  import type { WorktreeHealth, WorktreeInfo } from "../domain/worktree.schemas";

  export class GitWorktreeAdapter extends WorktreePort {
    private readonly resolvedRoot: string;

    constructor(
      private readonly gitPort: GitPort,
      projectRoot: string,
    ) {
      super();
      this.resolvedRoot = resolve(projectRoot);
    }

    private branchFor(sliceId: string): string {
      return `slice/${sliceId}`;
    }

    private pathFor(sliceId: string): string {
      return join(this.resolvedRoot, ".tff", "worktrees", sliceId);
    }

    async create(sliceId: string, baseBranch: string): Promise<Result<WorktreeInfo, WorktreeError>> {
      const branch = this.branchFor(sliceId);
      const wtPath = this.pathFor(sliceId);

      const result = await this.gitPort.worktreeAdd(wtPath, branch, baseBranch);
      if (!isOk(result)) {
        const msg = result.error.message;
        if (msg.includes("already exists")) {
          return err(WorktreeError.alreadyExists(sliceId));
        }
        return err(WorktreeError.creationFailed(sliceId, result.error));
      }

      return ok({ sliceId, branch, path: wtPath, baseBranch });
    }

    async delete(sliceId: string): Promise<Result<void, WorktreeError>> {
      if (!(await this.exists(sliceId))) {
        return err(WorktreeError.notFound(sliceId));
      }

      const wtPath = this.pathFor(sliceId);
      const removeResult = await this.gitPort.worktreeRemove(wtPath);
      if (!isOk(removeResult)) {
        return err(WorktreeError.deletionFailed(sliceId, removeResult.error));
      }

      const branch = this.branchFor(sliceId);
      const branchResult = await this.gitPort.deleteBranch(branch);
      if (!isOk(branchResult)) {
        return err(WorktreeError.deletionFailed(sliceId, branchResult.error));
      }

      return ok(undefined);
    }

    async list(): Promise<Result<WorktreeInfo[], WorktreeError>> {
      const result = await this.gitPort.worktreeList();
      if (!isOk(result)) {
        return err(WorktreeError.operationFailed("list", result.error));
      }

      const prefix = resolve(join(this.resolvedRoot, ".tff", "worktrees"));
      const worktrees: WorktreeInfo[] = [];

      for (const entry of result.data) {
        const resolvedPath = resolve(entry.path);
        if (!resolvedPath.startsWith(prefix)) continue;

        const sliceId = resolvedPath.slice(prefix.length + 1);
        if (!sliceId || sliceId.includes("/")) continue;

        worktrees.push({
          sliceId,
          branch: entry.branch ?? `slice/${sliceId}`,
          path: resolvedPath,
          baseBranch: "", // not available from porcelain output
        });
      }

      return ok(worktrees);
    }

    async exists(sliceId: string): Promise<boolean> {
      const listResult = await this.list();
      if (!isOk(listResult)) return false;
      return listResult.data.some(w => w.sliceId === sliceId);
    }

    async validate(sliceId: string): Promise<Result<WorktreeHealth, WorktreeError>> {
      if (!(await this.exists(sliceId))) {
        return err(WorktreeError.notFound(sliceId));
      }

      const wtPath = this.pathFor(sliceId);
      const branch = this.branchFor(sliceId);

      let dirExists = true;
      try {
        await access(wtPath);
      } catch {
        dirExists = false;
      }

      const branchResult = await this.gitPort.listBranches(branch);
      const branchValid = isOk(branchResult) && branchResult.data.includes(branch);

      let clean = true;
      if (dirExists) {
        const statusResult = await this.gitPort.statusAt(wtPath);
        if (isOk(statusResult)) {
          clean = statusResult.data.clean;
        }
      }

      let reachable = true;
      // TODO: determine baseBranch for isAncestor check — not available from list()
      // For now, skip reachability check when baseBranch is unknown

      return ok({ sliceId, exists: dirExists, branchValid, clean, reachable });
    }
  }
  ```

- [ ] Step 4: Run `npx vitest run src/hexagons/execution/infrastructure/git-worktree.adapter.spec.ts`, verify PASS
- [ ] Step 5: `git add src/hexagons/execution/infrastructure/git-worktree.adapter.ts src/hexagons/execution/infrastructure/git-worktree.adapter.spec.ts && git commit -m "feat(S04/T07): GitWorktreeAdapter + contract test wiring"`

---

---

## Wave 4 (depends on all)

### T08: Barrel exports + final verification
**Files:** Modify `src/hexagons/execution/index.ts`
**Traces to:** All ACs (exposes public API)

- [ ] Step 1: Add exports to `src/hexagons/execution/index.ts`:

  After existing domain schema exports:
  ```typescript
  export type { CleanupReport, WorktreeHealth, WorktreeInfo } from "./domain/worktree.schemas";
  export { CleanupReportSchema, WorktreeHealthSchema, WorktreeInfoSchema } from "./domain/worktree.schemas";
  ```

  After existing error exports:
  ```typescript
  export { WorktreeError } from "./domain/errors/worktree.error";
  ```

  After existing port exports:
  ```typescript
  export { WorktreePort } from "./domain/ports/worktree.port";
  export type { SliceStatusProvider } from "./domain/ports/slice-status-provider.port";
  ```

  After existing use case exports:
  ```typescript
  export { CleanupOrphanedWorktreesUseCase } from "./application/cleanup-orphaned-worktrees.use-case";
  ```

  After existing infrastructure exports:
  ```typescript
  export { GitWorktreeAdapter } from "./infrastructure/git-worktree.adapter";
  export { InMemoryWorktreeAdapter } from "./infrastructure/in-memory-worktree.adapter";
  ```

- [ ] Step 2: Run full test suite: `npx vitest run src/hexagons/execution/`, verify all PASS
- [ ] Step 3: `git add src/hexagons/execution/index.ts && git commit -m "feat(S04/T08): barrel exports for worktree management"`
