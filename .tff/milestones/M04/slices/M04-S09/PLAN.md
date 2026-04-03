# M04-S09: Async Overseer / Watchdog — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Lightweight real-time monitor for stuck agent detection with configurable timeout, retry loop detection, and escalation.
**Architecture:** OverseerPort (monitors running agents via timer) + RetryPolicy (decides between retry attempts). Composable strategy pattern, same as OutputGuardrailPort.
**Tech Stack:** TypeScript, Zod, Vitest (fake timers), hexagonal architecture.

## File Structure

### New Files
| File | Responsibility |
|---|---|
| `src/hexagons/execution/domain/overseer.schemas.ts` | OverseerVerdict, OverseerContext, OverseerConfig, RetryDecision, InterventionAction schemas |
| `src/hexagons/execution/domain/overseer.schemas.spec.ts` | Schema validation tests |
| `src/hexagons/execution/domain/overseer-strategy.ts` | OverseerStrategy interface |
| `src/hexagons/execution/domain/errors/overseer.error.ts` | OverseerError domain error |
| `src/hexagons/execution/domain/ports/overseer.port.ts` | OverseerPort abstract class |
| `src/hexagons/execution/domain/ports/retry-policy.port.ts` | RetryPolicy abstract class |
| `src/hexagons/execution/infrastructure/timeout-strategy.ts` | Timer-based timeout detection |
| `src/hexagons/execution/infrastructure/timeout-strategy.spec.ts` | Tests with fake timers |
| `src/hexagons/execution/infrastructure/composable-overseer.adapter.ts` | Composes strategies, per-task monitor map |
| `src/hexagons/execution/infrastructure/composable-overseer.adapter.spec.ts` | Adapter tests |
| `src/hexagons/execution/infrastructure/in-memory-overseer.adapter.ts` | Test double for OverseerPort |
| `src/hexagons/execution/infrastructure/default-retry-policy.ts` | In-memory retry policy with error signature matching |
| `src/hexagons/execution/infrastructure/default-retry-policy.spec.ts` | Tests |

### Modified Files
| File | Change |
|---|---|
| `src/hexagons/execution/domain/journal-entry.schemas.ts` | Add OverseerInterventionEntry to union |
| `src/hexagons/execution/domain/journal-entry.builder.ts` | Add `buildOverseerIntervention()` |
| `src/hexagons/settings/domain/project-settings.schemas.ts` | Add OverseerConfigSchema + defaults |
| `src/hexagons/execution/application/execute-slice.use-case.ts` | Add overseer + retryPolicy deps, restructure wave dispatch |
| `src/hexagons/execution/application/execute-slice.use-case.spec.ts` | Integration tests for overseer |
| `src/hexagons/execution/index.ts` | Export new types |

---

## Wave 0 (parallel — no dependencies)

### T01: Overseer domain schemas + error + strategy interface

**Create:** `src/hexagons/execution/domain/overseer.schemas.ts`
**Create:** `src/hexagons/execution/domain/overseer.schemas.spec.ts`
**Create:** `src/hexagons/execution/domain/overseer-strategy.ts`
**Create:** `src/hexagons/execution/domain/errors/overseer.error.ts`
**Traces to:** AC1, AC2, AC3, AC4, AC5

- [ ] Step 1: Write failing tests for overseer schemas

**File:** `src/hexagons/execution/domain/overseer.schemas.spec.ts`
```typescript
import { describe, expect, it } from "vitest";
import {
  InterventionActionSchema,
  OverseerConfigSchema,
  OverseerContextSchema,
  OverseerVerdictSchema,
  RetryDecisionSchema,
} from "./overseer.schemas";

describe("OverseerVerdictSchema", () => {
  it("accepts a valid verdict", () => {
    const result = OverseerVerdictSchema.safeParse({
      strategy: "timeout",
      reason: "Task exceeded S timeout of 300000ms",
    });
    expect(result.success).toBe(true);
  });
  it("rejects empty strategy", () => {
    expect(OverseerVerdictSchema.safeParse({ strategy: "", reason: "x" }).success).toBe(false);
  });
});

describe("OverseerContextSchema", () => {
  it("accepts a valid context", () => {
    const result = OverseerContextSchema.safeParse({
      taskId: crypto.randomUUID(),
      sliceId: crypto.randomUUID(),
      complexityTier: "F-lite",
      dispatchTimestamp: new Date(),
    });
    expect(result.success).toBe(true);
  });
  it("rejects invalid tier", () => {
    const result = OverseerContextSchema.safeParse({
      taskId: crypto.randomUUID(),
      sliceId: crypto.randomUUID(),
      complexityTier: "XL",
      dispatchTimestamp: new Date(),
    });
    expect(result.success).toBe(false);
  });
});

describe("OverseerConfigSchema", () => {
  it("accepts full config", () => {
    const result = OverseerConfigSchema.safeParse({
      enabled: true,
      timeouts: { S: 300000, "F-lite": 900000, "F-full": 1800000 },
      retryLoop: { threshold: 3 },
    });
    expect(result.success).toBe(true);
  });
  it("provides defaults", () => {
    const result = OverseerConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.timeouts.S).toBe(300000);
    }
  });
});

describe("RetryDecisionSchema", () => {
  it("accepts retry=true", () => {
    const result = RetryDecisionSchema.safeParse({ retry: true, reason: "attempt 1 of 2" });
    expect(result.success).toBe(true);
  });
});

describe("InterventionActionSchema", () => {
  it("accepts all valid actions", () => {
    for (const action of ["aborted", "retrying", "escalated"]) {
      expect(InterventionActionSchema.safeParse(action).success).toBe(true);
    }
  });
});
```

- [ ] Step 2: Run tests, verify FAIL
**Run:** `npx vitest run src/hexagons/execution/domain/overseer.schemas.spec.ts`
**Expect:** FAIL — module not found

- [ ] Step 3: Implement schemas, strategy interface, and error class

