# M05-S02: Fresh-Reviewer Enforcement — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Prevent self-review by enforcing that reviewer agents differ from slice executors.
**Architecture:** FreshReviewerService (Review domain) queries ExecutorQueryPort → CachedExecutorQueryAdapter → GetSliceExecutorsUseCase (Execution app).
**Tech Stack:** TypeScript, Zod, Vitest, @kernel Result type

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| CREATE | `src/hexagons/review/domain/errors/executor-query.error.ts` | ExecutorQueryError |
| MODIFY | `src/hexagons/review/domain/errors/fresh-reviewer-violation.error.ts` | Add executors field |
| CREATE | `src/hexagons/review/domain/ports/executor-query.port.ts` | ExecutorQueryPort abstract class |
| CREATE | `src/hexagons/review/domain/services/fresh-reviewer.service.ts` | FreshReviewerService |
| CREATE | `src/hexagons/review/domain/services/fresh-reviewer.service.spec.ts` | Service unit tests |
| CREATE | `src/hexagons/review/infrastructure/cached-executor-query.adapter.ts` | CachedExecutorQueryAdapter |
| CREATE | `src/hexagons/review/infrastructure/cached-executor-query.adapter.spec.ts` | Cache tests |
| CREATE | `src/hexagons/execution/application/get-slice-executors.use-case.ts` | GetSliceExecutorsUseCase |
| CREATE | `src/hexagons/execution/application/get-slice-executors.use-case.spec.ts` | Use case tests |
| MODIFY | `src/hexagons/execution/index.ts` | Export use case |
| MODIFY | `src/hexagons/review/index.ts` | Export new types |
| CREATE | `src/hexagons/review/integration/fresh-reviewer.integration.spec.ts` | Cross-hexagon integration |

---

## Wave 0 (parallel — domain errors + port + execution use case)

### T01: Write failing test for ExecutorQueryError

**Files:** Create `src/hexagons/review/domain/errors/executor-query.error.ts`
**Traces to:** AC4

- [ ] Step 1: Create `executor-query.error.ts` with the error class:

```typescript
// src/hexagons/review/domain/errors/executor-query.error.ts
import { BaseDomainError } from "@kernel";

export class ExecutorQueryError extends BaseDomainError {
  readonly code = "REVIEW.EXECUTOR_QUERY_FAILED";

  constructor(message: string, cause?: Error) {
    super(message, { cause: cause?.message });
  }
}
```

- [ ] Step 2: Verify it compiles: `npx tsc --noEmit --pretty 2>&1 | head -20`
- [ ] Step 3: Commit: `git commit -m "feat(S02/T01): add ExecutorQueryError domain error"`

---

### T02: Modify FreshReviewerViolationError to include executors set

**Files:** Modify `src/hexagons/review/domain/errors/fresh-reviewer-violation.error.ts`
**Traces to:** AC1

- [ ] Step 1: Update constructor to accept executors:

```typescript
// src/hexagons/review/domain/errors/fresh-reviewer-violation.error.ts
import { BaseDomainError } from "@kernel";

export class FreshReviewerViolationError extends BaseDomainError {
  readonly code = "REVIEW.FRESH_REVIEWER_VIOLATION";

  constructor(reviewerId: string, sliceId: string, executors: ReadonlySet<string>) {
    super(`Reviewer "${reviewerId}" was also an executor for slice "${sliceId}"`, {
      reviewerId,
      sliceId,
      executors: [...executors],
    });
  }
}
```

- [ ] Step 2: Run existing tests to ensure no breakage: `npx vitest run src/hexagons/review/ --reporter=verbose 2>&1 | tail -30`
- [ ] Step 3: Fix any callers that break (search for `new FreshReviewerViolationError`)
- [ ] Step 4: Commit: `git commit -m "feat(S02/T02): extend FreshReviewerViolationError with executors set"`

---

### T03: Create ExecutorQueryPort abstract class

**Files:** Create `src/hexagons/review/domain/ports/executor-query.port.ts`
**Traces to:** AC5

- [ ] Step 1: Create the port:

```typescript
// src/hexagons/review/domain/ports/executor-query.port.ts
import type { Result } from "@kernel";
import type { ExecutorQueryError } from "../errors/executor-query.error";

export abstract class ExecutorQueryPort {
  abstract getSliceExecutors(
    sliceId: string,
  ): Promise<Result<ReadonlySet<string>, ExecutorQueryError>>;
}
```

