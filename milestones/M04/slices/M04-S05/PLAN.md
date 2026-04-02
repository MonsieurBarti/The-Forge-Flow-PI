# S05: Cost Tracking — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Persistent cost tracking with event-driven capture, JSONL storage, and per-slice/milestone aggregation.
**Architecture:** New event (`TaskExecutionCompletedEvent`) → subscriber (`RecordTaskMetricsUseCase`) → JSONL persistence. Query via `AggregateMetricsUseCase`. Cross-hexagon `MetricsQueryPort` for Intelligence.
**Tech Stack:** Zod schemas, domain events, JSONL file I/O, in-memory aggregation.

## File Structure

### Create (17 files)
| File | Responsibility |
|---|---|
| `src/hexagons/execution/domain/task-metrics.schemas.ts` | `TaskMetricsSchema`, `AggregatedMetricsSchema`, `ModelBreakdownEntrySchema` |
| `src/hexagons/execution/domain/task-metrics.schemas.spec.ts` | Schema validation tests |
| `src/hexagons/execution/domain/task-metrics.builder.ts` | Faker-based `TaskMetricsBuilder` |
| `src/hexagons/execution/domain/task-metrics.builder.spec.ts` | Builder tests |
| `src/hexagons/execution/domain/events/task-execution-completed.event.ts` | Domain event with `AgentResult` payload |
| `src/hexagons/execution/domain/events/task-execution-completed.event.spec.ts` | Event construction + validation tests |
| `src/hexagons/execution/domain/ports/metrics-repository.port.ts` | `MetricsRepositoryPort` (append + read) |
| `src/hexagons/execution/domain/ports/metrics-query.port.ts` | `MetricsQueryPort` (cross-hexagon, read-only) |
| `src/hexagons/execution/infrastructure/in-memory-metrics.repository.ts` | `InMemoryMetricsRepository` |
| `src/hexagons/execution/infrastructure/in-memory-metrics.repository.spec.ts` | Calls shared contract tests |
| `src/hexagons/execution/infrastructure/metrics-repository.contract.spec.ts` | Shared `runMetricsContractTests()` |
| `src/hexagons/execution/infrastructure/jsonl-metrics.repository.ts` | `JsonlMetricsRepository` |
| `src/hexagons/execution/infrastructure/jsonl-metrics.repository.spec.ts` | Contract + JSONL-specific tests |
| `src/hexagons/execution/application/record-task-metrics.use-case.ts` | Event subscriber → persist |
| `src/hexagons/execution/application/record-task-metrics.use-case.spec.ts` | Use case tests |
| `src/hexagons/execution/application/aggregate-metrics.use-case.ts` | Query + in-memory aggregation |
| `src/hexagons/execution/application/aggregate-metrics.use-case.spec.ts` | Use case tests |

### Modify (3 files)
| File | Change |
|---|---|
| `src/kernel/event-names.ts` | Add `TASK_EXECUTION_COMPLETED` constant + `EventNameSchema` entry |
| `src/kernel/event-names.spec.ts` | Update count 14 → 15 |
| `src/hexagons/execution/index.ts` | Add barrel exports for all new types |

---

## Wave 0 (parallel — no dependencies)

### T01: Add TASK_EXECUTION_COMPLETED to kernel EVENT_NAMES
**Files:** Modify `src/kernel/event-names.ts`, Modify `src/kernel/event-names.spec.ts`
**Traces to:** AC8

- [ ] Step 1: Update test — change `toHaveLength(14)` to `toHaveLength(15)` in `event-names.spec.ts`
```typescript
// src/kernel/event-names.spec.ts line 7
// Change:
expect(Object.keys(EVENT_NAMES)).toHaveLength(14);
// To:
expect(Object.keys(EVENT_NAMES)).toHaveLength(15);
```
- [ ] Step 2: Run `npx vitest run src/kernel/event-names.spec.ts` — expect FAIL (still 14)
- [ ] Step 3: Add constant to `event-names.ts`:
```typescript
// src/kernel/event-names.ts — add after CHECKPOINT_SAVED line:
  TASK_EXECUTION_COMPLETED: "execution.task-execution-completed",

// Add to EventNameSchema z.enum array:
  EVENT_NAMES.TASK_EXECUTION_COMPLETED,
```
- [ ] Step 4: Run `npx vitest run src/kernel/event-names.spec.ts` — expect PASS (15 events, all unique, format valid)
- [ ] Step 5: `git add src/kernel/event-names.ts src/kernel/event-names.spec.ts && git commit -m "feat(S05/T01): add TASK_EXECUTION_COMPLETED event name"`

---

### T02: TaskMetricsSchema + AggregatedMetricsSchema
**Files:** Create `src/hexagons/execution/domain/task-metrics.schemas.ts`, Create `src/hexagons/execution/domain/task-metrics.schemas.spec.ts`
**Traces to:** AC2 (schema foundation), AC4, AC5 (aggregation types)