**File:** `src/hexagons/execution/domain/overseer.schemas.ts`
```typescript
import { ComplexityTierSchema, IdSchema, TimestampSchema } from "@kernel";
import { z } from "zod";

export const OverseerVerdictSchema = z.object({
  strategy: z.string().min(1),
  reason: z.string().min(1),
});
export type OverseerVerdict = z.infer<typeof OverseerVerdictSchema>;

export const OverseerContextSchema = z.object({
  taskId: IdSchema,
  sliceId: IdSchema,
  complexityTier: ComplexityTierSchema,
  dispatchTimestamp: TimestampSchema,
});
export type OverseerContext = z.infer<typeof OverseerContextSchema>;

export const OverseerConfigSchema = z.object({
  enabled: z.boolean().default(true),
  timeouts: z
    .object({
      S: z.number().int().positive().default(300000),
      "F-lite": z.number().int().positive().default(900000),
      "F-full": z.number().int().positive().default(1800000),
    })
    .default({ S: 300000, "F-lite": 900000, "F-full": 1800000 }),
  retryLoop: z
    .object({
      threshold: z.number().int().min(1).default(3),
    })
    .default({ threshold: 3 }),
});
export type OverseerConfig = z.infer<typeof OverseerConfigSchema>;

export const RetryDecisionSchema = z.object({
  retry: z.boolean(),
  reason: z.string().min(1),
});
export type RetryDecision = z.infer<typeof RetryDecisionSchema>;

export const InterventionActionSchema = z.enum(["aborted", "retrying", "escalated"]);
export type InterventionAction = z.infer<typeof InterventionActionSchema>;
```

**File:** `src/hexagons/execution/domain/overseer-strategy.ts`
```typescript
import type { OverseerContext, OverseerVerdict } from "./overseer.schemas";

export interface OverseerStrategy {
  readonly id: string;
  start(context: OverseerContext): Promise<OverseerVerdict>;
  cancel(taskId: string): void;
}
```

**File:** `src/hexagons/execution/domain/errors/overseer.error.ts`
```typescript
import { BaseDomainError } from "@kernel";

export class OverseerError extends BaseDomainError {
  readonly code: string;

  private constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = code;
  }

  static timeout(taskId: string, reason: string): OverseerError {
    return new OverseerError("OVERSEER.TIMEOUT", `Overseer timeout for task ${taskId}: ${reason}`, {
      taskId,
      reason,
    });
  }

  static retryLoop(taskId: string, reason: string): OverseerError {
    return new OverseerError(
      "OVERSEER.RETRY_LOOP",
      `Retry loop detected for task ${taskId}: ${reason}`,
      { taskId, reason },
    );
  }

  static abortFailed(taskId: string, cause: unknown): OverseerError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new OverseerError("OVERSEER.ABORT_FAILED", `Failed to abort task ${taskId}: ${msg}`, {
      taskId,
      cause: msg,
    });
  }
}
```

- [ ] Step 4: Run tests, verify PASS
**Run:** `npx vitest run src/hexagons/execution/domain/overseer.schemas.spec.ts`
**Expect:** PASS — all tests green

- [ ] Step 5: Commit
**Run:** `git add src/hexagons/execution/domain/overseer.schemas.ts src/hexagons/execution/domain/overseer.schemas.spec.ts src/hexagons/execution/domain/overseer-strategy.ts src/hexagons/execution/domain/errors/overseer.error.ts && git commit -m "feat(S09/T01): overseer domain schemas + error + strategy interface"`

---

### T03: Settings extension — OverseerConfigSchema

**Modify:** `src/hexagons/settings/domain/project-settings.schemas.ts`
**Traces to:** AC5

- [ ] Step 1: Write failing test

Add to existing test file `src/hexagons/settings/domain/project-settings.schemas.spec.ts`:
```typescript
describe("OverseerConfig in SettingsSchema", () => {
  it("provides overseer defaults when omitted", () => {
    const result = SettingsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.overseer.enabled).toBe(true);
      expect(result.data.overseer.timeouts.S).toBe(300000);
      expect(result.data.overseer.timeouts["F-lite"]).toBe(900000);
      expect(result.data.overseer.timeouts["F-full"]).toBe(1800000);
      expect(result.data.overseer.retryLoop.threshold).toBe(3);
    }
  });
  it("accepts custom overseer config", () => {
    const result = SettingsSchema.safeParse({
      overseer: { enabled: false, timeouts: { S: 60000, "F-lite": 120000, "F-full": 300000 } },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.overseer.enabled).toBe(false);
      expect(result.data.overseer.timeouts.S).toBe(60000);
    }
  });
  it("falls back to defaults on invalid overseer config", () => {
    const result = SettingsSchema.safeParse({ overseer: "invalid" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.overseer.enabled).toBe(true);
    }
  });
});
```

- [ ] Step 2: Run tests, verify FAIL
**Run:** `npx vitest run src/hexagons/settings/domain/project-settings.schemas.spec.ts`
**Expect:** FAIL — `result.data.overseer` is undefined

- [ ] Step 3: Implement settings extension

**Modify:** `src/hexagons/settings/domain/project-settings.schemas.ts`

Add after `BaseGuardrailsConfigSchema` block (line ~113):
```typescript
const BaseOverseerConfigSchema = z.object({
  enabled: z.boolean().default(true),
  timeouts: z
    .object({
      S: z.number().int().positive().default(300000),
      "F-lite": z.number().int().positive().default(900000),
      "F-full": z.number().int().positive().default(1800000),
    })
    .default({ S: 300000, "F-lite": 900000, "F-full": 1800000 }),
  retryLoop: z
    .object({
      threshold: z.number().int().min(1).default(3),
    })
    .default({ threshold: 3 }),
});
export type OverseerConfig = z.infer<typeof BaseOverseerConfigSchema>;
```

Add defaults after `GUARDRAILS_DEFAULTS` (line ~157):
```typescript
export const OVERSEER_DEFAULTS: OverseerConfig = {
  enabled: true,
  timeouts: { S: 300000, "F-lite": 900000, "F-full": 1800000 },
  retryLoop: { threshold: 3 },
};
```

Add catch schema after `GuardrailsConfigSchema` (line ~167):
```typescript
export const SettingsOverseerConfigSchema = BaseOverseerConfigSchema.catch(OVERSEER_DEFAULTS);
```

Add to `SETTINGS_DEFAULTS` object:
```typescript
overseer: OVERSEER_DEFAULTS,
```

Add to `SettingsSchema` object:
```typescript
overseer: SettingsOverseerConfigSchema.default(OVERSEER_DEFAULTS),
```

Add to `ENV_VAR_MAP`:
```typescript
TFF_OVERSEER_ENABLED: ["overseer", "enabled"],
```

**Note:** The overseer config is defined as a top-level settings key (same pattern as `guardrails`), not nested under `autonomy`. This keeps settings flat and consistent.

- [ ] Step 4: Run tests, verify PASS
**Run:** `npx vitest run src/hexagons/settings/domain/project-settings.schemas.spec.ts`
**Expect:** PASS

- [ ] Step 5: Commit
**Run:** `git add src/hexagons/settings/domain/project-settings.schemas.ts src/hexagons/settings/domain/project-settings.schemas.spec.ts && git commit -m "feat(S09/T03): overseer config in settings with defaults"`