- [ ] Step 2: Verify it compiles: `npx tsc --noEmit --pretty 2>&1 | head -20`
- [ ] Step 3: Commit: `git commit -m "feat(S02/T03): add ExecutorQueryPort outbound port"`

---

### T04: Write failing test for GetSliceExecutorsUseCase

**Files:** Create `src/hexagons/execution/application/get-slice-executors.use-case.spec.ts`
**Traces to:** AC2, AC3

- [ ] Step 1: Write the test file:

```typescript
// src/hexagons/execution/application/get-slice-executors.use-case.spec.ts
import { isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { Checkpoint } from "../domain/checkpoint.aggregate";
import { InMemoryCheckpointRepository } from "../infrastructure/in-memory-checkpoint.repository";
import { GetSliceExecutorsUseCase } from "./get-slice-executors.use-case";

describe("GetSliceExecutorsUseCase", () => {
  const sliceId = "slice-1";
  const now = new Date();

  function setup() {
    const repo = new InMemoryCheckpointRepository();
    const useCase = new GetSliceExecutorsUseCase(repo);
    return { repo, useCase };
  }

  it("returns unique agent identities from executor log (AC2)", async () => {
    const { repo, useCase } = setup();
    const checkpoint = Checkpoint.createNew({ id: "cp-1", sliceId, baseCommit: "abc", now });
    checkpoint.recordTaskStart("t1", "agent-alpha", now);
    checkpoint.recordTaskStart("t2", "agent-beta", now);
    checkpoint.recordTaskStart("t3", "agent-alpha", now); // duplicate
    repo.seed(checkpoint);

    const result = await useCase.execute(sliceId);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toEqual(new Set(["agent-alpha", "agent-beta"]));
    }
  });

  it("returns empty set when no checkpoint exists (AC3)", async () => {
    const { useCase } = setup();
    const result = await useCase.execute("nonexistent");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.size).toBe(0);
    }
  });

  it("returns empty set when executor log is empty", async () => {
    const { repo, useCase } = setup();
    const checkpoint = Checkpoint.createNew({ id: "cp-2", sliceId, baseCommit: "abc", now });
    repo.seed(checkpoint);

    const result = await useCase.execute(sliceId);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.size).toBe(0);
    }
  });
});
```

- [ ] Step 2: Run test, verify FAIL: `npx vitest run src/hexagons/execution/application/get-slice-executors.use-case.spec.ts 2>&1 | tail -20`
- [ ] Step 3: Expected: FAIL — "Cannot find module ./get-slice-executors.use-case"

---

### T05: Implement GetSliceExecutorsUseCase

**Files:** Create `src/hexagons/execution/application/get-slice-executors.use-case.ts`, Modify `src/hexagons/execution/index.ts`
**Traces to:** AC2, AC3

- [ ] Step 1: Create the use case:

```typescript
// src/hexagons/execution/application/get-slice-executors.use-case.ts
import { ok, type PersistenceError, type Result } from "@kernel";
import { CheckpointRepositoryPort } from "../domain/ports/checkpoint-repository.port";

export class GetSliceExecutorsUseCase {
  constructor(private readonly checkpointRepo: CheckpointRepositoryPort) {}

  async execute(sliceId: string): Promise<Result<ReadonlySet<string>, PersistenceError>> {
    const result = await this.checkpointRepo.findBySliceId(sliceId);
    if (!result.ok) return result;

    const checkpoint = result.data;
    if (!checkpoint) return ok(new Set<string>());

    const identities = new Set(checkpoint.executorLog.map((e) => e.agentIdentity));
    return ok(identities);
  }
}
```

- [ ] Step 2: Add exports to `src/hexagons/execution/index.ts`:

```typescript
// Application -- Queries
export { GetSliceExecutorsUseCase } from "./application/get-slice-executors.use-case";
// Domain -- Aggregates (for downstream test wiring)
export { Checkpoint } from "./domain/checkpoint.aggregate";
```

- [ ] Step 3: Run test, verify PASS: `npx vitest run src/hexagons/execution/application/get-slice-executors.use-case.spec.ts --reporter=verbose 2>&1 | tail -20`
- [ ] Step 4: Commit: `git commit -m "feat(S02/T05): implement GetSliceExecutorsUseCase"`

---

## Wave 1 (depends on Wave 0 — domain service + adapter)

### T06: Write failing test for FreshReviewerService

**Files:** Create `src/hexagons/review/domain/services/fresh-reviewer.service.spec.ts`
**Traces to:** AC1, AC2, AC3, AC4

- [ ] Step 1: Write the test file:

```typescript
// src/hexagons/review/domain/services/fresh-reviewer.service.spec.ts
import { err, isErr, isOk, ok } from "@kernel";
import { describe, expect, it } from "vitest";
import { ExecutorQueryError } from "../errors/executor-query.error";
import { FreshReviewerViolationError } from "../errors/fresh-reviewer-violation.error";
import { ExecutorQueryPort } from "../ports/executor-query.port";
import { FreshReviewerService } from "./fresh-reviewer.service";

class StubExecutorQueryPort extends ExecutorQueryPort {
  constructor(private readonly result: Awaited<ReturnType<ExecutorQueryPort["getSliceExecutors"]>>) {
    super();
  }
  async getSliceExecutors() {
    return this.result;
  }
}

describe("FreshReviewerService", () => {
  const sliceId = "slice-1";

  it("returns error when candidate is in executor set (AC1)", async () => {
    const port = new StubExecutorQueryPort(ok(new Set(["agent-a", "agent-b"])));
    const service = new FreshReviewerService(port);

    const result = await service.enforce(sliceId, "agent-a");
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(FreshReviewerViolationError);
    }
  });

  it("returns ok when candidate is not in executor set (AC2)", async () => {
    const port = new StubExecutorQueryPort(ok(new Set(["agent-a", "agent-b"])));
    const service = new FreshReviewerService(port);

    const result = await service.enforce(sliceId, "agent-c");
    expect(isOk(result)).toBe(true);
  });

  it("returns ok when executor set is empty — no checkpoint (AC3)", async () => {
    const port = new StubExecutorQueryPort(ok(new Set<string>()));
    const service = new FreshReviewerService(port);

    const result = await service.enforce(sliceId, "agent-x");
    expect(isOk(result)).toBe(true);
  });

  it("propagates ExecutorQueryError — fail-closed (AC4)", async () => {
    const port = new StubExecutorQueryPort(
      err(new ExecutorQueryError("db down")),
    );
    const service = new FreshReviewerService(port);

    const result = await service.enforce(sliceId, "agent-x");
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ExecutorQueryError);
    }
  });

  it("includes executor set in violation error metadata (AC1)", async () => {
    const executors = new Set(["agent-a", "agent-b"]);
    const port = new StubExecutorQueryPort(ok(executors));
    const service = new FreshReviewerService(port);

    const result = await service.enforce(sliceId, "agent-a");
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      const error = result.error as FreshReviewerViolationError;
      expect(error.metadata?.executors).toEqual(["agent-a", "agent-b"]);
    }
  });
});
```

- [ ] Step 2: Run test, verify FAIL: `npx vitest run src/hexagons/review/domain/services/fresh-reviewer.service.spec.ts 2>&1 | tail -20`
- [ ] Step 3: Expected: FAIL — "Cannot find module ./fresh-reviewer.service"

---

### T07: Implement FreshReviewerService

**Files:** Create `src/hexagons/review/domain/services/fresh-reviewer.service.ts`
**Traces to:** AC1, AC2, AC3, AC4

- [ ] Step 1: Create the service:

```typescript
// src/hexagons/review/domain/services/fresh-reviewer.service.ts
import { err, ok, type Result } from "@kernel";
import type { ExecutorQueryError } from "../errors/executor-query.error";
import { FreshReviewerViolationError } from "../errors/fresh-reviewer-violation.error";
import { ExecutorQueryPort } from "../ports/executor-query.port";

export class FreshReviewerService {
  constructor(private readonly executorQueryPort: ExecutorQueryPort) {}

  async enforce(
    sliceId: string,
    reviewerId: string,
  ): Promise<Result<void, FreshReviewerViolationError | ExecutorQueryError>> {
    const queryResult = await this.executorQueryPort.getSliceExecutors(sliceId);
    if (!queryResult.ok) return queryResult;

    const executors = queryResult.data;
    if (executors.has(reviewerId)) {
      return err(new FreshReviewerViolationError(reviewerId, sliceId, executors));
    }

    return ok(undefined);
  }
}
```

- [ ] Step 2: Run test, verify PASS: `npx vitest run src/hexagons/review/domain/services/fresh-reviewer.service.spec.ts --reporter=verbose 2>&1 | tail -20`
- [ ] Step 3: Commit: `git commit -m "feat(S02/T07): implement FreshReviewerService domain service"`

---

### T08: Write failing test for CachedExecutorQueryAdapter

**Files:** Create `src/hexagons/review/infrastructure/cached-executor-query.adapter.spec.ts`
**Traces to:** AC6, AC7