- [ ] Step 1: Write schema spec `task-metrics.schemas.spec.ts`:
```typescript
import { describe, expect, it } from "vitest";
import {
  AggregatedMetricsSchema,
  ModelBreakdownEntrySchema,
  TaskMetricsModelSchema,
  TaskMetricsSchema,
} from "./task-metrics.schemas";

describe("TaskMetricsModelSchema", () => {
  const valid = { provider: "anthropic", modelId: "claude-sonnet-4-6", profile: "balanced" };
  it("parses valid model", () => {
    expect(TaskMetricsModelSchema.parse(valid)).toEqual(valid);
  });
  it("rejects empty provider", () => {
    expect(() => TaskMetricsModelSchema.parse({ ...valid, provider: "" })).toThrow();
  });
  it("rejects invalid profile", () => {
    expect(() => TaskMetricsModelSchema.parse({ ...valid, profile: "premium" })).toThrow();
  });
});

describe("TaskMetricsSchema", () => {
  const valid = {
    taskId: crypto.randomUUID(),
    sliceId: crypto.randomUUID(),
    milestoneId: crypto.randomUUID(),
    model: { provider: "anthropic", modelId: "claude-sonnet-4-6", profile: "balanced" },
    tokens: { input: 1000, output: 500 },
    costUsd: 0.05,
    durationMs: 30000,
    success: true,
    timestamp: new Date(),
  };

  it("parses valid entry", () => {
    const result = TaskMetricsSchema.parse(valid);
    expect(result.taskId).toBe(valid.taskId);
    expect(result.retries).toBe(0);
    expect(result.downshifted).toBe(false);
    expect(result.reflectionPassed).toBeUndefined();
  });

  it("defaults retries to 0", () => {
    expect(TaskMetricsSchema.parse(valid).retries).toBe(0);
  });

  it("defaults downshifted to false", () => {
    expect(TaskMetricsSchema.parse(valid).downshifted).toBe(false);
  });

  it("accepts explicit retries and downshifted", () => {
    const result = TaskMetricsSchema.parse({ ...valid, retries: 2, downshifted: true });
    expect(result.retries).toBe(2);
    expect(result.downshifted).toBe(true);
  });

  it("accepts optional reflectionPassed", () => {
    const result = TaskMetricsSchema.parse({ ...valid, reflectionPassed: true });
    expect(result.reflectionPassed).toBe(true);
  });

  it("rejects negative costUsd", () => {
    expect(() => TaskMetricsSchema.parse({ ...valid, costUsd: -1 })).toThrow();
  });

  it("rejects negative tokens", () => {
    expect(() => TaskMetricsSchema.parse({ ...valid, tokens: { input: -1, output: 0 } })).toThrow();
  });

  it("rejects non-integer tokens", () => {
    expect(() => TaskMetricsSchema.parse({ ...valid, tokens: { input: 1.5, output: 0 } })).toThrow();
  });

  it("rejects non-uuid taskId", () => {
    expect(() => TaskMetricsSchema.parse({ ...valid, taskId: "not-uuid" })).toThrow();
  });
});

describe("ModelBreakdownEntrySchema", () => {
  it("parses valid entry", () => {
    const result = ModelBreakdownEntrySchema.parse({ modelId: "claude-sonnet-4-6", taskCount: 3, totalCostUsd: 0.15 });
    expect(result.taskCount).toBe(3);
  });
});

describe("AggregatedMetricsSchema", () => {
  const valid = {
    groupKey: { sliceId: crypto.randomUUID() },
    totalCostUsd: 1.5,
    totalInputTokens: 10000,
    totalOutputTokens: 5000,
    totalDurationMs: 300000,
    taskCount: 5,
    successCount: 4,
    failureCount: 1,
    averageCostPerTask: 0.3,
    modelBreakdown: [{ modelId: "claude-sonnet-4-6", taskCount: 5, totalCostUsd: 1.5 }],
  };

  it("parses valid aggregation", () => {
    const result = AggregatedMetricsSchema.parse(valid);
    expect(result.taskCount).toBe(5);
  });

  it("accepts empty groupKey", () => {
    const result = AggregatedMetricsSchema.parse({ ...valid, groupKey: {} });
    expect(result.groupKey.sliceId).toBeUndefined();
  });

  it("accepts milestoneId groupKey", () => {
    const result = AggregatedMetricsSchema.parse({ ...valid, groupKey: { milestoneId: crypto.randomUUID() } });
    expect(result.groupKey.milestoneId).toBeDefined();
  });
});
```
- [ ] Step 2: Run `npx vitest run src/hexagons/execution/domain/task-metrics.schemas.spec.ts` — expect FAIL (module not found)
- [ ] Step 3: Implement `task-metrics.schemas.ts`:
```typescript
import { IdSchema, ModelProfileNameSchema, TimestampSchema } from "@kernel";
import { z } from "zod";

export const TaskMetricsModelSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
  profile: ModelProfileNameSchema,
});
export type TaskMetricsModel = z.infer<typeof TaskMetricsModelSchema>;

export const TaskMetricsSchema = z.object({
  taskId: IdSchema,
  sliceId: IdSchema,
  milestoneId: IdSchema,
  model: TaskMetricsModelSchema,
  tokens: z.object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
  }),
  costUsd: z.number().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  success: z.boolean(),
  retries: z.number().int().nonnegative().default(0),
  downshifted: z.boolean().default(false),
  reflectionPassed: z.boolean().optional(),
  timestamp: TimestampSchema,
});
export type TaskMetrics = z.infer<typeof TaskMetricsSchema>;

export const ModelBreakdownEntrySchema = z.object({
  modelId: z.string(),
  taskCount: z.number().int().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
});
export type ModelBreakdownEntry = z.infer<typeof ModelBreakdownEntrySchema>;

export const AggregatedMetricsSchema = z.object({
  groupKey: z.object({
    sliceId: IdSchema.optional(),
    milestoneId: IdSchema.optional(),
  }),
  totalCostUsd: z.number().nonnegative(),
  totalInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  totalDurationMs: z.number().int().nonnegative(),
  taskCount: z.number().int().nonnegative(),
  successCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  averageCostPerTask: z.number().nonnegative(),
  modelBreakdown: z.array(ModelBreakdownEntrySchema),
});
export type AggregatedMetrics = z.infer<typeof AggregatedMetricsSchema>;
```
- [ ] Step 4: Run `npx vitest run src/hexagons/execution/domain/task-metrics.schemas.spec.ts` — expect PASS
- [ ] Step 5: `git add src/hexagons/execution/domain/task-metrics.schemas.ts src/hexagons/execution/domain/task-metrics.schemas.spec.ts && git commit -m "feat(S05/T02): add TaskMetrics and AggregatedMetrics schemas"`

---

## Wave 1 (depends on Wave 0)

### T03: TaskMetricsBuilder
**Files:** Create `src/hexagons/execution/domain/task-metrics.builder.ts`, Create `src/hexagons/execution/domain/task-metrics.builder.spec.ts`
**Depends on:** T02
**Traces to:** AC2 (builder used in all downstream tests)