---

## Wave 1 (depends on T01)

### T02: Journal entry extension — OverseerInterventionEntry

**Modify:** `src/hexagons/execution/domain/journal-entry.schemas.ts`
**Modify:** `src/hexagons/execution/domain/journal-entry.builder.ts`
**Depends on:** T01 (imports `InterventionActionSchema` from `overseer.schemas`)
**Traces to:** AC3

- [ ] Step 1: Write failing test for new journal entry type

Add import to existing `src/hexagons/execution/domain/journal-entry.schemas.spec.ts` (update the existing import block to include `OverseerInterventionEntrySchema`):
```typescript
import { OverseerInterventionEntrySchema } from "./journal-entry.schemas";
```

Add test:
```typescript
describe("OverseerInterventionEntrySchema", () => {
  it("accepts a valid intervention entry", () => {
    const result = OverseerInterventionEntrySchema.safeParse({
      seq: 0,
      sliceId: crypto.randomUUID(),
      timestamp: new Date(),
      type: "overseer-intervention",
      taskId: crypto.randomUUID(),
      strategy: "timeout",
      reason: "Task exceeded S timeout of 300000ms",
      action: "aborted",
      retryCount: 0,
    });
    expect(result.success).toBe(true);
  });
  it("accepts all action variants", () => {
    for (const action of ["aborted", "retrying", "escalated"]) {
      const result = OverseerInterventionEntrySchema.safeParse({
        seq: 1,
        sliceId: crypto.randomUUID(),
        timestamp: new Date(),
        type: "overseer-intervention",
        taskId: crypto.randomUUID(),
        strategy: "timeout",
        reason: "timeout",
        action,
        retryCount: 1,
      });
      expect(result.success).toBe(true);
    }
  });
});
```

- [ ] Step 2: Run tests, verify FAIL
**Run:** `npx vitest run src/hexagons/execution/domain/journal-entry.schemas.spec.ts`
**Expect:** FAIL — OverseerInterventionEntrySchema not found

- [ ] Step 3: Implement journal entry type + builder method

**Modify:** `src/hexagons/execution/domain/journal-entry.schemas.ts`

Add import at line 3 (after GuardrailViolationSchema import):
```typescript
import { InterventionActionSchema } from "./overseer.schemas";
```

Add before the `// Discriminated union` comment (after GuardrailViolationEntry):
```typescript
export const OverseerInterventionEntrySchema = JournalEntryBaseSchema.extend({
  type: z.literal("overseer-intervention"),
  taskId: IdSchema,
  strategy: z.string().min(1),
  reason: z.string().min(1),
  action: InterventionActionSchema,
  retryCount: z.number().int().min(0),
});
export type OverseerInterventionEntry = z.infer<typeof OverseerInterventionEntrySchema>;
```

**Important:** `JournalEntryBaseSchema` is defined locally (not exported). The new schema extends it just like all other entry types.

Add `OverseerInterventionEntrySchema` to the discriminated union array:
```typescript
export const JournalEntrySchema = z.discriminatedUnion("type", [
  TaskStartedEntrySchema,
  TaskCompletedEntrySchema,
  TaskFailedEntrySchema,
  FileWrittenEntrySchema,
  CheckpointSavedEntrySchema,
  PhaseChangedEntrySchema,
  ArtifactWrittenEntrySchema,
  GuardrailViolationEntrySchema,
  OverseerInterventionEntrySchema,
]);
```

**Modify:** `src/hexagons/execution/domain/journal-entry.builder.ts`

Add import (after existing imports):
```typescript
import type { OverseerInterventionEntry } from "./journal-entry.schemas";
```

Add builder method (after `buildArtifactWritten`):
```typescript
buildOverseerIntervention(
  overrides?: Partial<{
    taskId: string;
    strategy: string;
    reason: string;
    action: "aborted" | "retrying" | "escalated";
    retryCount: number;
  }>,
): Omit<OverseerInterventionEntry, "seq"> {
  return {
    type: "overseer-intervention",
    sliceId: this._sliceId,
    timestamp: this._timestamp,
    correlationId: this._correlationId,
    taskId: overrides?.taskId ?? faker.string.uuid(),
    strategy: overrides?.strategy ?? "timeout",
    reason: overrides?.reason ?? "Task timed out",
    action: overrides?.action ?? "aborted",
    retryCount: overrides?.retryCount ?? 0,
  };
}
```

- [ ] Step 4: Run tests, verify PASS
**Run:** `npx vitest run src/hexagons/execution/domain/journal-entry.schemas.spec.ts`
**Expect:** PASS

- [ ] Step 5: Commit
**Run:** `git add src/hexagons/execution/domain/journal-entry.schemas.ts src/hexagons/execution/domain/journal-entry.builder.ts src/hexagons/execution/domain/journal-entry.schemas.spec.ts && git commit -m "feat(S09/T02): overseer-intervention journal entry type + builder"`

---

### T04: OverseerPort + RetryPolicy abstract ports

**Create:** `src/hexagons/execution/domain/ports/overseer.port.ts`
**Create:** `src/hexagons/execution/domain/ports/retry-policy.port.ts`
**Depends on:** T01
**Traces to:** AC1, AC2

- [ ] Step 1: Create port files (no tests needed — abstract classes with no logic)

**File:** `src/hexagons/execution/domain/ports/overseer.port.ts`
```typescript
import type { OverseerContext, OverseerVerdict } from "../overseer.schemas";

export abstract class OverseerPort {
  abstract monitor(context: OverseerContext): Promise<OverseerVerdict>;
  abstract stop(taskId: string): Promise<void>;
  abstract stopAll(): Promise<void>;
}
```

**File:** `src/hexagons/execution/domain/ports/retry-policy.port.ts`
```typescript
import type { RetryDecision } from "../overseer.schemas";

export abstract class RetryPolicy {
  abstract shouldRetry(taskId: string, errorCode: string, attempt: number): RetryDecision;
  abstract recordFailure(taskId: string, errorSignature: string): void;
  abstract reset(taskId: string): void;
}
```

- [ ] Step 2: Verify by running full project typecheck
**Run:** `npx tsc --noEmit`
**Expect:** No new errors

- [ ] Step 3: Commit
**Run:** `git add src/hexagons/execution/domain/ports/overseer.port.ts src/hexagons/execution/domain/ports/retry-policy.port.ts && git commit -m "feat(S09/T04): OverseerPort + RetryPolicy abstract ports"`

---

### T05: TimeoutStrategy

**Create:** `src/hexagons/execution/infrastructure/timeout-strategy.ts`
**Create:** `src/hexagons/execution/infrastructure/timeout-strategy.spec.ts`
**Depends on:** T01
**Traces to:** AC1

