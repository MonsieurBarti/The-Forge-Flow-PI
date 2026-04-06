# M04-S02: Journal Entity + Replay — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Append-only per-slice JSONL journal with event-driven recording, idempotent replay cross-validation, and commit rollback.
**Architecture:** Execution hexagon (alongside Checkpoint). Plain Zod types (no aggregate), JournalRepositoryPort with JSONL + in-memory adapters.
**Tech Stack:** TypeScript, Zod 4, Vitest, node:fs/promises, node:child_process

## File Structure

### Create
| File | Responsibility |
|---|---|
| `src/hexagons/execution/domain/journal-entry.schemas.ts` | Discriminated union schema (7 entry types) |
| `src/hexagons/execution/domain/journal-entry.schemas.spec.ts` | Schema validation tests |
| `src/hexagons/execution/domain/journal-entry.builder.ts` | Faker-based test builder per entry type |
| `src/hexagons/execution/domain/errors/journal-write.error.ts` | Write failure error |
| `src/hexagons/execution/domain/errors/journal-read.error.ts` | Read/parse failure error |
| `src/hexagons/execution/domain/errors/journal-replay.error.ts` | Replay inconsistency error |
| `src/hexagons/execution/domain/errors/rollback.error.ts` | Rollback failure error |
| `src/hexagons/execution/domain/ports/journal-repository.port.ts` | Abstract repository port |
| `src/hexagons/execution/domain/ports/phase-transition.port.ts` | Local port for slice phase transition (avoids cross-hexagon coupling to workflow) |
| `src/hexagons/execution/infrastructure/in-memory-journal.repository.ts` | Map-based test adapter |
| `src/hexagons/execution/infrastructure/in-memory-journal.repository.spec.ts` | Adapter tests |
| `src/hexagons/execution/infrastructure/jsonl-journal.repository.ts` | JSONL file adapter |
| `src/hexagons/execution/infrastructure/jsonl-journal.repository.spec.ts` | Integration tests (temp dir) |
| `src/hexagons/execution/infrastructure/journal-repository.contract.spec.ts` | Shared contract tests |
| `src/hexagons/execution/application/journal-event-handler.ts` | Event subscriptions -> journal entries |
| `src/hexagons/execution/application/journal-event-handler.spec.ts` | Event handler tests |
| `src/hexagons/execution/application/replay-journal.use-case.ts` | Read-only cross-validation |
| `src/hexagons/execution/application/replay-journal.use-case.spec.ts` | Replay tests |
| `src/hexagons/execution/application/rollback-slice.use-case.ts` | Commit revert logic |
| `src/hexagons/execution/application/rollback-slice.use-case.spec.ts` | Rollback tests |

### Modify
| File | Change |
|---|---|
| `src/hexagons/slice/domain/slice-status.vo.ts` | Add `executing -> planning` back-edge |
| `src/hexagons/slice/domain/slice-status.vo.spec.ts` | Add test for back-edge |
| `src/kernel/ports/git.port.ts` | Add `revert()` + `isAncestor()` |
| `src/kernel/infrastructure/git-cli.adapter.ts` | Implement `revert()` + `isAncestor()` |
| `src/kernel/infrastructure/git-cli.adapter.integration.spec.ts` | Add revert + isAncestor tests |
| `src/hexagons/execution/domain/events/checkpoint-saved.event.ts` | Add `completedTaskCount` field |
| `src/hexagons/task/domain/events/task-completed.event.ts` | Add `sliceId`, `waveIndex`, `durationMs`, `commitHash` |
| `src/hexagons/task/domain/events/task-blocked.event.ts` | Add `sliceId`, `waveIndex`, `errorCode`, `errorMessage` |
| `src/hexagons/slice/domain/events/slice-status-changed.event.ts` | Add `from`, `to` fields |
| `src/hexagons/execution/index.ts` | Export journal schemas, errors, port, in-memory adapter |

---

## Wave 0 (parallel — no dependencies)

### T01: JournalEntry schemas + spec
**Files:** Create `journal-entry.schemas.ts`, `journal-entry.schemas.spec.ts`
**Traces to:** AC3