- [ ] Step 1: Write the test file:

```typescript
// src/hexagons/review/infrastructure/cached-executor-query.adapter.spec.ts
import { isOk, ok, type Result } from "@kernel";
import { describe, expect, it, vi } from "vitest";
import type { ExecutorQueryError } from "../domain/errors/executor-query.error";
import { CachedExecutorQueryAdapter } from "./cached-executor-query.adapter";

describe("CachedExecutorQueryAdapter", () => {
  function createSpy(responses: Map<string, ReadonlySet<string>>) {
    return vi.fn(
      async (sliceId: string): Promise<Result<ReadonlySet<string>, ExecutorQueryError>> => {
        return ok(responses.get(sliceId) ?? new Set());
      },
    );
  }

  it("delegates to underlying query on first call (AC6)", async () => {
    const responses = new Map([["s1", new Set(["agent-a"])]]);
    const spy = createSpy(responses);
    const adapter = new CachedExecutorQueryAdapter(spy);

    const result = await adapter.getSliceExecutors("s1");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toEqual(new Set(["agent-a"]));
    }
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("returns cached result on second call for same sliceId (AC6)", async () => {
    const responses = new Map([["s1", new Set(["agent-a"])]]);
    const spy = createSpy(responses);
    const adapter = new CachedExecutorQueryAdapter(spy);

    await adapter.getSliceExecutors("s1");
    await adapter.getSliceExecutors("s1");

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("queries again for different sliceId — per-key cache (AC7)", async () => {
    const responses = new Map([
      ["s1", new Set(["agent-a"])],
      ["s2", new Set(["agent-b"])],
    ]);
    const spy = createSpy(responses);
    const adapter = new CachedExecutorQueryAdapter(spy);

    await adapter.getSliceExecutors("s1");
    const result = await adapter.getSliceExecutors("s2");

    expect(spy).toHaveBeenCalledTimes(2);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toEqual(new Set(["agent-b"]));
    }
  });
});
```

- [ ] Step 2: Run test, verify FAIL: `npx vitest run src/hexagons/review/infrastructure/cached-executor-query.adapter.spec.ts 2>&1 | tail -20`
- [ ] Step 3: Expected: FAIL — "Cannot find module ./cached-executor-query.adapter"

---

### T09: Implement CachedExecutorQueryAdapter

**Files:** Create `src/hexagons/review/infrastructure/cached-executor-query.adapter.ts`
**Traces to:** AC6, AC7

- [ ] Step 1: Create the adapter:

```typescript
// src/hexagons/review/infrastructure/cached-executor-query.adapter.ts
import { ok, type Result } from "@kernel";
import type { ExecutorQueryError } from "../domain/errors/executor-query.error";
import { ExecutorQueryPort } from "../domain/ports/executor-query.port";

type QueryFn = (sliceId: string) => Promise<Result<ReadonlySet<string>, ExecutorQueryError>>;

export class CachedExecutorQueryAdapter extends ExecutorQueryPort {
  private readonly cache = new Map<string, ReadonlySet<string>>();

  constructor(private readonly queryFn: QueryFn) {
    super();
  }

  async getSliceExecutors(
    sliceId: string,
  ): Promise<Result<ReadonlySet<string>, ExecutorQueryError>> {
    const cached = this.cache.get(sliceId);
    if (cached) return ok(cached);

    const result = await this.queryFn(sliceId);
    if (result.ok) {
      this.cache.set(sliceId, result.data);
    }
    return result;
  }
}
```

- [ ] Step 2: Run test, verify PASS: `npx vitest run src/hexagons/review/infrastructure/cached-executor-query.adapter.spec.ts --reporter=verbose 2>&1 | tail -20`
- [ ] Step 3: Commit: `git commit -m "feat(S02/T09): implement CachedExecutorQueryAdapter"`

---

## Wave 2 (depends on Wave 1 — exports + integration)

### T10: Update review/index.ts exports

**Files:** Modify `src/hexagons/review/index.ts`
**Traces to:** AC5

- [ ] Step 1: Add exports for new types:

```typescript
// Add to src/hexagons/review/index.ts:
// Domain -- Errors (add)
export { ExecutorQueryError } from "./domain/errors/executor-query.error";
// Domain -- Ports (add)
export { ExecutorQueryPort } from "./domain/ports/executor-query.port";
// Domain -- Services (add)
export { FreshReviewerService } from "./domain/services/fresh-reviewer.service";
// Infrastructure -- Adapters (add)
export { CachedExecutorQueryAdapter } from "./infrastructure/cached-executor-query.adapter";
```