- [ ] Step 1: Write failing tests

**File:** `src/hexagons/execution/infrastructure/timeout-strategy.spec.ts`
```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OverseerConfig, OverseerContext } from "../domain/overseer.schemas";
import { TimeoutStrategy } from "./timeout-strategy";

const OVERSEER_CONFIG: OverseerConfig = {
  enabled: true,
  timeouts: { S: 100, "F-lite": 200, "F-full": 300 },
  retryLoop: { threshold: 3 },
};

function makeContext(tier: "S" | "F-lite" | "F-full" = "S"): OverseerContext {
  return {
    taskId: crypto.randomUUID(),
    sliceId: crypto.randomUUID(),
    complexityTier: tier,
    dispatchTimestamp: new Date(),
  };
}

describe("TimeoutStrategy", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves with verdict after tier timeout", async () => {
    const strategy = new TimeoutStrategy(OVERSEER_CONFIG);
    const ctx = makeContext("S");
    const promise = strategy.start(ctx);

    vi.advanceTimersByTime(100);

    const verdict = await promise;
    expect(verdict.strategy).toBe("timeout");
    expect(verdict.reason).toContain("100");
  });

  it("uses F-full timeout for F-full tier", async () => {
    const strategy = new TimeoutStrategy(OVERSEER_CONFIG);
    const ctx = makeContext("F-full");
    const promise = strategy.start(ctx);

    vi.advanceTimersByTime(300);
    const verdict = await promise;
    expect(verdict.strategy).toBe("timeout");
    expect(verdict.reason).toContain("300");
  });

  it("cancel prevents resolution", async () => {
    const strategy = new TimeoutStrategy(OVERSEER_CONFIG);
    const ctx = makeContext("S");
    const promise = strategy.start(ctx);

    strategy.cancel(ctx.taskId);
    vi.advanceTimersByTime(200);

    await expect(promise).rejects.toThrow("cancelled");
  });

  it("id is 'timeout'", () => {
    const strategy = new TimeoutStrategy(OVERSEER_CONFIG);
    expect(strategy.id).toBe("timeout");
  });
});
```

- [ ] Step 2: Run tests, verify FAIL
**Run:** `npx vitest run src/hexagons/execution/infrastructure/timeout-strategy.spec.ts`
**Expect:** FAIL — module not found

- [ ] Step 3: Implement TimeoutStrategy

**File:** `src/hexagons/execution/infrastructure/timeout-strategy.ts`
```typescript
import type { OverseerStrategy } from "../domain/overseer-strategy";
import type { OverseerConfig, OverseerContext, OverseerVerdict } from "../domain/overseer.schemas";

export class TimeoutStrategy implements OverseerStrategy {
  readonly id = "timeout";
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly rejectors = new Map<string, (reason: Error) => void>();

  constructor(private readonly config: OverseerConfig) {}

  start(context: OverseerContext): Promise<OverseerVerdict> {
    const timeoutMs = this.config.timeouts[context.complexityTier];

    return new Promise<OverseerVerdict>((resolve, reject) => {
      this.rejectors.set(context.taskId, reject);
      const timer = setTimeout(() => {
        this.timers.delete(context.taskId);
        this.rejectors.delete(context.taskId);
        resolve({
          strategy: this.id,
          reason: `Task exceeded ${context.complexityTier} timeout of ${timeoutMs}ms`,
        });
      }, timeoutMs);
      this.timers.set(context.taskId, timer);
    });
  }

  cancel(taskId: string): void {
    const timer = this.timers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(taskId);
    }
    const rejector = this.rejectors.get(taskId);
    if (rejector) {
      this.rejectors.delete(taskId);
      rejector(new Error("cancelled"));
    }
  }
}
```

- [ ] Step 4: Run tests, verify PASS
**Run:** `npx vitest run src/hexagons/execution/infrastructure/timeout-strategy.spec.ts`
**Expect:** PASS

- [ ] Step 5: Commit
**Run:** `git add src/hexagons/execution/infrastructure/timeout-strategy.ts src/hexagons/execution/infrastructure/timeout-strategy.spec.ts && git commit -m "feat(S09/T05): TimeoutStrategy with per-tier configurable timeouts"`

---

## Wave 2 (depends on T04, T05)

### T06: ComposableOverseerAdapter + InMemoryOverseerAdapter

**Create:** `src/hexagons/execution/infrastructure/composable-overseer.adapter.ts`
**Create:** `src/hexagons/execution/infrastructure/composable-overseer.adapter.spec.ts`
**Create:** `src/hexagons/execution/infrastructure/in-memory-overseer.adapter.ts`
**Depends on:** T04 (OverseerPort), T05 (TimeoutStrategy for strategy pattern)
**Traces to:** AC1, AC5

- [ ] Step 1: Write failing tests

**File:** `src/hexagons/execution/infrastructure/composable-overseer.adapter.spec.ts`
```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OverseerStrategy } from "../domain/overseer-strategy";
import type { OverseerContext, OverseerVerdict } from "../domain/overseer.schemas";
import { ComposableOverseerAdapter } from "./composable-overseer.adapter";

function makeContext(taskId?: string): OverseerContext {
  return {
    taskId: taskId ?? crypto.randomUUID(),
    sliceId: crypto.randomUUID(),
    complexityTier: "S",
    dispatchTimestamp: new Date(),
  };
}

function fakeStrategy(id: string, delayMs: number): OverseerStrategy {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const rejectors = new Map<string, (e: Error) => void>();
  return {
    id,
    start(ctx: OverseerContext): Promise<OverseerVerdict> {
      return new Promise((resolve, reject) => {
        rejectors.set(ctx.taskId, reject);
        const t = setTimeout(() => {
          timers.delete(ctx.taskId);
          rejectors.delete(ctx.taskId);
          resolve({ strategy: id, reason: `${id} triggered` });
        }, delayMs);
        timers.set(ctx.taskId, t);
      });
    },
    cancel(taskId: string) {
      const t = timers.get(taskId);
      if (t) clearTimeout(t);
      timers.delete(taskId);
      const r = rejectors.get(taskId);
      if (r) r(new Error("cancelled"));
      rejectors.delete(taskId);
    },
  };
}

describe("ComposableOverseerAdapter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves with first triggered strategy (race)", async () => {
    const fast = fakeStrategy("fast", 50);
    const slow = fakeStrategy("slow", 200);
    const adapter = new ComposableOverseerAdapter([fast, slow]);
    const ctx = makeContext();

    const promise = adapter.monitor(ctx);
    vi.advanceTimersByTime(50);
    const verdict = await promise;

    expect(verdict.strategy).toBe("fast");
  });

  it("stop cancels monitors for specific task only", async () => {
    const strategy = fakeStrategy("timeout", 100);
    const adapter = new ComposableOverseerAdapter([strategy]);
    const ctx1 = makeContext("task-1");
    const ctx2 = makeContext("task-2");

    const p1 = adapter.monitor(ctx1);
    adapter.monitor(ctx2);

    await adapter.stop("task-1");
    await expect(p1).rejects.toThrow("cancelled");

    // p2 should still be pending (task-2 monitor not cancelled)
  });

  it("stopAll cancels all active monitors", async () => {
    const strategy = fakeStrategy("timeout", 100);
    const adapter = new ComposableOverseerAdapter([strategy]);

    const p1 = adapter.monitor(makeContext("task-1"));
    const p2 = adapter.monitor(makeContext("task-2"));

    await adapter.stopAll();

    await expect(p1).rejects.toThrow("cancelled");
    await expect(p2).rejects.toThrow("cancelled");
  });
});
```