- [ ] Step 1: Write builder spec:
```typescript
import { describe, expect, it } from "vitest";
import { TaskMetricsSchema } from "./task-metrics.schemas";
import { TaskMetricsBuilder } from "./task-metrics.builder";

describe("TaskMetricsBuilder", () => {
  it("builds valid TaskMetrics with defaults", () => {
    const metrics = new TaskMetricsBuilder().build();
    expect(TaskMetricsSchema.safeParse(metrics).success).toBe(true);
  });

  it("applies withSliceId override", () => {
    const sliceId = crypto.randomUUID();
    const metrics = new TaskMetricsBuilder().withSliceId(sliceId).build();
    expect(metrics.sliceId).toBe(sliceId);
  });

  it("applies withCostUsd override", () => {
    const metrics = new TaskMetricsBuilder().withCostUsd(1.23).build();
    expect(metrics.costUsd).toBe(1.23);
  });

  it("applies withSuccess override", () => {
    const metrics = new TaskMetricsBuilder().withSuccess(false).build();
    expect(metrics.success).toBe(false);
  });

  it("applies withModelId override", () => {
    const metrics = new TaskMetricsBuilder().withModelId("claude-opus-4-6").build();
    expect(metrics.model.modelId).toBe("claude-opus-4-6");
  });

  it("applies withMilestoneId override", () => {
    const id = crypto.randomUUID();
    const metrics = new TaskMetricsBuilder().withMilestoneId(id).build();
    expect(metrics.milestoneId).toBe(id);
  });
});
```
- [ ] Step 2: Run `npx vitest run src/hexagons/execution/domain/task-metrics.builder.spec.ts` — expect FAIL
- [ ] Step 3: Implement `task-metrics.builder.ts`:
```typescript
import { faker } from "@faker-js/faker";
import type { ModelProfileName } from "@kernel";
import type { TaskMetrics } from "./task-metrics.schemas";
import { TaskMetricsSchema } from "./task-metrics.schemas";

export class TaskMetricsBuilder {
  private _taskId: string = faker.string.uuid();
  private _sliceId: string = faker.string.uuid();
  private _milestoneId: string = faker.string.uuid();
  private _provider = "anthropic";
  private _modelId = "claude-sonnet-4-6";
  private _profile: ModelProfileName = "balanced";
  private _inputTokens: number = faker.number.int({ min: 100, max: 10000 });
  private _outputTokens: number = faker.number.int({ min: 50, max: 5000 });
  private _costUsd: number = Number.parseFloat(faker.finance.amount({ min: 0.001, max: 1, dec: 4 }));
  private _durationMs: number = faker.number.int({ min: 1000, max: 120000 });
  private _success = true;
  private _retries = 0;
  private _downshifted = false;
  private _reflectionPassed?: boolean;
  private _timestamp: Date = faker.date.recent();

  withTaskId(id: string): this { this._taskId = id; return this; }
  withSliceId(id: string): this { this._sliceId = id; return this; }
  withMilestoneId(id: string): this { this._milestoneId = id; return this; }
  withProvider(p: string): this { this._provider = p; return this; }
  withModelId(id: string): this { this._modelId = id; return this; }
  withProfile(p: ModelProfileName): this { this._profile = p; return this; }
  withInputTokens(n: number): this { this._inputTokens = n; return this; }
  withOutputTokens(n: number): this { this._outputTokens = n; return this; }
  withCostUsd(c: number): this { this._costUsd = c; return this; }
  withDurationMs(ms: number): this { this._durationMs = ms; return this; }
  withSuccess(s: boolean): this { this._success = s; return this; }
  withRetries(r: number): this { this._retries = r; return this; }
  withDownshifted(d: boolean): this { this._downshifted = d; return this; }
  withReflectionPassed(r: boolean): this { this._reflectionPassed = r; return this; }
  withTimestamp(t: Date): this { this._timestamp = t; return this; }

  build(): TaskMetrics {
    return TaskMetricsSchema.parse({
      taskId: this._taskId,
      sliceId: this._sliceId,
      milestoneId: this._milestoneId,
      model: { provider: this._provider, modelId: this._modelId, profile: this._profile },
      tokens: { input: this._inputTokens, output: this._outputTokens },
      costUsd: this._costUsd,
      durationMs: this._durationMs,
      success: this._success,
      retries: this._retries,
      downshifted: this._downshifted,
      reflectionPassed: this._reflectionPassed,
      timestamp: this._timestamp,
    });
  }
}
```
- [ ] Step 4: Run `npx vitest run src/hexagons/execution/domain/task-metrics.builder.spec.ts` — expect PASS
- [ ] Step 5: `git add src/hexagons/execution/domain/task-metrics.builder.ts src/hexagons/execution/domain/task-metrics.builder.spec.ts && git commit -m "feat(S05/T03): add TaskMetricsBuilder"`

---

### T04: MetricsRepositoryPort + MetricsQueryPort
**Files:** Create `src/hexagons/execution/domain/ports/metrics-repository.port.ts`, Create `src/hexagons/execution/domain/ports/metrics-query.port.ts`
**Depends on:** T02
**Traces to:** AC7 (MetricsQueryPort exported)

- [ ] Step 1: No test needed — abstract classes with no logic. Create `metrics-repository.port.ts`:
```typescript
import type { PersistenceError, Result } from "@kernel";
import type { TaskMetrics } from "../task-metrics.schemas";

export abstract class MetricsRepositoryPort {
  abstract append(entry: TaskMetrics): Promise<Result<void, PersistenceError>>;
  abstract readBySlice(sliceId: string): Promise<Result<TaskMetrics[], PersistenceError>>;
  abstract readByMilestone(milestoneId: string): Promise<Result<TaskMetrics[], PersistenceError>>;
  abstract readAll(): Promise<Result<TaskMetrics[], PersistenceError>>;
}
```
- [ ] Step 2: Create `metrics-query.port.ts`:
```typescript
import type { PersistenceError, Result } from "@kernel";
import type { AggregatedMetrics } from "../task-metrics.schemas";

export abstract class MetricsQueryPort {
  abstract aggregateBySlice(sliceId: string): Promise<Result<AggregatedMetrics, PersistenceError>>;
  abstract aggregateByMilestone(milestoneId: string): Promise<Result<AggregatedMetrics, PersistenceError>>;
}
```
- [ ] Step 3: `git add src/hexagons/execution/domain/ports/metrics-repository.port.ts src/hexagons/execution/domain/ports/metrics-query.port.ts && git commit -m "feat(S05/T04): add MetricsRepositoryPort and MetricsQueryPort"`

---

### T05: TaskExecutionCompletedEvent
**Files:** Create `src/hexagons/execution/domain/events/task-execution-completed.event.ts`, Create `src/hexagons/execution/domain/events/task-execution-completed.event.spec.ts`
**Depends on:** T01
**Traces to:** AC1