- [ ] Step 1: Write failing test
  **File:** `src/hexagons/execution/domain/journal-entry.schemas.spec.ts`
  ```typescript
  import { describe, expect, it } from "vitest";
  import { JournalEntrySchema, TaskStartedEntrySchema } from "./journal-entry.schemas";

  describe("JournalEntrySchema", () => {
    it("parses valid task-started entry", () => {
      const entry = { seq: 0, sliceId: crypto.randomUUID(), timestamp: new Date(),
        type: "task-started", taskId: crypto.randomUUID(), waveIndex: 0, agentIdentity: "opus" };
      expect(() => JournalEntrySchema.parse(entry)).not.toThrow();
    });
    it("rejects entry with invalid type discriminator", () => {
      const entry = { seq: 0, sliceId: crypto.randomUUID(), timestamp: new Date(), type: "invalid" };
      expect(() => JournalEntrySchema.parse(entry)).toThrow();
    });
    it("rejects task-started missing agentIdentity", () => {
      const entry = { seq: 0, sliceId: crypto.randomUUID(), timestamp: new Date(),
        type: "task-started", taskId: crypto.randomUUID(), waveIndex: 0 };
      expect(() => JournalEntrySchema.parse(entry)).toThrow();
    });
    // Tests for all 7 entry types: valid parse + missing required field
  });
  ```
  **Run:** `npx vitest run src/hexagons/execution/domain/journal-entry.schemas.spec.ts`
  **Expect:** FAIL — module not found

- [ ] Step 2: Implement schemas
  **File:** `src/hexagons/execution/domain/journal-entry.schemas.ts`
  Implement exactly as in SPEC.md Domain Model section: `JournalEntryBaseSchema`, 7 entry type schemas, `JournalEntrySchema` discriminated union. Export all individual schemas + union + inferred types.
  **Run:** `npx vitest run src/hexagons/execution/domain/journal-entry.schemas.spec.ts`
  **Expect:** PASS

- [ ] Step 3: Commit
  ```
  feat(S02/T01): add JournalEntry discriminated union schemas
  ```

---

### T02: Journal error classes
**Files:** Create 4 error files
**Traces to:** (infrastructure for AC4-AC7, AC10, AC12)

- [ ] Step 1: Create error classes (no test needed — trivial extension of BaseDomainError)
  **Files:**
  - `src/hexagons/execution/domain/errors/journal-write.error.ts` — code: `"JOURNAL.WRITE_FAILURE"`
  - `src/hexagons/execution/domain/errors/journal-read.error.ts` — code: `"JOURNAL.READ_FAILURE"`, constructor takes `(message, metadata?)` where metadata includes `lineNumber?: number`
  - `src/hexagons/execution/domain/errors/journal-replay.error.ts` — code: `"JOURNAL.REPLAY_FAILURE"`, constructor takes `(message, metadata?)` where metadata includes `{ seq, entryType, reason }`
  - `src/hexagons/execution/domain/errors/rollback.error.ts` — code: `"JOURNAL.ROLLBACK_FAILURE"`, constructor takes `(message, metadata?)` where metadata includes `{ revertedCommits, failedCommit }`

  Pattern per file (example `journal-write.error.ts`):
  ```typescript
  import { BaseDomainError } from "@kernel";
  export class JournalWriteError extends BaseDomainError {
    readonly code = "JOURNAL.WRITE_FAILURE";
    constructor(message: string, metadata?: Record<string, unknown>) {
      super(message, metadata);
    }
  }
  ```

- [ ] Step 2: Commit
  ```
  feat(S02/T02): add journal error classes
  ```

---

### T03: SliceStatusVO back-edge (executing -> planning)
**Files:** Modify `slice-status.vo.ts`, `slice-status.vo.spec.ts`
**Traces to:** (prerequisite for AC6 rollback)

- [ ] Step 1: Write failing test
  **File:** `src/hexagons/slice/domain/slice-status.vo.spec.ts`
  Add test:
  ```typescript
  it("allows executing -> planning (rollback back-edge)", () => {
    const vo = SliceStatusVO.create("executing");
    const result = vo.transitionTo("planning");
    expect(result.ok).toBe(true);
  });
  ```
  **Run:** `npx vitest run src/hexagons/slice/domain/slice-status.vo.spec.ts`
  **Expect:** FAIL — `InvalidTransitionError: Cannot transition Slice from executing to planning`

