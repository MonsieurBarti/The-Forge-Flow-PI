# M03-S03: Cross-Hexagon Event Wiring — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Wire cross-hexagon coordination so workflow phase changes synchronize with slice status transitions via `SliceTransitionPort`, `WorkflowSliceTransitionAdapter`, and `OrchestratePhaseTransitionUseCase`.

**Architecture:** Hexagonal — workflow hexagon defines port (`SliceTransitionPort`), slice hexagon provides adapter (`WorkflowSliceTransitionAdapter`). Orchestration use case coordinates: trigger session -> transition slice -> publish events.

**Tech Stack:** TypeScript, Zod, Vitest, `@kernel` Result type

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/hexagons/workflow/domain/phase-status-mapping.ts` | Create | Pure function mapping `WorkflowPhase` -> `SliceStatus \| null` |
| `src/hexagons/workflow/domain/phase-status-mapping.spec.ts` | Create | Tests for all 11 phase mappings |
| `src/hexagons/workflow/domain/ports/slice-transition.port.ts` | Create | Abstract port for slice transitions (owned by workflow hexagon) |
| `src/hexagons/workflow/domain/errors/slice-transition.error.ts` | Create | `SliceTransitionError` with code `WORKFLOW.SLICE_TRANSITION_FAILED` |
| `src/hexagons/slice/infrastructure/workflow-slice-transition.adapter.ts` | Create | Concrete adapter implementing `SliceTransitionPort` via `SliceRepositoryPort` |
| `src/hexagons/slice/infrastructure/workflow-slice-transition.adapter.spec.ts` | Create | Tests for adapter: happy path, not-found, idempotent, invalid transition |
| `src/hexagons/workflow/use-cases/orchestrate-phase-transition.use-case.ts` | Create | Coordinates trigger -> slice transition -> event publish |
| `src/hexagons/workflow/use-cases/orchestrate-phase-transition.use-case.spec.ts` | Create | Tests for use case: standard flow, shipping->closed, abort->no-transition, no-slice, errors |
| `src/hexagons/workflow/index.ts` | Modify | Add barrel exports for new types |
| `src/hexagons/slice/index.ts` | Modify | Add barrel exports for adapter |
| `src/hexagons/workflow/infrastructure/pi/workflow.extension.ts` | Modify | Add `SliceTransitionPort`, `EventBusPort`, `DateProviderPort` to `WorkflowExtensionDeps` |

---

## Wave 0 (parallel — no dependencies between groups)

### T01: Write failing test for `mapPhaseToSliceStatus`
**File:** `src/hexagons/workflow/domain/phase-status-mapping.spec.ts`
**Code:**
```typescript
import { describe, expect, it } from "vitest";
import { mapPhaseToSliceStatus } from "./phase-status-mapping";

describe("mapPhaseToSliceStatus", () => {
  it.each([
    ["discussing", "discussing"],
    ["researching", "researching"],
    ["planning", "planning"],
    ["executing", "executing"],
    ["verifying", "verifying"],
    ["reviewing", "reviewing"],
    ["shipping", "completing"],
  ] as const)("maps %s -> %s", (phase, expected) => {
    expect(mapPhaseToSliceStatus(phase)).toBe(expected);
  });

  it.each([
    ["idle"],
    ["completing-milestone"],
    ["paused"],
    ["blocked"],
  ] as const)("maps %s -> null", (phase) => {
    expect(mapPhaseToSliceStatus(phase)).toBeNull();
  });
});
```
**Run:** `npx vitest run src/hexagons/workflow/domain/phase-status-mapping.spec.ts`
**Expect:** FAIL — cannot find module `./phase-status-mapping`
**AC:** AC3

---

### T02: Implement `mapPhaseToSliceStatus`
**Depends on:** T01
**File:** `src/hexagons/workflow/domain/phase-status-mapping.ts`
**Code:**
```typescript
import type { SliceStatus } from "@hexagons/slice";
import type { WorkflowPhase } from "./workflow-session.schemas";

const PHASE_TO_STATUS: ReadonlyMap<WorkflowPhase, SliceStatus> = new Map([
  ["discussing", "discussing"],
  ["researching", "researching"],
  ["planning", "planning"],
  ["executing", "executing"],
  ["verifying", "verifying"],
  ["reviewing", "reviewing"],
  ["shipping", "completing"],
]);