- [ ] Step 2: Run tests, verify FAIL
**Run:** `npx vitest run src/hexagons/execution/infrastructure/composable-overseer.adapter.spec.ts`
**Expect:** FAIL — module not found

- [ ] Step 3: Implement ComposableOverseerAdapter + InMemoryOverseerAdapter

**File:** `src/hexagons/execution/infrastructure/composable-overseer.adapter.ts`
```typescript
import type { OverseerStrategy } from "../domain/overseer-strategy";
import type { OverseerContext, OverseerVerdict } from "../domain/overseer.schemas";
import { OverseerPort } from "../domain/ports/overseer.port";

export class ComposableOverseerAdapter extends OverseerPort {
  private readonly activeMonitors = new Map<string, OverseerStrategy[]>();

  constructor(private readonly strategies: OverseerStrategy[]) {
    super();
  }

  async monitor(context: OverseerContext): Promise<OverseerVerdict> {
    const taskStrategies = [...this.strategies];
    this.activeMonitors.set(context.taskId, taskStrategies);

    try {
      const verdict = await Promise.race(
        taskStrategies.map((s) => s.start(context)),
      );
      for (const s of taskStrategies) {
        s.cancel(context.taskId);
      }
      this.activeMonitors.delete(context.taskId);
      return verdict;
    } catch (e) {
      this.activeMonitors.delete(context.taskId);
      throw e;
    }
  }

  async stop(taskId: string): Promise<void> {
    const strategies = this.activeMonitors.get(taskId);
    if (strategies) {
      for (const s of strategies) {
        s.cancel(taskId);
      }
      this.activeMonitors.delete(taskId);
    }
  }

  async stopAll(): Promise<void> {
    for (const [taskId] of this.activeMonitors) {
      await this.stop(taskId);
    }
  }
}
```

**File:** `src/hexagons/execution/infrastructure/in-memory-overseer.adapter.ts`
```typescript
import type { OverseerContext, OverseerVerdict } from "../domain/overseer.schemas";
import { OverseerPort } from "../domain/ports/overseer.port";

interface PendingMonitor {
  resolve: (verdict: OverseerVerdict) => void;
  reject: (error: Error) => void;
}

export class InMemoryOverseerAdapter extends OverseerPort {
  private readonly pending = new Map<string, PendingMonitor>();
  private _monitorCalls: OverseerContext[] = [];

  get monitorCalls(): readonly OverseerContext[] {
    return this._monitorCalls;
  }

  async monitor(context: OverseerContext): Promise<OverseerVerdict> {
    this._monitorCalls.push(context);
    return new Promise<OverseerVerdict>((resolve, reject) => {
      this.pending.set(context.taskId, { resolve, reject });
    });
  }

  async stop(taskId: string): Promise<void> {
    const pending = this.pending.get(taskId);
    if (pending) {
      pending.reject(new Error("cancelled"));
      this.pending.delete(taskId);
    }
  }

  async stopAll(): Promise<void> {
    for (const [taskId] of this.pending) {
      await this.stop(taskId);
    }
  }

  /** Test helper: resolve the monitor promise for a task, simulating an overseer trigger */
  triggerVerdict(taskId: string, verdict: OverseerVerdict): void {
    const pending = this.pending.get(taskId);
    if (pending) {
      pending.resolve(verdict);
      this.pending.delete(taskId);
    }
  }
}
```

- [ ] Step 4: Run tests, verify PASS
**Run:** `npx vitest run src/hexagons/execution/infrastructure/composable-overseer.adapter.spec.ts`
**Expect:** PASS

- [ ] Step 5: Commit
**Run:** `git add src/hexagons/execution/infrastructure/composable-overseer.adapter.ts src/hexagons/execution/infrastructure/composable-overseer.adapter.spec.ts src/hexagons/execution/infrastructure/in-memory-overseer.adapter.ts && git commit -m "feat(S09/T06): ComposableOverseerAdapter + InMemoryOverseerAdapter"`

---

### T07: DefaultRetryPolicy

**Create:** `src/hexagons/execution/infrastructure/default-retry-policy.ts`
**Create:** `src/hexagons/execution/infrastructure/default-retry-policy.spec.ts`
**Depends on:** T04 (RetryPolicy port)
**Traces to:** AC2, AC4

- [ ] Step 1: Write failing tests