- [ ] Step 2: Add back-edge
  **File:** `src/hexagons/slice/domain/slice-status.vo.ts` line 16
  Change: `["executing", new Set(["verifying"])]`
  To: `["executing", new Set(["verifying", "planning"])]`
  **Run:** `npx vitest run src/hexagons/slice/domain/slice-status.vo.spec.ts`
  **Expect:** PASS

- [ ] Step 3: Commit
  ```
  feat(S02/T03): add executing->planning back-edge for rollback
  ```

---

### T04: GitPort extensions (revert + isAncestor)
**Files:** Modify `git.port.ts`, `git-cli.adapter.ts`, `git-cli.adapter.integration.spec.ts`
**Traces to:** AC11

- [ ] Step 1: Write failing integration tests
  **File:** `src/kernel/infrastructure/git-cli.adapter.integration.spec.ts`
  Add within existing describe block:
  ```typescript
  describe("revert", () => {
    it("reverts a commit", async () => {
      writeFileSync(join(repoDir, "revert-test.txt"), "content");
      git(["add", "revert-test.txt"], repoDir);
      git(["commit", "-m", "add revert-test"], repoDir);
      const logResult = await adapter.log("HEAD", 1);
      expect(isOk(logResult)).toBe(true);
      const hash = logResult.ok ? logResult.data[0].hash : "";
      const result = await adapter.revert(hash);
      expect(isOk(result)).toBe(true);
    });
  });

  describe("isAncestor", () => {
    it("returns true when commit is ancestor", async () => {
      const logResult = await adapter.log("HEAD", 2);
      const [child, parent] = logResult.ok ? logResult.data : [];
      const result = await adapter.isAncestor(parent.hash, child.hash);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.data).toBe(true);
    });
    it("returns false when commit is not ancestor", async () => {
      const logResult = await adapter.log("HEAD", 2);
      const [child, parent] = logResult.ok ? logResult.data : [];
      const result = await adapter.isAncestor(child.hash, parent.hash);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.data).toBe(false);
    });
  });
  ```
  **Run:** `npx vitest run src/kernel/infrastructure/git-cli.adapter.integration.spec.ts`
  **Expect:** FAIL — `adapter.revert is not a function`

- [ ] Step 2: Add abstract methods to GitPort
  **File:** `src/kernel/ports/git.port.ts`
  ```typescript
  abstract revert(commitHash: string): Promise<Result<void, GitError>>;
  abstract isAncestor(ancestor: string, descendant: string): Promise<Result<boolean, GitError>>;
  ```

- [ ] Step 3: Implement in GitCliAdapter
  **File:** `src/kernel/infrastructure/git-cli.adapter.ts`
  ```typescript
  async revert(commitHash: string): Promise<Result<void, GitError>> {
    const result = await this.runGit(["revert", "--no-edit", commitHash]);
    if (!result.ok) return result;
    return ok(undefined);
  }

  async isAncestor(ancestor: string, descendant: string): Promise<Result<boolean, GitError>> {
    return new Promise((resolve) => {
      execFile(
        "git",
        ["--no-pager", "-c", "color.ui=never", "merge-base", "--is-ancestor", ancestor, descendant],
        { cwd: this.cwd, encoding: "utf-8", env: this.cleanGitEnv() },
        (error) => {
          if (!error) { resolve(ok(true)); return; }
          if (error.code === 1) { resolve(ok(false)); return; }
          resolve(err(this.mapError(error, "")));
        },
      );
    });
  }
  ```
  **Run:** `npx vitest run src/kernel/infrastructure/git-cli.adapter.integration.spec.ts`
  **Expect:** PASS

- [ ] Step 4: Commit
  ```
  feat(S02/T04): extend GitPort with revert and isAncestor
  ```

---

### T05: Extend domain events
**Files:** Modify 4 event files + their emitters
**Traces to:** AC8

- [ ] Step 1: Extend CheckpointSavedEvent
  **File:** `src/hexagons/execution/domain/events/checkpoint-saved.event.ts`
  Add `completedTaskCount: z.number().int().min(0)` to props schema. Add `readonly completedTaskCount: number` field. Assign in constructor.