- [ ] Step 2: Verify compilation: `npx tsc --noEmit --pretty 2>&1 | head -20`
- [ ] Step 3: Commit: `git commit -m "feat(S02/T10): export fresh-reviewer types from review hexagon"`

---

### T11: Write integration test — cross-hexagon fresh-reviewer flow

**Files:** Create `src/hexagons/review/integration/fresh-reviewer.integration.spec.ts`
**Traces to:** AC1, AC2, AC3, AC4, AC5

- [ ] Step 1: Write the integration test:

```typescript
// src/hexagons/review/integration/fresh-reviewer.integration.spec.ts
import { err, isErr, isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import {
  Checkpoint,
  GetSliceExecutorsUseCase,
  InMemoryCheckpointRepository,
} from "../../execution";
import { ExecutorQueryError } from "../domain/errors/executor-query.error";
import { FreshReviewerViolationError } from "../domain/errors/fresh-reviewer-violation.error";
import { FreshReviewerService } from "../domain/services/fresh-reviewer.service";
import { CachedExecutorQueryAdapter } from "../infrastructure/cached-executor-query.adapter";

describe("Fresh-Reviewer Integration", () => {
  const sliceId = "slice-1";
  const now = new Date();

  function setup() {
    const checkpointRepo = new InMemoryCheckpointRepository();
    const getExecutors = new GetSliceExecutorsUseCase(checkpointRepo);
    const adapter = new CachedExecutorQueryAdapter(async (id) => {
      const result = await getExecutors.execute(id);
      if (!result.ok) return err(new ExecutorQueryError(result.error.message));
      return result;
    });
    const service = new FreshReviewerService(adapter);
    return { checkpointRepo, service };
  }

  it("rejects reviewer who executed the slice (AC1)", async () => {
    const { checkpointRepo, service } = setup();
    const cp = Checkpoint.createNew({ id: "cp-1", sliceId, baseCommit: "abc", now });
    cp.recordTaskStart("t1", "agent-executor", now);
    checkpointRepo.seed(cp);

    const result = await service.enforce(sliceId, "agent-executor");
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(FreshReviewerViolationError);
    }
  });

  it("allows fresh reviewer (AC2)", async () => {
    const { checkpointRepo, service } = setup();
    const cp = Checkpoint.createNew({ id: "cp-1", sliceId, baseCommit: "abc", now });
    cp.recordTaskStart("t1", "agent-executor", now);
    checkpointRepo.seed(cp);

    const result = await service.enforce(sliceId, "agent-reviewer");
    expect(isOk(result)).toBe(true);
  });

  it("allows any reviewer when no checkpoint exists (AC3)", async () => {
    const { service } = setup();
    const result = await service.enforce("no-checkpoint-slice", "agent-any");
    expect(isOk(result)).toBe(true);
  });
});
```

- [ ] Step 2: Run test, verify PASS: `npx vitest run src/hexagons/review/integration/fresh-reviewer.integration.spec.ts --reporter=verbose 2>&1 | tail -20`
- [ ] Step 3: Run full review hexagon test suite: `npx vitest run src/hexagons/review/ --reporter=verbose 2>&1 | tail -30`
- [ ] Step 4: Run full execution hexagon test suite: `npx vitest run src/hexagons/execution/ --reporter=verbose 2>&1 | tail -30`
- [ ] Step 5: Commit: `git commit -m "test(S02/T11): cross-hexagon fresh-reviewer integration test"`

---

### T12: Import boundary verification test

**Files:** Create `src/hexagons/review/integration/import-boundary.spec.ts`
**Traces to:** AC5

- [ ] Step 1: Write the boundary test:

```typescript
// src/hexagons/review/integration/import-boundary.spec.ts
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function getAllTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllTsFiles(fullPath));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("Review domain import boundary (AC5)", () => {
  const domainDir = resolve(import.meta.dirname, "../domain");

  it("review/domain/ has zero imports from execution/", () => {
    const files = getAllTsFiles(domainDir);
    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (/from\s+["'].*execution/.test(lines[i])) {
          violations.push(`${file}:${i + 1}: ${lines[i].trim()}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
```

- [ ] Step 2: Run test, verify PASS: `npx vitest run src/hexagons/review/integration/import-boundary.spec.ts --reporter=verbose 2>&1 | tail -20`
- [ ] Step 3: Commit: `git commit -m "test(S02/T12): import boundary verification for review domain"`