**File:** `src/hexagons/execution/infrastructure/default-retry-policy.spec.ts`
```typescript
import { describe, expect, it } from "vitest";
import { DefaultRetryPolicy } from "./default-retry-policy";

describe("DefaultRetryPolicy", () => {
  it("allows retry when under max retries", () => {
    const policy = new DefaultRetryPolicy(2, 3);
    const decision = policy.shouldRetry("task-1", "OVERSEER.TIMEOUT", 0);
    expect(decision.retry).toBe(true);
  });

  it("rejects retry when max retries reached", () => {
    const policy = new DefaultRetryPolicy(2, 3);
    const decision = policy.shouldRetry("task-1", "OVERSEER.TIMEOUT", 2);
    expect(decision.retry).toBe(false);
    expect(decision.reason).toContain("max retries");
  });

  it("detects retry loop via identical error signatures", () => {
    const policy = new DefaultRetryPolicy(5, 3);

    policy.recordFailure("task-1", "OVERSEER.TIMEOUT");
    policy.recordFailure("task-1", "OVERSEER.TIMEOUT");
    policy.recordFailure("task-1", "OVERSEER.TIMEOUT");

    const decision = policy.shouldRetry("task-1", "OVERSEER.TIMEOUT", 1);
    expect(decision.retry).toBe(false);
    expect(decision.reason).toContain("identical errors");
  });

  it("allows retry when errors are different", () => {
    const policy = new DefaultRetryPolicy(5, 3);

    policy.recordFailure("task-1", "OVERSEER.TIMEOUT");
    policy.recordFailure("task-1", "AGENT_DISPATCH.UNEXPECTED_FAILURE");
    policy.recordFailure("task-1", "OVERSEER.TIMEOUT");

    const decision = policy.shouldRetry("task-1", "OVERSEER.TIMEOUT", 1);
    expect(decision.retry).toBe(true);
  });

  it("reset clears failure history", () => {
    const policy = new DefaultRetryPolicy(5, 3);

    policy.recordFailure("task-1", "OVERSEER.TIMEOUT");
    policy.recordFailure("task-1", "OVERSEER.TIMEOUT");
    policy.recordFailure("task-1", "OVERSEER.TIMEOUT");
    policy.reset("task-1");

    const decision = policy.shouldRetry("task-1", "OVERSEER.TIMEOUT", 0);
    expect(decision.retry).toBe(true);
  });

  it("tracks failures per task independently", () => {
    const policy = new DefaultRetryPolicy(5, 3);

    policy.recordFailure("task-1", "OVERSEER.TIMEOUT");
    policy.recordFailure("task-1", "OVERSEER.TIMEOUT");
    policy.recordFailure("task-1", "OVERSEER.TIMEOUT");
    policy.recordFailure("task-2", "OVERSEER.TIMEOUT");

    expect(policy.shouldRetry("task-1", "OVERSEER.TIMEOUT", 1).retry).toBe(false);
    expect(policy.shouldRetry("task-2", "OVERSEER.TIMEOUT", 0).retry).toBe(true);
  });
});
```

- [ ] Step 2: Run tests, verify FAIL
**Run:** `npx vitest run src/hexagons/execution/infrastructure/default-retry-policy.spec.ts`
**Expect:** FAIL — module not found

- [ ] Step 3: Implement DefaultRetryPolicy

**File:** `src/hexagons/execution/infrastructure/default-retry-policy.ts`
```typescript
import type { RetryDecision } from "../domain/overseer.schemas";
import { RetryPolicy } from "../domain/ports/retry-policy.port";

export class DefaultRetryPolicy extends RetryPolicy {
  private readonly failures = new Map<string, string[]>();

  constructor(
    private readonly maxRetries: number,
    private readonly retryLoopThreshold: number,
  ) {
    super();
  }

  shouldRetry(taskId: string, errorCode: string, attempt: number): RetryDecision {
    if (attempt >= this.maxRetries) {
      return { retry: false, reason: `max retries exhausted (${this.maxRetries})` };
    }

    const signatures = this.failures.get(taskId) ?? [];
    if (signatures.length >= this.retryLoopThreshold) {
      const lastN = signatures.slice(-this.retryLoopThreshold);
      const allIdentical = lastN.every((s) => s === lastN[0]);
      if (allIdentical) {
        return {
          retry: false,
          reason: `${this.retryLoopThreshold} identical errors detected: ${lastN[0]}`,
        };
      }
    }

    return { retry: true, reason: `attempt ${attempt + 1} of ${this.maxRetries}` };
  }

  recordFailure(taskId: string, errorSignature: string): void {
    const signatures = this.failures.get(taskId) ?? [];
    signatures.push(errorSignature);
    this.failures.set(taskId, signatures);
  }

  reset(taskId: string): void {
    this.failures.delete(taskId);
  }
}
```

- [ ] Step 4: Run tests, verify PASS
**Run:** `npx vitest run src/hexagons/execution/infrastructure/default-retry-policy.spec.ts`
**Expect:** PASS

- [ ] Step 5: Commit
**Run:** `git add src/hexagons/execution/infrastructure/default-retry-policy.ts src/hexagons/execution/infrastructure/default-retry-policy.spec.ts && git commit -m "feat(S09/T07): DefaultRetryPolicy with error signature matching"`

---

## Wave 3 (depends on T02, T03, T04, T06, T07)

### T08: ExecuteSliceUseCase integration + exports

**Modify:** `src/hexagons/execution/application/execute-slice.use-case.ts`
**Modify:** `src/hexagons/execution/application/execute-slice.use-case.spec.ts`
**Modify:** `src/hexagons/execution/index.ts`
**Depends on:** T02, T03, T04, T06, T07
**Traces to:** AC1, AC2, AC3, AC4, AC5, AC6

- [ ] Step 1: Write failing integration tests

Add imports to `src/hexagons/execution/application/execute-slice.use-case.spec.ts`:
```typescript
import { InMemoryOverseerAdapter } from "../infrastructure/in-memory-overseer.adapter";
import { DefaultRetryPolicy } from "../infrastructure/default-retry-policy";
import type { OverseerConfig } from "../domain/overseer.schemas";
```

Add test variables in the `describe` block (after existing `let` declarations):
```typescript
let overseerAdapter: InMemoryOverseerAdapter;
let retryPolicy: DefaultRetryPolicy;
const OVERSEER_CONFIG: OverseerConfig = {
  enabled: true,
  timeouts: { S: 300000, "F-lite": 900000, "F-full": 1800000 },
  retryLoop: { threshold: 3 },
};
```

In `beforeEach`, add after `mockGitPort` initialization:
```typescript
overseerAdapter = new InMemoryOverseerAdapter();
retryPolicy = new DefaultRetryPolicy(2, 3);
```

Update `useCase` construction to include new deps:
```typescript
useCase = new ExecuteSliceUseCase({
  // ... existing deps ...
  overseer: overseerAdapter,
  retryPolicy,
  overseerConfig: OVERSEER_CONFIG,
});
```