- [ ] Step 2: Update Checkpoint emitters
  **File:** `src/hexagons/execution/domain/checkpoint.aggregate.ts`
  Both `recordTaskComplete` and `advanceWave` emission sites: add `completedTaskCount: this.props.completedTasks.length`.

- [ ] Step 3: Extend TaskCompletedEvent
  **File:** `src/hexagons/task/domain/events/task-completed.event.ts`
  Extend `DomainEventPropsSchema` with:
  ```typescript
  sliceId: IdSchema,
  taskId: IdSchema,
  waveIndex: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  commitHash: z.string().optional(),
  ```
  Add readonly fields and assign in constructor (same pattern as CheckpointSavedEvent).

- [ ] Step 4: Extend TaskBlockedEvent
  **File:** `src/hexagons/task/domain/events/task-blocked.event.ts`
  Add: `sliceId`, `taskId`, `waveIndex`, `errorCode`, `errorMessage` fields.

- [ ] Step 5: Extend SliceStatusChangedEvent
  **File:** `src/hexagons/slice/domain/events/slice-status-changed.event.ts`
  Add: `from: z.string()`, `to: z.string()` fields.

- [ ] Step 6: Update existing tests that construct these events (add required fields)
  **Run:** `npx vitest run`
  **Expect:** PASS (all existing tests still pass with updated event constructors)

- [ ] Step 7: Commit
  ```
  feat(S02/T05): extend domain events with journal-required fields
  ```

---

## Wave 1 (depends on Wave 0)

### T06: JournalEntry builder
**Files:** Create `journal-entry.builder.ts`
**Traces to:** (test infrastructure for all subsequent tasks)
**Depends on:** T01

- [ ] Step 1: Create builder
  **File:** `src/hexagons/execution/domain/journal-entry.builder.ts`
  Pattern: factory methods per entry type (not one builder for all). Each returns `Omit<JournalEntry, 'seq'>`:
  ```typescript
  import { faker } from "@faker-js/faker";
  import type { JournalEntry } from "./journal-entry.schemas";

  export class JournalEntryBuilder {
    private _sliceId = faker.string.uuid();
    private _timestamp = faker.date.recent();
    private _correlationId: string | undefined = undefined;

    withSliceId(id: string): this { this._sliceId = id; return this; }
    withTimestamp(ts: Date): this { this._timestamp = ts; return this; }
    withCorrelationId(id: string): this { this._correlationId = id; return this; }

    buildTaskStarted(overrides?: Partial<{taskId: string; waveIndex: number; agentIdentity: string}>): Omit<JournalEntry, 'seq'> {
      return { type: "task-started", sliceId: this._sliceId, timestamp: this._timestamp,
        correlationId: this._correlationId, taskId: overrides?.taskId ?? faker.string.uuid(),
        waveIndex: overrides?.waveIndex ?? 0, agentIdentity: overrides?.agentIdentity ?? "opus" };
    }

    buildTaskCompleted(overrides?: Partial<{taskId: string; waveIndex: number; durationMs: number; commitHash: string}>): Omit<JournalEntry, 'seq'> {
      return { type: "task-completed", sliceId: this._sliceId, timestamp: this._timestamp,
        correlationId: this._correlationId, taskId: overrides?.taskId ?? faker.string.uuid(),
        waveIndex: overrides?.waveIndex ?? 0, durationMs: overrides?.durationMs ?? 1000,
        commitHash: overrides?.commitHash };
    }

    // buildTaskFailed, buildFileWritten, buildCheckpointSaved,
    // buildPhaseChanged, buildArtifactWritten — same pattern
  }
  ```
  (No test needed for builder — tested via usage in contract/use-case specs)

- [ ] Step 2: Commit
  ```
  feat(S02/T06): add JournalEntry builder for test fixtures
  ```

---

### T07: JournalRepositoryPort
**Files:** Create `journal-repository.port.ts`
**Traces to:** AC1, AC2, AC9
**Depends on:** T01, T02