- [ ] Step 1: Write event spec:
```typescript
import { AgentResultBuilder } from "@kernel/agents";
import { describe, expect, it } from "vitest";
import { TaskExecutionCompletedEvent } from "./task-execution-completed.event";

describe("TaskExecutionCompletedEvent", () => {
  const agentResult = new AgentResultBuilder().build();

  function validProps() {
    return {
      id: crypto.randomUUID(),
      aggregateId: crypto.randomUUID(),
      occurredAt: new Date(),
      taskId: agentResult.taskId,
      sliceId: crypto.randomUUID(),
      milestoneId: crypto.randomUUID(),
      waveIndex: 0,
      modelProfile: "balanced" as const,
      agentResult,
    };
  }

  it("constructs with valid props", () => {
    const event = new TaskExecutionCompletedEvent(validProps());
    expect(event.eventName).toBe("execution.task-execution-completed");
    expect(event.taskId).toBe(agentResult.taskId);
    expect(event.agentResult.cost.costUsd).toBe(agentResult.cost.costUsd);
  });

  it("exposes all fields from props", () => {
    const props = validProps();
    const event = new TaskExecutionCompletedEvent(props);
    expect(event.sliceId).toBe(props.sliceId);
    expect(event.milestoneId).toBe(props.milestoneId);
    expect(event.waveIndex).toBe(0);
    expect(event.modelProfile).toBe("balanced");
  });

  it("carries full AgentResult including cost", () => {
    const event = new TaskExecutionCompletedEvent(validProps());
    expect(event.agentResult.cost.inputTokens).toBe(agentResult.cost.inputTokens);
    expect(event.agentResult.cost.outputTokens).toBe(agentResult.cost.outputTokens);
    expect(event.agentResult.cost.costUsd).toBe(agentResult.cost.costUsd);
    expect(event.agentResult.success).toBe(agentResult.success);
  });

  it("rejects invalid waveIndex", () => {
    expect(() => new TaskExecutionCompletedEvent({ ...validProps(), waveIndex: -1 })).toThrow();
  });

  it("rejects invalid modelProfile", () => {
    expect(() => new TaskExecutionCompletedEvent({ ...validProps(), modelProfile: "premium" as "balanced" })).toThrow();
  });
});
```
- [ ] Step 2: Run `npx vitest run src/hexagons/execution/domain/events/task-execution-completed.event.spec.ts` — expect FAIL
- [ ] Step 3: Implement `task-execution-completed.event.ts`:
```typescript
import { AgentResultSchema, type AgentResult } from "@kernel/agents";
import {
  DomainEvent,
  DomainEventPropsSchema,
  EVENT_NAMES,
  type EventName,
  IdSchema,
  ModelProfileNameSchema,
  type ModelProfileName,
} from "@kernel";
import { z } from "zod";

const TaskExecutionCompletedEventPropsSchema = DomainEventPropsSchema.extend({
  taskId: IdSchema,
  sliceId: IdSchema,
  milestoneId: IdSchema,
  waveIndex: z.number().int().min(0),
  modelProfile: ModelProfileNameSchema,
  agentResult: AgentResultSchema,
});

type TaskExecutionCompletedEventProps = z.infer<typeof TaskExecutionCompletedEventPropsSchema>;

export class TaskExecutionCompletedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.TASK_EXECUTION_COMPLETED;
  readonly taskId: string;
  readonly sliceId: string;
  readonly milestoneId: string;
  readonly waveIndex: number;
  readonly modelProfile: ModelProfileName;
  readonly agentResult: AgentResult;

  constructor(props: TaskExecutionCompletedEventProps) {
    const parsed = TaskExecutionCompletedEventPropsSchema.parse(props);
    super(parsed);
    this.taskId = parsed.taskId;
    this.sliceId = parsed.sliceId;
    this.milestoneId = parsed.milestoneId;
    this.waveIndex = parsed.waveIndex;
    this.modelProfile = parsed.modelProfile;
    this.agentResult = parsed.agentResult;
  }
}
```
- [ ] Step 4: Run `npx vitest run src/hexagons/execution/domain/events/task-execution-completed.event.spec.ts` — expect PASS
- [ ] Step 5: `git add src/hexagons/execution/domain/events/task-execution-completed.event.ts src/hexagons/execution/domain/events/task-execution-completed.event.spec.ts && git commit -m "feat(S05/T05): add TaskExecutionCompletedEvent"`

---

## Wave 2 (depends on Wave 1)

### T06: InMemoryMetricsRepository + contract tests
**Files:** Create `src/hexagons/execution/infrastructure/in-memory-metrics.repository.ts`, Create `src/hexagons/execution/infrastructure/metrics-repository.contract.spec.ts`, Create `src/hexagons/execution/infrastructure/in-memory-metrics.repository.spec.ts`
**Depends on:** T03, T04
**Traces to:** AC6