Add test cases:
```typescript
// -----------------------------------------------------------------------
// Overseer integration
// -----------------------------------------------------------------------
describe("overseer integration", () => {
  it("aborts task when overseer triggers timeout (AC1)", async () => {
    const t1 = makeTask(T1_ID, "T01");
    taskRepo.seed(t1);

    // Configure delayed dispatch (agent takes long)
    agentDispatch.givenDelayedResult(
      T1_ID,
      ok(new AgentResultBuilder().withTaskId(T1_ID).asDone().build()),
      5000,
    );

    const executePromise = useCase.execute(makeInput());

    // After use case starts dispatch, trigger overseer timeout
    // InMemoryOverseerAdapter.monitor() is called during dispatch
    // We need to wait for it, then trigger
    await new Promise((r) => setTimeout(r, 10)); // let dispatch start
    overseerAdapter.triggerVerdict(T1_ID, {
      strategy: "timeout",
      reason: "Task exceeded S timeout of 300000ms",
    });

    const result = await executePromise;

    expect(result.ok).toBe(false);
    expect(agentDispatch.wasAborted(T1_ID)).toBe(true);

    // Verify journal entry
    const entries = await journalRepo.readAll(SLICE_ID);
    const interventions = entries.filter((e) => e.type === "overseer-intervention");
    expect(interventions.length).toBeGreaterThanOrEqual(1);
    expect(interventions[0]!.action).toBe("aborted");
  });

  it("retries task with enriched prompt when retry policy allows (AC4)", async () => {
    const t1 = makeTask(T1_ID, "T01");
    taskRepo.seed(t1);

    // First attempt: overseer triggers timeout
    agentDispatch.givenDelayedResult(
      T1_ID,
      ok(new AgentResultBuilder().withTaskId(T1_ID).asDone().build()),
      5000,
    );

    const executePromise = useCase.execute(makeInput());

    await new Promise((r) => setTimeout(r, 10));
    overseerAdapter.triggerVerdict(T1_ID, {
      strategy: "timeout",
      reason: "Task exceeded S timeout",
    });

    // After abort + retry, agent should be re-dispatched
    // Second attempt: agent succeeds immediately
    agentDispatch.givenResult(
      T1_ID,
      ok(new AgentResultBuilder().withTaskId(T1_ID).asDone().build()),
    );

    const result = await executePromise;

    // Verify retry happened (dispatch called at least twice)
    expect(agentDispatch.dispatchCount(T1_ID)).toBeGreaterThanOrEqual(2);

    // Verify retrying journal entry
    const entries = await journalRepo.readAll(SLICE_ID);
    const retrying = entries.filter(
      (e) => e.type === "overseer-intervention" && e.action === "retrying",
    );
    expect(retrying.length).toBeGreaterThanOrEqual(1);
  });

  it("escalates when retry policy denies retry (AC2)", async () => {
    // maxRetries=0 means no retries allowed
    const noRetryPolicy = new DefaultRetryPolicy(0, 3);
    useCase = new ExecuteSliceUseCase({
      taskRepository: taskRepo,
      waveDetection,
      checkpointRepository: checkpointRepo,
      agentDispatch,
      worktree: worktreeAdapter,
      eventBus,
      journalRepository: journalRepo,
      metricsRepository: metricsRepo,
      dateProvider,
      logger,
      templateContent: TEMPLATE_CONTENT,
      guardrail: guardrailAdapter,
      gitPort: mockGitPort,
      overseer: overseerAdapter,
      retryPolicy: noRetryPolicy,
      overseerConfig: OVERSEER_CONFIG,
    });

    const t1 = makeTask(T1_ID, "T01");
    taskRepo.seed(t1);

    agentDispatch.givenDelayedResult(
      T1_ID,
      ok(new AgentResultBuilder().withTaskId(T1_ID).asDone().build()),
      5000,
    );

    const executePromise = useCase.execute(makeInput());

    await new Promise((r) => setTimeout(r, 10));
    overseerAdapter.triggerVerdict(T1_ID, {
      strategy: "timeout",
      reason: "Task exceeded timeout",
    });

    const result = await executePromise;
    expect(result.ok).toBe(false);

    const entries = await journalRepo.readAll(SLICE_ID);
    const escalated = entries.filter(
      (e) => e.type === "overseer-intervention" && e.action === "escalated",
    );
    expect(escalated.length).toBeGreaterThanOrEqual(1);
  });

  it("does not monitor when overseer disabled (AC5)", async () => {
    const disabledConfig: OverseerConfig = { ...OVERSEER_CONFIG, enabled: false };
    useCase = new ExecuteSliceUseCase({
      taskRepository: taskRepo,
      waveDetection,
      checkpointRepository: checkpointRepo,
      agentDispatch,
      worktree: worktreeAdapter,
      eventBus,
      journalRepository: journalRepo,
      metricsRepository: metricsRepo,
      dateProvider,
      logger,
      templateContent: TEMPLATE_CONTENT,
      guardrail: guardrailAdapter,
      gitPort: mockGitPort,
      overseer: overseerAdapter,
      retryPolicy,
      overseerConfig: disabledConfig,
    });

    const t1 = makeTask(T1_ID, "T01");
    taskRepo.seed(t1);
    agentDispatch.givenResult(
      T1_ID,
      ok(new AgentResultBuilder().withTaskId(T1_ID).asDone().build()),
    );

    const result = await useCase.execute(makeInput());

    expect(result.ok).toBe(true);
    expect(overseerAdapter.monitorCalls.length).toBe(0);
  });

  it("stale-claim detection still works (AC6)", async () => {
    const staleTask = makeTask(T1_ID, "T01");
    // Manually set task to in_progress with old timestamp
    staleTask.start(new Date("2026-03-30T10:00:00Z")); // 2 hours ago
    taskRepo.seed(staleTask);

    agentDispatch.givenResult(
      T1_ID,
      ok(new AgentResultBuilder().withTaskId(T1_ID).asDone().build()),
    );

    const result = await useCase.execute(makeInput());

    // Task should be skipped (stale claim), not dispatched
    expect(agentDispatch.wasDispatched(T1_ID)).toBe(false);
    if (result.ok) {
      expect(result.data.skippedTasks).toContain(T1_ID);
    }
  });

  it("successful dispatch stops overseer monitor", async () => {
    const t1 = makeTask(T1_ID, "T01");
    taskRepo.seed(t1);
    agentDispatch.givenResult(
      T1_ID,
      ok(new AgentResultBuilder().withTaskId(T1_ID).asDone().build()),
    );

    const result = await useCase.execute(makeInput());

    expect(result.ok).toBe(true);
    // No intervention journal entries
    const entries = await journalRepo.readAll(SLICE_ID);
    const interventions = entries.filter((e) => e.type === "overseer-intervention");
    expect(interventions.length).toBe(0);
  });
});
```

- [ ] Step 2: Run tests, verify FAIL
**Run:** `npx vitest run src/hexagons/execution/application/execute-slice.use-case.spec.ts`
**Expect:** FAIL — missing overseer/retryPolicy deps in ExecuteSliceUseCaseDeps

- [ ] Step 3: Implement use case integration

**Modify:** `src/hexagons/execution/application/execute-slice.use-case.ts`