- [ ] Step 1: Create port
  **File:** `src/hexagons/execution/domain/ports/journal-repository.port.ts`
  ```typescript
  import type { Result } from "@kernel";
  import type { JournalEntry } from "../journal-entry.schemas";
  import type { JournalReadError } from "../errors/journal-read.error";
  import type { JournalWriteError } from "../errors/journal-write.error";

  export abstract class JournalRepositoryPort {
    abstract append(sliceId: string, entry: Omit<JournalEntry, "seq">): Promise<Result<number, JournalWriteError>>;
    abstract readAll(sliceId: string): Promise<Result<readonly JournalEntry[], JournalReadError>>;
    abstract readSince(sliceId: string, afterSeq: number): Promise<Result<readonly JournalEntry[], JournalReadError>>;
    abstract count(sliceId: string): Promise<Result<number, JournalReadError>>;
  }
  ```
  (No test for abstract class — tested via contract spec)

- [ ] Step 2: Commit
  ```
  feat(S02/T07): add JournalRepositoryPort
  ```

---

## Wave 2 (depends on Wave 1)

### T08: InMemoryJournalRepository + contract spec
**Files:** Create `in-memory-journal.repository.ts`, `journal-repository.contract.spec.ts`, `in-memory-journal.repository.spec.ts`
**Traces to:** AC1, AC2, AC9
**Depends on:** T06, T07

- [ ] Step 1: Write contract spec
  **File:** `src/hexagons/execution/infrastructure/journal-repository.contract.spec.ts`
  ```typescript
  import { isOk } from "@kernel";
  import { beforeEach, describe, expect, it } from "vitest";
  import { JournalEntryBuilder } from "../domain/journal-entry.builder";
  import type { JournalRepositoryPort } from "../domain/ports/journal-repository.port";

  export function runJournalContractTests(
    name: string,
    factory: () => JournalRepositoryPort & { reset(): void },
  ) {
    describe(`${name} contract`, () => {
      let repo: JournalRepositoryPort & { reset(): void };
      const builder = new JournalEntryBuilder();

      beforeEach(() => { repo = factory(); repo.reset(); });

      it("append assigns monotonic seq starting at 0 (AC2)", async () => { ... });
      it("readAll returns entries in seq order (AC2)", async () => { ... });
      it("readSince filters entries after specified seq (AC9)", async () => { ... });
      it("count matches number of appended entries", async () => { ... });
      it("append to new slice creates entry list", async () => { ... });
      it("readAll returns empty for unknown slice", async () => { ... });
    });
  }
  ```
  **Run:** `npx vitest run src/hexagons/execution/infrastructure/in-memory-journal.repository.spec.ts`
  **Expect:** FAIL — module not found

- [ ] Step 2: Implement in-memory adapter
  **File:** `src/hexagons/execution/infrastructure/in-memory-journal.repository.ts`
  ```typescript
  import { ok, type Result } from "@kernel";
  import type { JournalEntry } from "../domain/journal-entry.schemas";
  import type { JournalReadError } from "../domain/errors/journal-read.error";
  import type { JournalWriteError } from "../domain/errors/journal-write.error";
  import { JournalRepositoryPort } from "../domain/ports/journal-repository.port";

  export class InMemoryJournalRepository extends JournalRepositoryPort {
    private store = new Map<string, JournalEntry[]>();

    async append(sliceId: string, entry: Omit<JournalEntry, "seq">): Promise<Result<number, JournalWriteError>> {
      const entries = this.store.get(sliceId) ?? [];
      const seq = entries.length;
      const fullEntry = JournalEntrySchema.parse({ ...entry, seq });
      this.store.set(sliceId, [...entries, fullEntry]);
      return ok(seq);
    }

    async readAll(sliceId: string): Promise<Result<readonly JournalEntry[], JournalReadError>> {
      return ok(this.store.get(sliceId) ?? []);
    }

    async readSince(sliceId: string, afterSeq: number): Promise<Result<readonly JournalEntry[], JournalReadError>> {
      const entries = this.store.get(sliceId) ?? [];
      return ok(entries.filter((e) => e.seq > afterSeq));
    }

    async count(sliceId: string): Promise<Result<number, JournalReadError>> {
      return ok((this.store.get(sliceId) ?? []).length);
    }

    seed(sliceId: string, entries: JournalEntry[]): void { this.store.set(sliceId, entries); }
    reset(): void { this.store.clear(); }
  }
  ```