export function mapPhaseToSliceStatus(phase: WorkflowPhase): SliceStatus | null {
  return PHASE_TO_STATUS.get(phase) ?? null;
}
```
**Run:** `npx vitest run src/hexagons/workflow/domain/phase-status-mapping.spec.ts`
**Expect:** PASS — 11 tests passing
**Commit:** `feat(S03/T02): add mapPhaseToSliceStatus pure function`

---

### T03: Create `SliceTransitionPort` and `SliceTransitionError`
**File 1:** `src/hexagons/workflow/domain/ports/slice-transition.port.ts`
**Code:**
```typescript
import type { Result } from "@kernel";
import type { SliceStatus } from "@hexagons/slice";
import type { SliceTransitionError } from "../errors/slice-transition.error";

export abstract class SliceTransitionPort {
  abstract transition(
    sliceId: string,
    targetStatus: SliceStatus,
  ): Promise<Result<void, SliceTransitionError>>;
}
```
**File 2:** `src/hexagons/workflow/domain/errors/slice-transition.error.ts`
**Code:**
```typescript
import { WorkflowBaseError } from "./workflow-base.error";

export class SliceTransitionError extends WorkflowBaseError {
  readonly code = "WORKFLOW.SLICE_TRANSITION_FAILED";

  constructor(sliceId: string, cause: string) {
    super(`Slice transition failed for '${sliceId}': ${cause}`, { sliceId, cause });
  }
}
```
**Run:** `npx vitest run --passWithNoTests`
**Expect:** PASS — no tests (abstract port + simple error class following established pattern)
**Commit:** `feat(S03/T03): add SliceTransitionPort and SliceTransitionError`
**AC:** AC1

---

## Wave 1 (depends on T03)

### T04: Write failing test for `WorkflowSliceTransitionAdapter`
**File:** `src/hexagons/slice/infrastructure/workflow-slice-transition.adapter.spec.ts`
**Code:**
```typescript
import { faker } from "@faker-js/faker";
import { SliceTransitionError } from "@hexagons/workflow/domain/errors/slice-transition.error";
import { isErr, isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { Slice } from "../domain/slice.aggregate";
import type { SliceStatus } from "../domain/slice.schemas";
import { InMemorySliceRepository } from "./in-memory-slice.repository";
import { WorkflowSliceTransitionAdapter } from "./workflow-slice-transition.adapter";

class StubDateProvider {
  private _now = new Date("2026-01-15T10:00:00Z");
  now(): Date {
    return this._now;
  }
}

function setup() {
  const sliceRepo = new InMemorySliceRepository();
  const dateProvider = new StubDateProvider();
  const adapter = new WorkflowSliceTransitionAdapter(sliceRepo, dateProvider);
  return { adapter, sliceRepo, dateProvider };
}

function seedSlice(
  repo: InMemorySliceRepository,
  overrides: { id?: string; status?: SliceStatus } = {},
): Slice {
  const slice = Slice.reconstitute({
    id: overrides.id ?? faker.string.uuid(),
    milestoneId: faker.string.uuid(),
    label: "M01-S01",
    title: "Test Slice",
    description: "",
    status: overrides.status ?? "discussing",
    complexity: null,
    specPath: null,
    planPath: null,
    researchPath: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  repo.seed(slice);
  return slice;
}

describe("WorkflowSliceTransitionAdapter", () => {
  it("transitions slice to target status", async () => {
    const { adapter, sliceRepo } = setup();
    const slice = seedSlice(sliceRepo, { status: "discussing" });

    const result = await adapter.transition(slice.id, "researching");

    expect(isOk(result)).toBe(true);
    const reloaded = await sliceRepo.findById(slice.id);
    if (isOk(reloaded) && reloaded.data) {
      expect(reloaded.data.status).toBe("researching");
    }
  });

  it("returns ok on idempotent transition (current == target)", async () => {
    const { adapter, sliceRepo } = setup();
    const slice = seedSlice(sliceRepo, { status: "executing" });

    const result = await adapter.transition(slice.id, "executing");

    expect(isOk(result)).toBe(true);
    const reloaded = await sliceRepo.findById(slice.id);
    if (isOk(reloaded) && reloaded.data) {
      expect(reloaded.data.status).toBe("executing");
    }
  });

  it("returns SliceTransitionError when slice not found", async () => {
    const { adapter } = setup();

    const result = await adapter.transition(faker.string.uuid(), "researching");

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(SliceTransitionError);
      expect(result.error.code).toBe("WORKFLOW.SLICE_TRANSITION_FAILED");
    }
  });

  it("returns SliceTransitionError on invalid transition", async () => {
    const { adapter, sliceRepo } = setup();
    const slice = seedSlice(sliceRepo, { status: "discussing" });

    const result = await adapter.transition(slice.id, "executing");

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(SliceTransitionError);
    }
  });
});
```
**Run:** `npx vitest run src/hexagons/slice/infrastructure/workflow-slice-transition.adapter.spec.ts`
**Expect:** FAIL — cannot find module `./workflow-slice-transition.adapter`
**AC:** AC2, AC8, AC9

---

### T05: Implement `WorkflowSliceTransitionAdapter`
**Depends on:** T04
**File:** `src/hexagons/slice/infrastructure/workflow-slice-transition.adapter.ts`
**Code:**
```typescript
import type { DateProviderPort } from "@kernel";
import { err, isErr, ok, type Result } from "@kernel";
import { SliceTransitionError } from "@hexagons/workflow/domain/errors/slice-transition.error";
import { SliceTransitionPort } from "@hexagons/workflow/domain/ports/slice-transition.port";
import type { SliceStatus } from "../domain/slice.schemas";
import type { SliceRepositoryPort } from "../domain/ports/slice-repository.port";

export class WorkflowSliceTransitionAdapter extends SliceTransitionPort {
  constructor(
    private readonly sliceRepo: SliceRepositoryPort,
    private readonly dateProvider: DateProviderPort,
  ) {
    super();
  }

  async transition(
    sliceId: string,
    targetStatus: SliceStatus,
  ): Promise<Result<void, SliceTransitionError>> {
    const findResult = await this.sliceRepo.findById(sliceId);
    if (isErr(findResult)) {
      return err(new SliceTransitionError(sliceId, findResult.error.message));
    }

    const slice = findResult.data;
    if (!slice) {
      return err(new SliceTransitionError(sliceId, `Slice '${sliceId}' not found`));
    }

    if (slice.status === targetStatus) {
      return ok(undefined);
    }

    const transitionResult = slice.transitionTo(targetStatus, this.dateProvider.now());
    if (!transitionResult.ok) {
      return err(new SliceTransitionError(sliceId, transitionResult.error.message));
    }

    const saveResult = await this.sliceRepo.save(slice);
    if (isErr(saveResult)) {
      return err(new SliceTransitionError(sliceId, saveResult.error.message));
    }

    return ok(undefined);
  }
}
```
**Run:** `npx vitest run src/hexagons/slice/infrastructure/workflow-slice-transition.adapter.spec.ts`
**Expect:** PASS — 4 tests passing
**Commit:** `feat(S03/T05): add WorkflowSliceTransitionAdapter`

---

## Wave 2 (depends on T02, T03, T05)

### T06: Write failing test for `OrchestratePhaseTransitionUseCase`
**File:** `src/hexagons/workflow/use-cases/orchestrate-phase-transition.use-case.spec.ts`
**Code:**
```typescript
import { faker } from "@faker-js/faker";
import { Slice } from "@hexagons/slice/domain/slice.aggregate";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { WorkflowSliceTransitionAdapter } from "@hexagons/slice/infrastructure/workflow-slice-transition.adapter";
import { InProcessEventBus, isErr, isOk, SilentLoggerAdapter } from "@kernel";
import { describe, expect, it } from "vitest";
import { WorkflowPhaseChangedEvent } from "../domain/events/workflow-phase-changed.event";
import { WorkflowSessionBuilder } from "../domain/workflow-session.builder";
import type { GuardContext } from "../domain/workflow-session.schemas";
import { InMemoryWorkflowSessionRepository } from "../infrastructure/in-memory-workflow-session.repository";
import { OrchestratePhaseTransitionUseCase } from "./orchestrate-phase-transition.use-case";

class StubDateProvider {
  private _now = new Date("2026-01-15T10:00:00Z");
  now(): Date {
    return this._now;
  }
}

const DEFAULT_GUARD_CTX: GuardContext = {
  complexityTier: "F-lite",
  retryCount: 0,
  maxRetries: 2,
  allSlicesClosed: false,
  lastError: null,
};

function setup() {
  const sessionRepo = new InMemoryWorkflowSessionRepository();
  const sliceRepo = new InMemorySliceRepository();
  const dateProvider = new StubDateProvider();
  const sliceTransitionPort = new WorkflowSliceTransitionAdapter(sliceRepo, dateProvider);
  const eventBus = new InProcessEventBus(new SilentLoggerAdapter());
  const useCase = new OrchestratePhaseTransitionUseCase(
    sessionRepo,
    sliceTransitionPort,
    eventBus,
    dateProvider,
  );
  return { useCase, sessionRepo, sliceRepo, sliceTransitionPort, eventBus, dateProvider };
}

function seedSlice(repo: InMemorySliceRepository, id: string, status: string): void {
  repo.seed(
    Slice.reconstitute({
      id,
      milestoneId: faker.string.uuid(),
      label: "M01-S01",
      title: "Test",
      description: "",
      status: status as "discussing",
      complexity: null,
      specPath: null,
      planPath: null,
      researchPath: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  );
}

describe("OrchestratePhaseTransitionUseCase", () => {
  it("triggers session and transitions slice on standard phase change", async () => {
    const { useCase, sessionRepo, sliceRepo } = setup();
    const sliceId = faker.string.uuid();
    const session = new WorkflowSessionBuilder()
      .withCurrentPhase("discussing")
      .withSliceId(sliceId)
      .build();
    sessionRepo.seed(session);
    seedSlice(sliceRepo, sliceId, "discussing");

    const result = await useCase.execute({
      milestoneId: session.milestoneId,
      trigger: "next",
      guardContext: { ...DEFAULT_GUARD_CTX, complexityTier: "F-lite" },
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.fromPhase).toBe("discussing");
      expect(result.data.toPhase).toBe("researching");
      expect(result.data.sliceTransitioned).toBe(true);
    }
    const reloaded = await sliceRepo.findById(sliceId);
    if (isOk(reloaded) && reloaded.data) {
      expect(reloaded.data.status).toBe("researching");
    }
  });

  it("transitions slice to closed on shipping + next -> idle", async () => {
    const { useCase, sessionRepo, sliceRepo } = setup();
    const sliceId = faker.string.uuid();
    const session = new WorkflowSessionBuilder()
      .withCurrentPhase("shipping")
      .withSliceId(sliceId)
      .build();
    sessionRepo.seed(session);
    seedSlice(sliceRepo, sliceId, "completing");

    const result = await useCase.execute({
      milestoneId: session.milestoneId,
      trigger: "next",
      guardContext: DEFAULT_GUARD_CTX,
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.toPhase).toBe("idle");
      expect(result.data.sliceTransitioned).toBe(true);
    }
    const reloaded = await sliceRepo.findById(sliceId);
    if (isOk(reloaded) && reloaded.data) {
      expect(reloaded.data.status).toBe("closed");
    }
  });

  it("does NOT transition slice on blocked + abort -> idle", async () => {
    const { useCase, sessionRepo, sliceRepo } = setup();
    const sliceId = faker.string.uuid();
    const session = new WorkflowSessionBuilder()
      .withCurrentPhase("blocked")
      .withSliceId(sliceId)
      .build();
    sessionRepo.seed(session);
    seedSlice(sliceRepo, sliceId, "executing");

    const result = await useCase.execute({
      milestoneId: session.milestoneId,
      trigger: "abort",
      guardContext: DEFAULT_GUARD_CTX,
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.toPhase).toBe("idle");
      expect(result.data.sliceTransitioned).toBe(false);
    }
    const reloaded = await sliceRepo.findById(sliceId);
    if (isOk(reloaded) && reloaded.data) {
      expect(reloaded.data.status).toBe("executing");
    }
  });

  it("publishes WorkflowPhaseChangedEvent", async () => {
    const { useCase, sessionRepo, sliceRepo, eventBus } = setup();
    const sliceId = faker.string.uuid();
    const session = new WorkflowSessionBuilder()
      .withCurrentPhase("discussing")
      .withSliceId(sliceId)
      .build();
    sessionRepo.seed(session);
    seedSlice(sliceRepo, sliceId, "discussing");

    const published: WorkflowPhaseChangedEvent[] = [];
    eventBus.subscribe("WORKFLOW_PHASE_CHANGED", async (e) => {
      published.push(e as WorkflowPhaseChangedEvent);
    });

    await useCase.execute({
      milestoneId: session.milestoneId,
      trigger: "next",
      guardContext: { ...DEFAULT_GUARD_CTX, complexityTier: "F-lite" },
    });

    expect(published).toHaveLength(1);
    expect(published[0].fromPhase).toBe("discussing");
    expect(published[0].toPhase).toBe("researching");
  });

  it("skips slice transition when no sliceId assigned", async () => {
    const { useCase, sessionRepo } = setup();
    const session = new WorkflowSessionBuilder().withCurrentPhase("idle").build();
    sessionRepo.seed(session);

    const result = await useCase.execute({
      milestoneId: session.milestoneId,
      trigger: "start",
      guardContext: DEFAULT_GUARD_CTX,
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.toPhase).toBe("discussing");
      expect(result.data.sliceTransitioned).toBe(false);
    }
  });

  it("returns error when session not found", async () => {
    const { useCase } = setup();

    const result = await useCase.execute({
      milestoneId: faker.string.uuid(),
      trigger: "next",
      guardContext: DEFAULT_GUARD_CTX,
    });

    expect(isErr(result)).toBe(true);
  });
});
```
**Run:** `npx vitest run src/hexagons/workflow/use-cases/orchestrate-phase-transition.use-case.spec.ts`
**Expect:** FAIL — cannot find module `./orchestrate-phase-transition.use-case`
**AC:** AC4, AC5, AC6, AC7, AC8

---

### T07: Implement `OrchestratePhaseTransitionUseCase`
**Depends on:** T06
**File:** `src/hexagons/workflow/use-cases/orchestrate-phase-transition.use-case.ts`
**Code:**
```typescript
import type { DateProviderPort, EventBusPort, PersistenceError, Result } from "@kernel";
import { err, isErr, ok } from "@kernel";
import { mapPhaseToSliceStatus } from "../domain/phase-status-mapping";
import type { SliceTransitionError } from "../domain/errors/slice-transition.error";
import { SliceTransitionPort } from "../domain/ports/slice-transition.port";
import { WorkflowBaseError } from "../domain/errors/workflow-base.error";
import { WorkflowSessionRepositoryPort } from "../domain/ports/workflow-session.repository.port";
import type { GuardContext, WorkflowPhase, WorkflowTrigger } from "../domain/workflow-session.schemas";

export interface PhaseTransitionInput {
  milestoneId: string;
  trigger: WorkflowTrigger;
  guardContext: GuardContext;
}

export interface PhaseTransitionResult {
  fromPhase: WorkflowPhase;
  toPhase: WorkflowPhase;
  sliceTransitioned: boolean;
}

export class WorkflowSessionNotFoundError extends WorkflowBaseError {
  readonly code = "WORKFLOW.SESSION_NOT_FOUND";

  constructor(milestoneId: string) {
    super(`No workflow session found for milestone '${milestoneId}'`, { milestoneId });
  }
}

type OrchestrationError =
  | WorkflowBaseError
  | SliceTransitionError
  | PersistenceError
  | WorkflowSessionNotFoundError;

export class OrchestratePhaseTransitionUseCase {
  constructor(
    private readonly sessionRepo: WorkflowSessionRepositoryPort,
    private readonly sliceTransitionPort: SliceTransitionPort,
    private readonly eventBus: EventBusPort,
    private readonly dateProvider: DateProviderPort,
  ) {}

  async execute(
    input: PhaseTransitionInput,
  ): Promise<Result<PhaseTransitionResult, OrchestrationError>> {
    const now = this.dateProvider.now();

    // 1. Load session
    const findResult = await this.sessionRepo.findByMilestoneId(input.milestoneId);
    if (isErr(findResult)) return findResult;
    if (!findResult.data) {
      return err(new WorkflowSessionNotFoundError(input.milestoneId));
    }

    const session = findResult.data;
    const fromPhase = session.currentPhase;
    const capturedSliceId = session.sliceId;

    // 2. Trigger transition
    const triggerResult = session.trigger(input.trigger, input.guardContext, now);
    if (isErr(triggerResult)) return triggerResult;

    // 3. Detect slice effects
    const sliceCleared = capturedSliceId !== undefined && session.sliceId === undefined;
    let sliceTransitioned = false;

    if (sliceCleared && session.currentPhase === "idle" && fromPhase === "shipping") {
      // shipping + next -> idle: close the slice
      const transitionResult = await this.sliceTransitionPort.transition(
        capturedSliceId,
        "closed",
      );
      if (isErr(transitionResult)) return transitionResult;
      sliceTransitioned = true;
    } else if (sliceCleared) {
      // abort or other clearSlice: do NOT transition slice
      sliceTransitioned = false;
    } else if (capturedSliceId) {
      const mappedStatus = mapPhaseToSliceStatus(session.currentPhase);
      if (mappedStatus) {
        const transitionResult = await this.sliceTransitionPort.transition(
          capturedSliceId,
          mappedStatus,
        );
        if (isErr(transitionResult)) return transitionResult;
        sliceTransitioned = true;
      }
    }

    // 4. Save session
    const saveResult = await this.sessionRepo.save(session);
    if (isErr(saveResult)) return saveResult;

    // 5. Publish domain events
    const events = session.pullEvents();
    for (const event of events) {
      await this.eventBus.publish(event);
    }

    return ok({
      fromPhase,
      toPhase: session.currentPhase,
      sliceTransitioned,
    });
  }
}
```
**Run:** `npx vitest run src/hexagons/workflow/use-cases/orchestrate-phase-transition.use-case.spec.ts`
**Expect:** PASS — 6 tests passing
**Commit:** `feat(S03/T07): add OrchestratePhaseTransitionUseCase`

---

## Wave 3 (depends on Wave 2)

### T08: Update barrel exports — workflow hexagon
**File:** `src/hexagons/workflow/index.ts`
**Modify:** Insert `SliceTransitionError` export after line 9 (after `WorkflowBaseError` export):
```typescript
export { SliceTransitionError } from "./domain/errors/slice-transition.error";
```
Insert `mapPhaseToSliceStatus` export after the `WorkflowPhaseChangedEvent` export (line 16):
```typescript
export { mapPhaseToSliceStatus } from "./domain/phase-status-mapping";
```
Insert `SliceTransitionPort` export after the `WorkflowSessionRepositoryPort` export (line 19):
```typescript
export { SliceTransitionPort } from "./domain/ports/slice-transition.port";
```
Append to the `// Use Cases` section (after line 68):
```typescript
export type { PhaseTransitionInput, PhaseTransitionResult } from "./use-cases/orchestrate-phase-transition.use-case";
export { OrchestratePhaseTransitionUseCase, WorkflowSessionNotFoundError } from "./use-cases/orchestrate-phase-transition.use-case";
```
**Run:** `npx vitest run src/hexagons/workflow/`
**Expect:** PASS — all workflow tests passing
**AC:** AC10

---

### T09: Update barrel exports — slice hexagon
**File:** `src/hexagons/slice/index.ts`
**Modify:** Append after line 21 (after `SliceStatusSchema` export):
```typescript
export { WorkflowSliceTransitionAdapter } from "./infrastructure/workflow-slice-transition.adapter";
```
**Run:** `npx vitest run src/hexagons/slice/`
**Expect:** PASS — all slice tests passing
**AC:** AC10

---

### T10: Update `WorkflowExtensionDeps`
**File:** `src/hexagons/workflow/infrastructure/pi/workflow.extension.ts`
**Modify:** Add imports at the top:
```typescript
import type { DateProviderPort, EventBusPort } from "@kernel";
```
Add import for port:
```typescript
import type { SliceTransitionPort } from "../../domain/ports/slice-transition.port";
```
Extend `WorkflowExtensionDeps` interface — add three fields after `taskRepo`:
```typescript
  sliceTransitionPort: SliceTransitionPort;
  eventBus: EventBusPort;
  dateProvider: DateProviderPort;
```
**Run:** `npx vitest run src/hexagons/workflow/`
**Expect:** PASS — all tests passing
**Commit:** `feat(S03/T10): update barrel exports and WorkflowExtensionDeps`

---

### T11: Run full test suite
**Run:** `npx vitest run`
**Expect:** PASS — all tests passing, no regressions
**AC:** AC1-AC10

---

## Dependency Graph

```
T01 -> T02 ──────────────────────────> T08
T03 ──────> T04 -> T05 ──> T06 -> T07 -> T08, T09, T10 -> T11
```

## Wave Summary

| Wave | Tasks | Parallelizable | Description |
|---|---|---|---|
| 0 | T01, T02, T03 | T01/T03 parallel; T02 after T01 | Pure function (TDD pair) + port + error |
| 1 | T04, T05 | T04 first, then T05 | Adapter (TDD pair) |
| 2 | T06, T07 | T06 first, then T07 | Use case (TDD pair) |
| 3 | T08, T09, T10, T11 | T08/T09/T10 parallel; T11 after all | Barrel exports + deps + verification |