Add imports:
```typescript
import type { OverseerPort } from "../domain/ports/overseer.port";
import type { RetryPolicy } from "../domain/ports/retry-policy.port";
import type { OverseerConfig } from "../domain/overseer.schemas";
import { OverseerError } from "../domain/errors/overseer.error";
import type { OverseerInterventionEntry } from "../domain/journal-entry.schemas";
```

Add to `ExecuteSliceUseCaseDeps`:
```typescript
readonly overseer: OverseerPort;
readonly retryPolicy: RetryPolicy;
readonly overseerConfig: OverseerConfig;
```

Add private method on `ExecuteSliceUseCase`:
```typescript
private async executeTaskWithOverseer(
  task: Task,
  config: AgentDispatchConfig,
  input: ExecuteSliceInput,
  journalHandler: JournalEventHandler,
  waveIndex: number,
): Promise<Result<AgentResult, AgentDispatchError | OverseerError>> {
  const maxRetries = this.deps.overseerConfig.enabled
    ? /* read from autonomy.maxRetries via input or deps */ 2
    : 0;
  let currentConfig = config;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (!this.deps.overseerConfig.enabled) {
      // Overseer disabled — dispatch directly (no monitoring)
      return this.deps.agentDispatch.dispatch(currentConfig);
    }

    const monitorPromise = this.deps.overseer.monitor({
      taskId: task.id,
      sliceId: input.sliceId,
      complexityTier: input.complexity,
      dispatchTimestamp: this.deps.dateProvider.now(),
    });

    const dispatchPromise = this.deps.agentDispatch.dispatch(currentConfig);

    type RaceResult =
      | { type: "completed"; value: Result<AgentResult, AgentDispatchError> }
      | { type: "intervention"; verdict: OverseerVerdict };

    const raceResult: RaceResult = await Promise.race([
      dispatchPromise.then((r) => ({ type: "completed" as const, value: r })),
      monitorPromise.then((v) => ({ type: "intervention" as const, verdict: v })),
    ]);

    if (raceResult.type === "completed") {
      // Agent finished before overseer triggered — cancel monitor
      await this.deps.overseer.stop(task.id).catch(() => {});
      return raceResult.value;
    }

    // Overseer triggered — abort agent
    await this.deps.agentDispatch.abort(task.id);

    // Journal the abort
    const abortEntry: Omit<OverseerInterventionEntry, "seq"> = {
      type: "overseer-intervention",
      sliceId: input.sliceId,
      timestamp: this.deps.dateProvider.now(),
      taskId: task.id,
      strategy: raceResult.verdict.strategy,
      reason: raceResult.verdict.reason,
      action: "aborted",
      retryCount: attempt,
    };
    await this.deps.journalRepository.append(input.sliceId, abortEntry);

    // Check retry policy
    this.deps.retryPolicy.recordFailure(task.id, raceResult.verdict.strategy);
    const decision = this.deps.retryPolicy.shouldRetry(
      task.id,
      raceResult.verdict.strategy,
      attempt,
    );

    if (!decision.retry) {
      // Escalate
      const escalateEntry: Omit<OverseerInterventionEntry, "seq"> = {
        ...abortEntry,
        action: "escalated",
      };
      await this.deps.journalRepository.append(input.sliceId, escalateEntry);
      return err(OverseerError.timeout(task.id, raceResult.verdict.reason));
    }

    // Retry with enriched prompt
    const retryEntry: Omit<OverseerInterventionEntry, "seq"> = {
      ...abortEntry,
      action: "retrying",
    };
    await this.deps.journalRepository.append(input.sliceId, retryEntry);

    // Enrich prompt with error context
    currentConfig = {
      ...currentConfig,
      taskPrompt: `${currentConfig.taskPrompt}\n\n[OVERSEER] Previous attempt failed: ${raceResult.verdict.reason}. Avoid repeating the same approach.`,
    };
    // Cleanup before retry
    await this.deps.gitPort.restoreWorktree(input.workingDirectory);
  }

  return err(OverseerError.timeout(task.id, "max retries exhausted"));
}
```

**Key wiring:** The `maxRetries` value comes from `this.deps.overseerConfig` or the existing `autonomy.maxRetries` in settings. In the `ExecuteSliceUseCase` constructor, `DefaultRetryPolicy` is constructed with `settings.autonomy.maxRetries` and `settings.overseer.retryLoop.threshold` at the composition root (cli/extension.ts).

Replace the `Promise.allSettled(configs.map(...))` dispatch block (line ~193-196) with:
```typescript
const settled = await Promise.allSettled(
  waveTasks.map((task, i) =>
    this.executeTaskWithOverseer(task, configs[i]!, input, journalHandler, waveIndex),
  ),
);
```

The post-settlement guardrail validation, checkpoint saves, and result processing remain **unchanged**.

- [ ] Step 4: Run tests, verify PASS
**Run:** `npx vitest run src/hexagons/execution/application/execute-slice.use-case.spec.ts`
**Expect:** PASS — all existing + new tests green

- [ ] Step 5: Update exports and commit

**Modify:** `src/hexagons/execution/index.ts` — Add after existing exports:

```typescript
// Domain -- Overseer Schemas
export type {
  InterventionAction,
  OverseerConfig,
  OverseerContext,
  OverseerVerdict,
  RetryDecision,
} from "./domain/overseer.schemas";
export {
  InterventionActionSchema,
  OverseerConfigSchema,
  OverseerContextSchema,
  OverseerVerdictSchema,
  RetryDecisionSchema,
} from "./domain/overseer.schemas";
// Domain -- Overseer Strategy
export type { OverseerStrategy } from "./domain/overseer-strategy";
// Domain -- Overseer Errors
export { OverseerError } from "./domain/errors/overseer.error";
// Domain -- Overseer Journal Entry
export type { OverseerInterventionEntry } from "./domain/journal-entry.schemas";
export { OverseerInterventionEntrySchema } from "./domain/journal-entry.schemas";
// Domain -- Overseer Ports
export { OverseerPort } from "./domain/ports/overseer.port";
export { RetryPolicy } from "./domain/ports/retry-policy.port";
// Infrastructure -- Overseer Adapters
export { ComposableOverseerAdapter } from "./infrastructure/composable-overseer.adapter";
export { DefaultRetryPolicy } from "./infrastructure/default-retry-policy";
export { InMemoryOverseerAdapter } from "./infrastructure/in-memory-overseer.adapter";
export { TimeoutStrategy } from "./infrastructure/timeout-strategy";
```

**Run:** `git add src/hexagons/execution/application/execute-slice.use-case.ts src/hexagons/execution/application/execute-slice.use-case.spec.ts src/hexagons/execution/index.ts && git commit -m "feat(S09/T08): overseer integration in ExecuteSliceUseCase + exports"`