- [ ] Step 3: Wire contract tests
  **File:** `src/hexagons/execution/infrastructure/in-memory-journal.repository.spec.ts`
  ```typescript
  import { runJournalContractTests } from "./journal-repository.contract.spec";
  import { InMemoryJournalRepository } from "./in-memory-journal.repository";

  runJournalContractTests("InMemoryJournalRepository", () => new InMemoryJournalRepository());
  ```
  **Run:** `npx vitest run src/hexagons/execution/infrastructure/in-memory-journal.repository.spec.ts`
  **Expect:** PASS

- [ ] Step 4: Commit
  ```
  feat(S02/T08): add InMemoryJournalRepository with contract tests
  ```

---

### T09: JsonlJournalRepository + adapter spec
**Files:** Create `jsonl-journal.repository.ts`, `jsonl-journal.repository.spec.ts`
**Traces to:** AC1, AC10
**Depends on:** T06, T07

- [ ] Step 1: Write adapter-specific tests
  **File:** `src/hexagons/execution/infrastructure/jsonl-journal.repository.spec.ts`
  ```typescript
  import { mkdtemp, rm, writeFile } from "node:fs/promises";
  import { tmpdir } from "node:os";
  import { join } from "node:path";
  import { isErr, isOk } from "@kernel";
  import { afterAll, beforeAll, describe, expect, it } from "vitest";
  import { runJournalContractTests } from "./journal-repository.contract.spec";
  import { JsonlJournalRepository } from "./jsonl-journal.repository";

  let basePath: string;
  beforeAll(async () => { basePath = await mkdtemp(join(tmpdir(), "tff-journal-")); });
  afterAll(async () => { await rm(basePath, { recursive: true, force: true }); });

  runJournalContractTests("JsonlJournalRepository",
    () => new JsonlJournalRepository(basePath));

  describe("JsonlJournalRepository -- adapter-specific", () => {
    it("survives process restart (AC1)", async () => {
      const repo1 = new JsonlJournalRepository(basePath);
      const sliceId = crypto.randomUUID();
      await repo1.append(sliceId, { type: "phase-changed", sliceId, timestamp: new Date(), from: "planning", to: "executing" });

      const repo2 = new JsonlJournalRepository(basePath);  // new instance
      const result = await repo2.readAll(sliceId);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.data).toHaveLength(1);
    });

    it("detects corrupted JSONL line with line number (AC10)", async () => {
      const sliceId = "corrupt-test";
      const filePath = join(basePath, `${sliceId}.jsonl`);
      await writeFile(filePath, '{"valid":true}\n{truncated\n', "utf-8");
      const repo = new JsonlJournalRepository(basePath);
      const result = await repo.readAll(sliceId);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe("JOURNAL.READ_FAILURE");
        expect(result.error.metadata?.lineNumber).toBe(2);
      }
    });
  });
  ```
  **Run:** `npx vitest run src/hexagons/execution/infrastructure/jsonl-journal.repository.spec.ts`
  **Expect:** FAIL — module not found