- [ ] Step 1: Write contract spec `metrics-repository.contract.spec.ts`:
```typescript
import { isOk } from "@kernel";
import { beforeEach, describe, expect, it } from "vitest";
import { TaskMetricsBuilder } from "../domain/task-metrics.builder";
import type { MetricsRepositoryPort } from "../domain/ports/metrics-repository.port";

export function runMetricsContractTests(
  name: string,
  factory: () => MetricsRepositoryPort & { reset(): void },
) {
  describe(`${name} contract`, () => {
    let repo: MetricsRepositoryPort & { reset(): void };
    const sliceId = crypto.randomUUID();
    const milestoneId = crypto.randomUUID();
    const builder = new TaskMetricsBuilder().withSliceId(sliceId).withMilestoneId(milestoneId);

    beforeEach(() => {
      repo = factory();
      repo.reset();
    });

    it("append + readAll round-trips (AC3)", async () => {
      const entry = builder.build();
      const appendResult = await repo.append(entry);
      expect(isOk(appendResult)).toBe(true);

      const result = await repo.readAll();
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].taskId).toBe(entry.taskId);
      }
    });

    it("readBySlice filters correctly", async () => {
      const entry1 = builder.build();
      const otherSliceId = crypto.randomUUID();
      const entry2 = new TaskMetricsBuilder().withSliceId(otherSliceId).build();
      await repo.append(entry1);
      await repo.append(entry2);

      const result = await repo.readBySlice(sliceId);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].sliceId).toBe(sliceId);
      }
    });

    it("readByMilestone filters correctly", async () => {
      const entry1 = builder.build();
      const otherMilestoneId = crypto.randomUUID();
      const entry2 = new TaskMetricsBuilder().withMilestoneId(otherMilestoneId).build();
      await repo.append(entry1);
      await repo.append(entry2);

      const result = await repo.readByMilestone(milestoneId);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].milestoneId).toBe(milestoneId);
      }
    });

    it("readAll returns empty for no entries", async () => {
      const result = await repo.readAll();
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.data).toHaveLength(0);
    });

    it("readBySlice returns empty for unknown slice", async () => {
      const result = await repo.readBySlice(crypto.randomUUID());
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.data).toHaveLength(0);
    });

    it("preserves all fields through round-trip", async () => {
      const entry = new TaskMetricsBuilder()
        .withRetries(2)
        .withDownshifted(true)
        .withReflectionPassed(false)
        .build();
      await repo.append(entry);

      const result = await repo.readAll();
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data[0].retries).toBe(2);
        expect(result.data[0].downshifted).toBe(true);
        expect(result.data[0].reflectionPassed).toBe(false);
      }
    });
  });
}
```
- [ ] Step 2: Write in-memory adapter spec `in-memory-metrics.repository.spec.ts`:
```typescript
import { InMemoryMetricsRepository } from "./in-memory-metrics.repository";
import { runMetricsContractTests } from "./metrics-repository.contract.spec";

runMetricsContractTests(
  "InMemoryMetricsRepository",
  () => new InMemoryMetricsRepository(),
);
```
- [ ] Step 3: Run `npx vitest run src/hexagons/execution/infrastructure/in-memory-metrics.repository.spec.ts` — expect FAIL
- [ ] Step 4: Implement `in-memory-metrics.repository.ts`:
```typescript
import { ok, type Result } from "@kernel";
import type { PersistenceError } from "@kernel";
import type { TaskMetrics } from "../domain/task-metrics.schemas";
import { MetricsRepositoryPort } from "../domain/ports/metrics-repository.port";

export class InMemoryMetricsRepository extends MetricsRepositoryPort {
  private store: TaskMetrics[] = [];

  async append(entry: TaskMetrics): Promise<Result<void, PersistenceError>> {
    this.store.push(entry);
    return ok(undefined);
  }

  async readBySlice(sliceId: string): Promise<Result<TaskMetrics[], PersistenceError>> {
    return ok(this.store.filter((e) => e.sliceId === sliceId));
  }

  async readByMilestone(milestoneId: string): Promise<Result<TaskMetrics[], PersistenceError>> {
    return ok(this.store.filter((e) => e.milestoneId === milestoneId));
  }

  async readAll(): Promise<Result<TaskMetrics[], PersistenceError>> {
    return ok([...this.store]);
  }

  seed(entries: TaskMetrics[]): void {
    this.store.push(...entries);
  }

  reset(): void {
    this.store = [];
  }
}
```
- [ ] Step 5: Run `npx vitest run src/hexagons/execution/infrastructure/in-memory-metrics.repository.spec.ts` — expect PASS
- [ ] Step 6: `git add src/hexagons/execution/infrastructure/in-memory-metrics.repository.ts src/hexagons/execution/infrastructure/in-memory-metrics.repository.spec.ts src/hexagons/execution/infrastructure/metrics-repository.contract.spec.ts && git commit -m "feat(S05/T06): add InMemoryMetricsRepository with contract tests"`

---

### T07: JsonlMetricsRepository
**Files:** Create `src/hexagons/execution/infrastructure/jsonl-metrics.repository.ts`, Create `src/hexagons/execution/infrastructure/jsonl-metrics.repository.spec.ts`
**Depends on:** T03, T04
**Traces to:** AC3

- [ ] Step 1: Write JSONL adapter spec:
```typescript
import { isErr, isOk } from "@kernel";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TaskMetricsBuilder } from "../domain/task-metrics.builder";
import { JsonlMetricsRepository } from "./jsonl-metrics.repository";
import { runMetricsContractTests } from "./metrics-repository.contract.spec";

let basePath: string;
let filePath: string;

beforeAll(async () => {
  basePath = await mkdtemp(join(tmpdir(), "tff-metrics-"));
  filePath = join(basePath, "metrics.jsonl");
});
afterAll(async () => {
  await rm(basePath, { recursive: true, force: true });
});

runMetricsContractTests(
  "JsonlMetricsRepository",
  () => new JsonlMetricsRepository(filePath),
);

describe("JsonlMetricsRepository (JSONL-specific)", () => {
  it("appends one JSON line per entry", async () => {
    const repo = new JsonlMetricsRepository(join(basePath, "lines-test.jsonl"));
    await repo.append(new TaskMetricsBuilder().build());
    await repo.append(new TaskMetricsBuilder().build());

    const { readFile } = await import("node:fs/promises");
    const content = await readFile(join(basePath, "lines-test.jsonl"), "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    expect(lines).toHaveLength(2);
    expect(() => JSON.parse(lines[0])).not.toThrow();
    expect(() => JSON.parse(lines[1])).not.toThrow();
  });

  it("skips corrupt lines and returns valid entries", async () => {
    const corruptPath = join(basePath, "corrupt-test.jsonl");
    const validEntry = new TaskMetricsBuilder().build();
    const repo = new JsonlMetricsRepository(corruptPath);
    await repo.append(validEntry);
    // Manually inject a corrupt line
    const { appendFile } = await import("node:fs/promises");
    await appendFile(corruptPath, "not valid json\n", "utf-8");
    await repo.append(new TaskMetricsBuilder().build());

    const result = await repo.readAll();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toHaveLength(2); // skipped corrupt line
    }
  });

  it("returns empty array for non-existent file", async () => {
    const repo = new JsonlMetricsRepository(join(basePath, "nonexistent.jsonl"));
    const result = await repo.readAll();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.data).toHaveLength(0);
  });
});
```
- [ ] Step 2: Run `npx vitest run src/hexagons/execution/infrastructure/jsonl-metrics.repository.spec.ts` — expect FAIL
- [ ] Step 3: Implement `jsonl-metrics.repository.ts`:
```typescript
import { unlinkSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { err, ok, type Result } from "@kernel";
import { PersistenceError } from "@kernel";
import type { TaskMetrics } from "../domain/task-metrics.schemas";
import { TaskMetricsSchema } from "../domain/task-metrics.schemas";
import { MetricsRepositoryPort } from "../domain/ports/metrics-repository.port";

function isNodeError(error: unknown): error is Error & { code: string } {
  if (!(error instanceof Error)) return false;
  if (!("code" in error)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  return descriptor !== undefined && typeof descriptor.value === "string";
}

function serializeEntry(entry: TaskMetrics): string {
  return JSON.stringify({
    ...entry,
    timestamp: entry.timestamp instanceof Date ? entry.timestamp.toISOString() : entry.timestamp,
  });
}

export class JsonlMetricsRepository extends MetricsRepositoryPort {
  constructor(private readonly filePath: string) {
    super();
  }

  async append(entry: TaskMetrics): Promise<Result<void, PersistenceError>> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, `${serializeEntry(entry)}\n`, "utf-8");
      return ok(undefined);
    } catch (error: unknown) {
      return err(new PersistenceError(error instanceof Error ? error.message : String(error)));
    }
  }

  async readAll(): Promise<Result<TaskMetrics[], PersistenceError>> {
    let content: string;
    try {
      content = await readFile(this.filePath, "utf-8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") return ok([]);
      return err(new PersistenceError(error instanceof Error ? error.message : String(error)));
    }
    const lines = content.split("\n").filter((l) => l.trim());
    const entries: TaskMetrics[] = [];
    for (const line of lines) {
      try {
        const raw: unknown = JSON.parse(line);
        const parsed = TaskMetricsSchema.safeParse(raw);
        if (parsed.success) {
          entries.push(parsed.data);
        }
        // Skip corrupt lines silently (per spec: safeParse + skip)
      } catch {
        // Skip unparseable JSON lines
      }
    }
    return ok(entries);
  }

  async readBySlice(sliceId: string): Promise<Result<TaskMetrics[], PersistenceError>> {
    const result = await this.readAll();
    if (!result.ok) return result;
    return ok(result.data.filter((e) => e.sliceId === sliceId));
  }

  async readByMilestone(milestoneId: string): Promise<Result<TaskMetrics[], PersistenceError>> {
    const result = await this.readAll();
    if (!result.ok) return result;
    return ok(result.data.filter((e) => e.milestoneId === milestoneId));
  }

  reset(): void {
    try {
      unlinkSync(this.filePath);
    } catch {
      // File may not exist
    }
  }
}
```
- [ ] Step 4: Run `npx vitest run src/hexagons/execution/infrastructure/jsonl-metrics.repository.spec.ts` — expect PASS
- [ ] Step 5: `git add src/hexagons/execution/infrastructure/jsonl-metrics.repository.ts src/hexagons/execution/infrastructure/jsonl-metrics.repository.spec.ts && git commit -m "feat(S05/T07): add JsonlMetricsRepository with contract + JSONL-specific tests"`

---

## Wave 3 (depends on Wave 2)

### T08: RecordTaskMetricsUseCase
**Files:** Create `src/hexagons/execution/application/record-task-metrics.use-case.ts`, Create `src/hexagons/execution/application/record-task-metrics.use-case.spec.ts`
**Depends on:** T04, T05, T06
**Traces to:** AC2

- [ ] Step 1: Write use case spec:
```typescript
import { AgentResultBuilder } from "@kernel/agents";
import { InProcessEventBus, isOk, SilentLoggerAdapter } from "@kernel";
import { beforeEach, describe, expect, it } from "vitest";
import { TaskExecutionCompletedEvent } from "../domain/events/task-execution-completed.event";
import { InMemoryMetricsRepository } from "../infrastructure/in-memory-metrics.repository";
import { RecordTaskMetricsUseCase } from "./record-task-metrics.use-case";

describe("RecordTaskMetricsUseCase", () => {
  let repo: InMemoryMetricsRepository;
  let bus: InProcessEventBus;
  let useCase: RecordTaskMetricsUseCase;

  beforeEach(() => {
    repo = new InMemoryMetricsRepository();
    bus = new InProcessEventBus(new SilentLoggerAdapter());
    useCase = new RecordTaskMetricsUseCase(repo);
    useCase.register(bus);
  });

  it("transforms AgentResult into TaskMetrics and persists (AC2)", async () => {
    const sliceId = crypto.randomUUID();
    const milestoneId = crypto.randomUUID();
    const agentResult = new AgentResultBuilder().withCost({
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.05,
    }).build();

    await bus.publish(new TaskExecutionCompletedEvent({
      id: crypto.randomUUID(),
      aggregateId: crypto.randomUUID(),
      occurredAt: new Date(),
      taskId: agentResult.taskId,
      sliceId,
      milestoneId,
      waveIndex: 0,
      modelProfile: "balanced",
      agentResult,
    }));

    const result = await repo.readAll();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toHaveLength(1);
      const metrics = result.data[0];
      expect(metrics.taskId).toBe(agentResult.taskId);
      expect(metrics.sliceId).toBe(sliceId);
      expect(metrics.milestoneId).toBe(milestoneId);
      expect(metrics.model.provider).toBe("anthropic");
      expect(metrics.model.modelId).toBe("claude-sonnet-4-6");
      expect(metrics.model.profile).toBe("balanced");
      expect(metrics.tokens.input).toBe(1000);
      expect(metrics.tokens.output).toBe(500);
      expect(metrics.costUsd).toBe(0.05);
      expect(metrics.success).toBe(agentResult.success);
      expect(metrics.durationMs).toBe(agentResult.durationMs);
      expect(metrics.retries).toBe(0);
      expect(metrics.downshifted).toBe(false);
    }
  });

  it("records failed dispatches too (AC1)", async () => {
    const agentResult = new AgentResultBuilder().withFailure("timeout").build();

    await bus.publish(new TaskExecutionCompletedEvent({
      id: crypto.randomUUID(),
      aggregateId: crypto.randomUUID(),
      occurredAt: new Date(),
      taskId: agentResult.taskId,
      sliceId: crypto.randomUUID(),
      milestoneId: crypto.randomUUID(),
      waveIndex: 1,
      modelProfile: "quality",
      agentResult,
    }));

    const result = await repo.readAll();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].success).toBe(false);
    }
  });

  it("ignores non-TaskExecutionCompletedEvent events", async () => {
    // Publish a different event type — nothing should be recorded
    const { CheckpointSavedEvent } = await import("../domain/events/checkpoint-saved.event");
    await bus.publish(new CheckpointSavedEvent({
      id: crypto.randomUUID(),
      aggregateId: crypto.randomUUID(),
      occurredAt: new Date(),
      sliceId: crypto.randomUUID(),
      waveIndex: 0,
      completedTaskCount: 1,
    }));

    const result = await repo.readAll();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.data).toHaveLength(0);
  });
});
```
- [ ] Step 2: Run `npx vitest run src/hexagons/execution/application/record-task-metrics.use-case.spec.ts` — expect FAIL
- [ ] Step 3: Implement `record-task-metrics.use-case.ts`:
```typescript
import { type DomainEvent, EVENT_NAMES, type EventBusPort } from "@kernel";
import { TaskExecutionCompletedEvent } from "../domain/events/task-execution-completed.event";
import type { MetricsRepositoryPort } from "../domain/ports/metrics-repository.port";
import type { TaskMetrics } from "../domain/task-metrics.schemas";

export class RecordTaskMetricsUseCase {
  constructor(private readonly metricsRepo: MetricsRepositoryPort) {}

  register(eventBus: EventBusPort): void {
    eventBus.subscribe(EVENT_NAMES.TASK_EXECUTION_COMPLETED, (event) =>
      this.onTaskExecutionCompleted(event),
    );
  }

  private async onTaskExecutionCompleted(event: DomainEvent): Promise<void> {
    if (!(event instanceof TaskExecutionCompletedEvent)) return;

    const metrics: TaskMetrics = {
      taskId: event.taskId,
      sliceId: event.sliceId,
      milestoneId: event.milestoneId,
      model: {
        provider: event.agentResult.cost.provider,
        modelId: event.agentResult.cost.modelId,
        profile: event.modelProfile,
      },
      tokens: {
        input: event.agentResult.cost.inputTokens,
        output: event.agentResult.cost.outputTokens,
      },
      costUsd: event.agentResult.cost.costUsd,
      durationMs: event.agentResult.durationMs,
      success: event.agentResult.success,
      retries: 0,
      downshifted: false,
      reflectionPassed: undefined,
      timestamp: event.occurredAt,
    };

    const result = await this.metricsRepo.append(metrics);
    if (!result.ok) {
      console.warn(`[tff] metrics write failed: ${result.error.message}`);
    }
  }
}
```
- [ ] Step 4: Run `npx vitest run src/hexagons/execution/application/record-task-metrics.use-case.spec.ts` — expect PASS
- [ ] Step 5: `git add src/hexagons/execution/application/record-task-metrics.use-case.ts src/hexagons/execution/application/record-task-metrics.use-case.spec.ts && git commit -m "feat(S05/T08): add RecordTaskMetricsUseCase with event subscription"`