- [ ] Step 2: Implement JSONL adapter
  **File:** `src/hexagons/execution/infrastructure/jsonl-journal.repository.ts`
  ```typescript
  import { appendFile, readFile } from "node:fs/promises";
  import { join } from "node:path";
  import { err, ok, type Result } from "@kernel";
  import { type JournalEntry, JournalEntrySchema } from "../domain/journal-entry.schemas";
  import { JournalReadError } from "../domain/errors/journal-read.error";
  import { JournalWriteError } from "../domain/errors/journal-write.error";
  import { JournalRepositoryPort } from "../domain/ports/journal-repository.port";

  export class JsonlJournalRepository extends JournalRepositoryPort {
    constructor(private readonly basePath: string) { super(); }

    private filePath(sliceId: string): string {
      return join(this.basePath, `${sliceId}.jsonl`);
    }

    async append(sliceId: string, entry: Omit<JournalEntry, "seq">): Promise<Result<number, JournalWriteError>> {
      const countResult = await this.count(sliceId);
      if (!countResult.ok) return err(new JournalWriteError(countResult.error.message));
      const seq = countResult.data;
      const fullEntry = { ...entry, seq, timestamp: entry.timestamp instanceof Date ? entry.timestamp.toISOString() : entry.timestamp };
      try {
        await appendFile(this.filePath(sliceId), JSON.stringify(fullEntry) + "\n", "utf-8");
        return ok(seq);
      } catch (error: unknown) {
        return err(new JournalWriteError(error instanceof Error ? error.message : String(error)));
      }
    }

    async readAll(sliceId: string): Promise<Result<readonly JournalEntry[], JournalReadError>> {
      let content: string;
      try {
        content = await readFile(this.filePath(sliceId), "utf-8");
      } catch (error: unknown) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return ok([]);
        return err(new JournalReadError(error instanceof Error ? error.message : String(error)));
      }
      const lines = content.split("\n").filter((l) => l.trim());
      const entries: JournalEntry[] = [];
      for (let i = 0; i < lines.length; i++) {
        try {
          const raw = JSON.parse(lines[i]);
          entries.push(JournalEntrySchema.parse(raw));
        } catch (error: unknown) {
          return err(new JournalReadError(
            `Corrupt entry at line ${i + 1}: ${error instanceof Error ? error.message : String(error)}`,
            { lineNumber: i + 1, rawContent: lines[i] },
          ));
        }
      }
      return ok(entries);
    }

    async readSince(sliceId: string, afterSeq: number): Promise<Result<readonly JournalEntry[], JournalReadError>> {
      const result = await this.readAll(sliceId);
      if (!result.ok) return result;
      return ok(result.data.filter((e) => e.seq > afterSeq));
    }

    async count(sliceId: string): Promise<Result<number, JournalReadError>> {
      const result = await this.readAll(sliceId);
      if (!result.ok) return result;
      return ok(result.data.length);
    }

    reset(): void { /* no-op for contract tests — each test uses fresh sliceId */ }
  }
  ```
  **Run:** `npx vitest run src/hexagons/execution/infrastructure/jsonl-journal.repository.spec.ts`
  **Expect:** PASS

- [ ] Step 3: Commit
  ```
  feat(S02/T09): add JsonlJournalRepository with JSONL persistence
  ```

---

## Wave 3 (depends on Wave 2)

### T10: JournalEventHandler + spec
**Files:** Create `journal-event-handler.ts`, `journal-event-handler.spec.ts`
**Traces to:** AC8
**Depends on:** T05, T07, T08

- [ ] Step 1: Write failing test
  **File:** `src/hexagons/execution/application/journal-event-handler.spec.ts`
  Test: emit `CheckpointSavedEvent` → verify `checkpoint-saved` entry appended to journal.
  Test: emit `TaskCompletedEvent` → verify `task-completed` entry appended.
  Test: emit `TaskBlockedEvent` → verify `task-failed` entry appended with `retryable: true`.
  Test: emit `SliceStatusChangedEvent` → verify `phase-changed` entry appended.
  Test: verify entry has correct `sliceId` from event payload.
  Use `InProcessEventBus` + `InMemoryJournalRepository`. Subscribe handler, publish event, read journal.
  **Run:** `npx vitest run src/hexagons/execution/application/journal-event-handler.spec.ts`
  **Expect:** FAIL

- [ ] Step 2: Implement handler
  **File:** `src/hexagons/execution/application/journal-event-handler.ts`
  Class with constructor taking `JournalRepositoryPort` + `DateProviderPort`. Methods:
  - `register(eventBus: EventBusPort)`: subscribes to 4 event types
  - Private handlers map each event to the corresponding journal entry and call `repo.append()`
  **Run:** `npx vitest run src/hexagons/execution/application/journal-event-handler.spec.ts`
  **Expect:** PASS

- [ ] Step 3: Commit
  ```
  feat(S02/T10): add JournalEventHandler with event subscriptions
  ```

---

### T11: ReplayJournalUseCase + spec
**Files:** Create `replay-journal.use-case.ts`, `replay-journal.use-case.spec.ts`
**Traces to:** AC4, AC5
**Depends on:** T07, T08