---

### T09: AggregateMetricsUseCase
**Files:** Create `src/hexagons/execution/application/aggregate-metrics.use-case.ts`, Create `src/hexagons/execution/application/aggregate-metrics.use-case.spec.ts`
**Depends on:** T04, T06
**Traces to:** AC4, AC5

- [ ] Step 1: Write use case spec:
```typescript
import { isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { TaskMetricsBuilder } from "../domain/task-metrics.builder";
import { InMemoryMetricsRepository } from "../infrastructure/in-memory-metrics.repository";
import { AggregateMetricsUseCase } from "./aggregate-metrics.use-case";

describe("AggregateMetricsUseCase", () => {
  const sliceId = crypto.randomUUID();
  const milestoneId = crypto.randomUUID();

  function setup(entries: ReturnType<TaskMetricsBuilder["build"]>[]) {
    const repo = new InMemoryMetricsRepository();
    repo.seed(entries);
    const useCase = new AggregateMetricsUseCase(repo);
    return { repo, useCase };
  }

  it("returns per-slice totals (AC4)", async () => {
    const entries = [
      new TaskMetricsBuilder().withSliceId(sliceId).withMilestoneId(milestoneId)
        .withInputTokens(1000).withOutputTokens(500).withCostUsd(0.05).withDurationMs(10000).withSuccess(true).build(),
      new TaskMetricsBuilder().withSliceId(sliceId).withMilestoneId(milestoneId)
        .withInputTokens(2000).withOutputTokens(800).withCostUsd(0.08).withDurationMs(20000).withSuccess(true).build(),
      new TaskMetricsBuilder().withSliceId(sliceId).withMilestoneId(milestoneId)
        .withInputTokens(500).withOutputTokens(200).withCostUsd(0.02).withDurationMs(5000).withSuccess(false).build(),
    ];
    const { useCase } = setup(entries);

    const result = await useCase.aggregateBySlice(sliceId);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const agg = result.data;
      expect(agg.groupKey.sliceId).toBe(sliceId);
      expect(agg.taskCount).toBe(3);
      expect(agg.successCount).toBe(2);
      expect(agg.failureCount).toBe(1);
      expect(agg.totalInputTokens).toBe(3500);
      expect(agg.totalOutputTokens).toBe(1500);
      expect(agg.totalCostUsd).toBeCloseTo(0.15);
      expect(agg.totalDurationMs).toBe(35000);
      expect(agg.averageCostPerTask).toBeCloseTo(0.05);
    }
  });

  it("returns per-milestone totals with model breakdown (AC5)", async () => {
    const entries = [
      new TaskMetricsBuilder().withSliceId(sliceId).withMilestoneId(milestoneId)
        .withModelId("claude-sonnet-4-6").withCostUsd(0.05).withSuccess(true).build(),
      new TaskMetricsBuilder().withSliceId(sliceId).withMilestoneId(milestoneId)
        .withModelId("claude-sonnet-4-6").withCostUsd(0.08).withSuccess(true).build(),
      new TaskMetricsBuilder().withSliceId(crypto.randomUUID()).withMilestoneId(milestoneId)
        .withModelId("claude-opus-4-6").withCostUsd(0.50).withSuccess(true).build(),
    ];
    const { useCase } = setup(entries);

    const result = await useCase.aggregateByMilestone(milestoneId);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const agg = result.data;
      expect(agg.groupKey.milestoneId).toBe(milestoneId);
      expect(agg.taskCount).toBe(3);
      expect(agg.modelBreakdown).toHaveLength(2);

      const sonnet = agg.modelBreakdown.find((m) => m.modelId === "claude-sonnet-4-6");
      expect(sonnet).toBeDefined();
      expect(sonnet?.taskCount).toBe(2);
      expect(sonnet?.totalCostUsd).toBeCloseTo(0.13);

      const opus = agg.modelBreakdown.find((m) => m.modelId === "claude-opus-4-6");
      expect(opus).toBeDefined();
      expect(opus?.taskCount).toBe(1);
      expect(opus?.totalCostUsd).toBeCloseTo(0.50);
    }
  });

  it("returns zero aggregation for unknown slice", async () => {
    const { useCase } = setup([]);
    const result = await useCase.aggregateBySlice(crypto.randomUUID());
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.taskCount).toBe(0);
      expect(result.data.totalCostUsd).toBe(0);
      expect(result.data.modelBreakdown).toHaveLength(0);
    }
  });

  it("excludes entries from other slices", async () => {
    const entries = [
      new TaskMetricsBuilder().withSliceId(sliceId).withCostUsd(0.10).build(),
      new TaskMetricsBuilder().withSliceId(crypto.randomUUID()).withCostUsd(0.90).build(),
    ];
    const { useCase } = setup(entries);

    const result = await useCase.aggregateBySlice(sliceId);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.taskCount).toBe(1);
      expect(result.data.totalCostUsd).toBeCloseTo(0.10);
    }
  });
});
```
- [ ] Step 2: Run `npx vitest run src/hexagons/execution/application/aggregate-metrics.use-case.spec.ts` — expect FAIL
- [ ] Step 3: Implement `aggregate-metrics.use-case.ts`:
```typescript
import { ok, type Result } from "@kernel";
import type { PersistenceError } from "@kernel";
import type { MetricsRepositoryPort } from "../domain/ports/metrics-repository.port";
import type { AggregatedMetrics, ModelBreakdownEntry, TaskMetrics } from "../domain/task-metrics.schemas";

export class AggregateMetricsUseCase {
  constructor(private readonly metricsRepo: MetricsRepositoryPort) {}

  async aggregateBySlice(sliceId: string): Promise<Result<AggregatedMetrics, PersistenceError>> {
    const result = await this.metricsRepo.readBySlice(sliceId);
    if (!result.ok) return result;
    return ok(this.aggregate(result.data, { sliceId }));
  }

  async aggregateByMilestone(milestoneId: string): Promise<Result<AggregatedMetrics, PersistenceError>> {
    const result = await this.metricsRepo.readByMilestone(milestoneId);
    if (!result.ok) return result;
    return ok(this.aggregate(result.data, { milestoneId }));
  }

  private aggregate(
    entries: TaskMetrics[],
    groupKey: { sliceId?: string; milestoneId?: string },
  ): AggregatedMetrics {
    const totalCostUsd = entries.reduce((sum, e) => sum + e.costUsd, 0);
    const totalInputTokens = entries.reduce((sum, e) => sum + e.tokens.input, 0);
    const totalOutputTokens = entries.reduce((sum, e) => sum + e.tokens.output, 0);
    const totalDurationMs = entries.reduce((sum, e) => sum + e.durationMs, 0);
    const taskCount = entries.length;
    const successCount = entries.filter((e) => e.success).length;
    const failureCount = taskCount - successCount;
    const averageCostPerTask = taskCount > 0 ? totalCostUsd / taskCount : 0;

    const modelMap = new Map<string, { taskCount: number; totalCostUsd: number }>();
    for (const entry of entries) {
      const existing = modelMap.get(entry.model.modelId) ?? { taskCount: 0, totalCostUsd: 0 };
      modelMap.set(entry.model.modelId, {
        taskCount: existing.taskCount + 1,
        totalCostUsd: existing.totalCostUsd + entry.costUsd,
      });
    }
    const modelBreakdown: ModelBreakdownEntry[] = [...modelMap.entries()].map(
      ([modelId, data]) => ({ modelId, ...data }),
    );

    return {
      groupKey,
      totalCostUsd,
      totalInputTokens,
      totalOutputTokens,
      totalDurationMs,
      taskCount,
      successCount,
      failureCount,
      averageCostPerTask,
      modelBreakdown,
    };
  }
}
```
- [ ] Step 4: Run `npx vitest run src/hexagons/execution/application/aggregate-metrics.use-case.spec.ts` — expect PASS
- [ ] Step 5: `git add src/hexagons/execution/application/aggregate-metrics.use-case.ts src/hexagons/execution/application/aggregate-metrics.use-case.spec.ts && git commit -m "feat(S05/T09): add AggregateMetricsUseCase with per-slice and per-milestone aggregation"`

---

## Wave 4 (depends on Wave 3)

### T10: Barrel exports
**Files:** Modify `src/hexagons/execution/index.ts`
**Depends on:** T01–T09
**Traces to:** AC7

- [ ] Step 1: Add exports to `src/hexagons/execution/index.ts`:
```typescript
// After existing Application exports, add:
export { AggregateMetricsUseCase } from "./application/aggregate-metrics.use-case";
export { RecordTaskMetricsUseCase } from "./application/record-task-metrics.use-case";

// After existing Domain -- Schemas exports, add:
export type { AggregatedMetrics, ModelBreakdownEntry, TaskMetrics, TaskMetricsModel } from "./domain/task-metrics.schemas";
export { AggregatedMetricsSchema, ModelBreakdownEntrySchema, TaskMetricsModelSchema, TaskMetricsSchema } from "./domain/task-metrics.schemas";

// After existing Domain -- Events exports, add:
export { TaskExecutionCompletedEvent } from "./domain/events/task-execution-completed.event";

// After existing Domain -- Ports exports, add:
export { MetricsQueryPort } from "./domain/ports/metrics-query.port";
export { MetricsRepositoryPort } from "./domain/ports/metrics-repository.port";

// After existing Infrastructure exports, add:
export { InMemoryMetricsRepository } from "./infrastructure/in-memory-metrics.repository";
export { JsonlMetricsRepository } from "./infrastructure/jsonl-metrics.repository";

// After existing builder exports (if any), add:
export { TaskMetricsBuilder } from "./domain/task-metrics.builder";
```
- [ ] Step 2: Run `npx vitest run src/hexagons/execution/` — expect all PASS (full hexagon regression)
- [ ] Step 3: `git add src/hexagons/execution/index.ts && git commit -m "feat(S05/T10): export cost tracking types from execution barrel"`

---

## Dependency Graph

```
T01 (EVENT_NAMES) ──────────────┐
                                 ├──→ T05 (Event)
T02 (Schemas) ──┬──→ T03 (Builder)──┐
                ├──→ T04 (Ports) ────┤
                │                    ├──→ T06 (InMem + Contract)──┐
                │                    └──→ T07 (JSONL) ────────────┤
                │                                                  ├──→ T08 (RecordMetrics)
                │                                                  ├──→ T09 (AggregateMetrics)
                │                                                  │
                └──────────────────────────────────────────────────┴──→ T10 (Barrel)
```

## Wave Summary

| Wave | Tasks | Parallel |
|---|---|---|
| 0 | T01, T02 | Yes |
| 1 | T03, T04, T05 | Yes |
| 2 | T06, T07 | Yes |
| 3 | T08, T09 | Yes |
| 4 | T10 | No |