- [ ] Step 1: Write failing tests
  **File:** `src/hexagons/execution/application/replay-journal.use-case.spec.ts`
  Tests:
  - Consistent journal + checkpoint → ok with correct `resumeFromWave`, `completedTaskIds` (AC4)
  - Checkpoint has completed task but journal missing entry → `JournalReplayError` (AC5)
  - Empty journal + empty checkpoint → ok (fresh start)
  - Empty journal + non-empty checkpoint → error (pre-journal checkpoint)
  Use `InMemoryJournalRepository` seeded with entries, `CheckpointBuilder` for checkpoint.
  **Run:** `npx vitest run src/hexagons/execution/application/replay-journal.use-case.spec.ts`
  **Expect:** FAIL

- [ ] Step 2: Implement use case
  **File:** `src/hexagons/execution/application/replay-journal.use-case.ts`
  Follow SPEC.md algorithm exactly: read entries → walk → cross-validate → return `ReplayResult`.
  **Run:** `npx vitest run src/hexagons/execution/application/replay-journal.use-case.spec.ts`
  **Expect:** PASS

- [ ] Step 3: Commit
  ```
  feat(S02/T11): add ReplayJournalUseCase with cross-validation
  ```

---

### T12: RollbackSliceUseCase + spec
**Files:** Create `rollback-slice.use-case.ts`, `rollback-slice.use-case.spec.ts`
**Traces to:** AC6, AC7, AC12
**Depends on:** T03, T04, T07, T08

- [ ] Step 1: Write failing tests
  **File:** `src/hexagons/execution/application/rollback-slice.use-case.spec.ts`
  Tests:
  - Reverts execution commits in reverse order (AC6): mock GitPort, verify `revert()` call order
  - Excludes commits from non-task-completed entries (AC7): journal has task-completed + artifact-written, only task-completed commitHashes reverted
  - Partial failure returns error with `revertedCommits` + `failedReverts` (AC12): GitPort.revert() fails on 3rd commit
  - Full success delegates transition via `PhaseTransitionPort` (local port in execution hexagon — avoids cross-hexagon coupling to workflow)
  Use `InMemoryJournalRepository` + mock `GitPort` + mock `PhaseTransitionPort`.
  **Run:** `npx vitest run src/hexagons/execution/application/rollback-slice.use-case.spec.ts`
  **Expect:** FAIL

- [ ] Step 2: Implement use case
  **File:** `src/hexagons/execution/application/rollback-slice.use-case.ts`
  Follow SPEC.md algorithm: read entries → collect commitHashes → isAncestor filter → revert in reverse → handle partial failure → delegate transition via `PhaseTransitionPort`.
  **Note:** `PhaseTransitionPort` is a local abstract class in `src/hexagons/execution/domain/ports/phase-transition.port.ts` with a single method `transition(sliceId, from, to)`. The workflow hexagon's `WorkflowSliceTransitionAdapter` implements it at wiring time. This keeps execution hexagon decoupled from workflow.
  **Run:** `npx vitest run src/hexagons/execution/application/rollback-slice.use-case.spec.ts`
  **Expect:** PASS

- [ ] Step 3: Commit
  ```
  feat(S02/T12): add RollbackSliceUseCase with partial failure handling
  ```

---

## Wave 4 (depends on all)

### T13: Barrel exports update
**Files:** Modify `src/hexagons/execution/index.ts`
**Traces to:** (integration, all ACs depend on proper exports)
**Depends on:** T01-T12

- [ ] Step 1: Update barrel
  **File:** `src/hexagons/execution/index.ts`
  Add exports for:
  - Schema types + validators: `JournalEntry`, `JournalEntrySchema`, all 7 entry type schemas + types
  - Errors: `JournalWriteError`, `JournalReadError`, `JournalReplayError`, `RollbackError`
  - Ports: `JournalRepositoryPort`
  - Infrastructure: `InMemoryJournalRepository`
  - Application: `JournalEventHandler`, `ReplayJournalUseCase`, `RollbackSliceUseCase`

- [ ] Step 2: Run full test suite
  **Run:** `npx vitest run`
  **Expect:** PASS — all tests passing

- [ ] Step 3: Commit
  ```
  feat(S02/T13): update barrel exports for journal module
  ```
