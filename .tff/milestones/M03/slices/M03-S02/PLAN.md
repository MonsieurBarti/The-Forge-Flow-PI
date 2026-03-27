# M03-S02: Autonomy Modes — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Add autonomy decision logic (`shouldAutoTransition`), Escalation VO, and `WorkflowEscalationRaisedEvent` to the workflow hexagon.
**Architecture:** Pure function + aggregate query, VO extends `ValueObject`, event follows `WorkflowPhaseChangedEvent` pattern.
**Tech Stack:** TypeScript, Zod, Vitest, kernel base classes.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/kernel/event-names.ts` | MODIFY | Add `WORKFLOW_ESCALATION_RAISED` |
| `src/hexagons/workflow/domain/workflow-session.schemas.ts` | MODIFY | Add `EscalationPropsSchema`, `AutoTransitionDecisionSchema`, extend `GuardContextSchema` + `WorkflowSessionPropsSchema` |
| `src/hexagons/workflow/domain/autonomy-policy.ts` | CREATE | Pure `shouldAutoTransition` + `getHumanGates` functions |
| `src/hexagons/workflow/domain/autonomy-policy.spec.ts` | CREATE | Tests for AC1-5, AC8 |
| `src/hexagons/workflow/domain/escalation.vo.ts` | CREATE | `Escalation` value object |
| `src/hexagons/workflow/domain/escalation.vo.spec.ts` | CREATE | Tests for AC6 |
| `src/hexagons/workflow/domain/events/workflow-escalation-raised.event.ts` | CREATE | Escalation event class |
| `src/hexagons/workflow/domain/workflow-session.aggregate.ts` | MODIFY | Add `shouldAutoTransition` getter, escalation emission in `applyTransition`, `lastEscalation` getter |
| `src/hexagons/workflow/domain/workflow-session.aggregate.spec.ts` | MODIFY | Tests for AC7-9 |
| `src/hexagons/workflow/domain/workflow-session.builder.ts` | MODIFY | Add `withLastEscalation` method |
| `src/hexagons/workflow/index.ts` | MODIFY | Export new types |

---

## Wave 0 (no dependencies)

### T01: Add schemas and extend kernel event names

**Files:**
- Modify `src/kernel/event-names.ts`
- Modify `src/hexagons/workflow/domain/workflow-session.schemas.ts`

**Traces to:** Foundation for AC1-9

#### Step 1: Add `WORKFLOW_ESCALATION_RAISED` to kernel EVENT_NAMES

**File:** `src/kernel/event-names.ts`

Add to `EVENT_NAMES` object:
```typescript
WORKFLOW_ESCALATION_RAISED: "workflow.escalation-raised",
```

Add to `EventNameSchema` z.enum array:
```typescript
EVENT_NAMES.WORKFLOW_ESCALATION_RAISED,
```

#### Step 2: Add new schemas to `workflow-session.schemas.ts`

**File:** `src/hexagons/workflow/domain/workflow-session.schemas.ts`

Add import at top:
```typescript
import { IdSchema, TimestampSchema } from "@kernel";
```

Note: `IdSchema` and `TimestampSchema` are already imported on line 2. No new import needed.

Add after `GuardContextSchema` (line 70):
```typescript
export const EscalationPropsSchema = z.object({
  sliceId: IdSchema,
  phase: WorkflowPhaseSchema,
  reason: z.string(),
  attempts: z.number().int().min(1),
  lastError: z.string().nullable(),
  occurredAt: TimestampSchema,
});
export type EscalationProps = z.infer<typeof EscalationPropsSchema>;

export const AutoTransitionDecisionSchema = z.object({
  autoTransition: z.boolean(),
  isHumanGate: z.boolean(),
});
export type AutoTransitionDecision = z.infer<typeof AutoTransitionDecisionSchema>;
```

Extend `GuardContextSchema` — add `lastError` field:
```typescript
export const GuardContextSchema = z.object({
  complexityTier: ComplexityTierSchema.nullable(),
  retryCount: z.number().int().min(0),
  maxRetries: z.number().int().min(0),
  allSlicesClosed: z.boolean(),
  lastError: z.string().nullable().default(null),
});
```

Extend `WorkflowSessionPropsSchema` — add `lastEscalation` field:
```typescript
lastEscalation: EscalationPropsSchema.nullable().default(null),
```

#### Step 3: Run typecheck

```bash
npx tsc --noEmit
```

**Expect:** PASS — no type errors (schemas are additive, defaults ensure backward compat).

#### Step 4: Commit

```bash
git add src/kernel/event-names.ts src/hexagons/workflow/domain/workflow-session.schemas.ts
git commit -m "$(cat <<'EOF'
feat(S02/T01): add escalation schemas and event name

Add EscalationPropsSchema, AutoTransitionDecisionSchema, extend
GuardContextSchema with lastError, extend WorkflowSessionPropsSchema
with lastEscalation. Add WORKFLOW_ESCALATION_RAISED to kernel.
EOF
)"
```

---

## Wave 1 (depends on T01 — T02, T03, T04 are parallel)

### T02: Implement autonomy policy pure functions

**Files:**
- Create `src/hexagons/workflow/domain/autonomy-policy.spec.ts`
- Create `src/hexagons/workflow/domain/autonomy-policy.ts`

**Traces to:** AC1, AC2, AC3, AC4, AC5

#### Step 1: Write failing tests

**File:** `src/hexagons/workflow/domain/autonomy-policy.spec.ts`
```typescript
import { describe, expect, it } from "vitest";
import { ACTIVE_PHASES } from "./transition-table";
import { getHumanGates, shouldAutoTransition } from "./autonomy-policy";
import type { WorkflowPhase } from "./workflow-session.schemas";

const NON_ACTIVE_PHASES: WorkflowPhase[] = ["idle", "paused", "blocked", "completing-milestone"];
const PLAN_TO_PR_GATES: WorkflowPhase[] = ["planning", "reviewing", "shipping"];

describe("shouldAutoTransition", () => {
  describe("guided mode", () => {
    it.each([...ACTIVE_PHASES])("returns autoTransition=false for active phase '%s'", (phase) => {
      const decision = shouldAutoTransition(phase, "guided");
      expect(decision.autoTransition).toBe(false);
      expect(decision.isHumanGate).toBe(true);
    });

    it.each(NON_ACTIVE_PHASES)("returns autoTransition=false, isHumanGate=false for non-active phase '%s'", (phase) => {
      const decision = shouldAutoTransition(phase, "guided");
      expect(decision.autoTransition).toBe(false);
      expect(decision.isHumanGate).toBe(false);
    });
  });

  describe("plan-to-pr mode", () => {
    it.each(PLAN_TO_PR_GATES)("returns autoTransition=false for gate phase '%s'", (phase) => {
      const decision = shouldAutoTransition(phase, "plan-to-pr");
      expect(decision.autoTransition).toBe(false);
      expect(decision.isHumanGate).toBe(true);
    });

    const nonGateActivePhases = [...ACTIVE_PHASES].filter((p) => !PLAN_TO_PR_GATES.includes(p));

    it.each(nonGateActivePhases)("returns autoTransition=true for non-gate active phase '%s'", (phase) => {
      const decision = shouldAutoTransition(phase, "plan-to-pr");
      expect(decision.autoTransition).toBe(true);
      expect(decision.isHumanGate).toBe(false);
    });

    it.each(NON_ACTIVE_PHASES)("returns autoTransition=false, isHumanGate=false for non-active phase '%s'", (phase) => {
      const decision = shouldAutoTransition(phase, "plan-to-pr");
      expect(decision.autoTransition).toBe(false);
      expect(decision.isHumanGate).toBe(false);
    });
  });
});

describe("getHumanGates", () => {
  it("returns all active phases for guided mode", () => {
    const gates = getHumanGates("guided");
    expect(gates).toEqual(ACTIVE_PHASES);
  });

  it("returns exactly planning, reviewing, shipping for plan-to-pr mode", () => {
    const gates = getHumanGates("plan-to-pr");
    expect(gates).toEqual(new Set(["planning", "reviewing", "shipping"]));
  });
});
```

#### Step 2: Run tests, verify FAIL

```bash
npx vitest run src/hexagons/workflow/domain/autonomy-policy.spec.ts
```

**Expect:** FAIL — `Cannot find module './autonomy-policy'`

#### Step 3: Implement

**File:** `src/hexagons/workflow/domain/autonomy-policy.ts`
```typescript
import type { AutonomyMode } from "@hexagons/settings";
import { ACTIVE_PHASES } from "./transition-table";
import type { AutoTransitionDecision, WorkflowPhase } from "./workflow-session.schemas";

const PLAN_TO_PR_GATES: ReadonlySet<WorkflowPhase> = new Set([
  "planning",
  "reviewing",
  "shipping",
]);

const HUMAN_GATES: Record<AutonomyMode, ReadonlySet<WorkflowPhase>> = {
  "guided": ACTIVE_PHASES,
  "plan-to-pr": PLAN_TO_PR_GATES,
};

export function shouldAutoTransition(
  phase: WorkflowPhase,
  mode: AutonomyMode,
): AutoTransitionDecision {
  const gates = HUMAN_GATES[mode];

  if (!ACTIVE_PHASES.has(phase)) {
    return { autoTransition: false, isHumanGate: false };
  }

  if (gates.has(phase)) {
    return { autoTransition: false, isHumanGate: true };
  }

  return { autoTransition: true, isHumanGate: false };
}

export function getHumanGates(
  mode: AutonomyMode,
): ReadonlySet<WorkflowPhase> {
  return HUMAN_GATES[mode];
}
```

#### Step 4: Run tests, verify PASS

```bash
npx vitest run src/hexagons/workflow/domain/autonomy-policy.spec.ts
```

**Expect:** PASS — all tests green.

#### Step 5: Commit

```bash
git add src/hexagons/workflow/domain/autonomy-policy.ts src/hexagons/workflow/domain/autonomy-policy.spec.ts
git commit -m "$(cat <<'EOF'
feat(S02/T02): implement autonomy policy pure functions

shouldAutoTransition and getHumanGates with declarative gate map.
Guided mode gates all active phases; plan-to-pr gates planning,
reviewing, shipping only.
EOF
)"
```

---

### T03: Implement Escalation value object

**Files:**
- Create `src/hexagons/workflow/domain/escalation.vo.spec.ts`
- Create `src/hexagons/workflow/domain/escalation.vo.ts`

**Traces to:** AC6

#### Step 1: Write failing tests

**File:** `src/hexagons/workflow/domain/escalation.vo.spec.ts`
```typescript
import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";
import { Escalation } from "./escalation.vo";

describe("Escalation", () => {
  describe("create", () => {
    it("creates an escalation with provided props", () => {
      const props = {
        sliceId: faker.string.uuid(),
        phase: "planning" as const,
        reason: "Retries exhausted",
        attempts: 3,
        lastError: "Guard rejected",
        occurredAt: new Date(),
      };
      const escalation = Escalation.create(props);
      expect(escalation.sliceId).toBe(props.sliceId);
      expect(escalation.phase).toBe("planning");
      expect(escalation.attempts).toBe(3);
      expect(escalation.lastError).toBe("Guard rejected");
    });
  });

  describe("fromRetryExhaustion", () => {
    it("creates escalation with correct reason and summary", () => {
      const sliceId = faker.string.uuid();
      const escalation = Escalation.fromRetryExhaustion(sliceId, "planning", 3, "Last error msg");
      expect(escalation.sliceId).toBe(sliceId);
      expect(escalation.phase).toBe("planning");
      expect(escalation.attempts).toBe(3);
      expect(escalation.reason).toContain("Retries exhausted");
      expect(escalation.lastError).toBe("Last error msg");
      expect(escalation.occurredAt).toBeInstanceOf(Date);
    });

    it("creates escalation with null lastError", () => {
      const escalation = Escalation.fromRetryExhaustion(faker.string.uuid(), "verifying", 2, null);
      expect(escalation.lastError).toBeNull();
      expect(escalation.attempts).toBe(2);
    });

    it("produces a human-readable summary", () => {
      const sliceId = faker.string.uuid();
      const escalation = Escalation.fromRetryExhaustion(sliceId, "planning", 3, null);
      expect(escalation.summary).toBe(
        `Slice ${sliceId}: blocked at planning after 3 attempts`,
      );
    });
  });

  describe("equals", () => {
    it("returns true for same props", () => {
      const props = {
        sliceId: faker.string.uuid(),
        phase: "planning" as const,
        reason: "Retries exhausted",
        attempts: 3,
        lastError: null,
        occurredAt: new Date("2026-01-01"),
      };
      expect(Escalation.create(props).equals(Escalation.create(props))).toBe(true);
    });
  });
});
```

#### Step 2: Run tests, verify FAIL

```bash
npx vitest run src/hexagons/workflow/domain/escalation.vo.spec.ts
```

**Expect:** FAIL — `Cannot find module './escalation.vo'`

#### Step 3: Implement

**File:** `src/hexagons/workflow/domain/escalation.vo.ts`
```typescript
import { ValueObject } from "@kernel";
import { type EscalationProps, EscalationPropsSchema, type WorkflowPhase } from "./workflow-session.schemas";

export class Escalation extends ValueObject<EscalationProps> {
  private constructor(props: EscalationProps) {
    super(props, EscalationPropsSchema);
  }

  static create(props: EscalationProps): Escalation {
    return new Escalation(props);
  }

  static fromRetryExhaustion(
    sliceId: string,
    phase: WorkflowPhase,
    retryCount: number,
    lastError: string | null,
  ): Escalation {
    return new Escalation({
      sliceId,
      phase,
      reason: `Retries exhausted at ${phase}`,
      attempts: retryCount,
      lastError,
      occurredAt: new Date(),
    });
  }

  get sliceId(): string {
    return this.props.sliceId;
  }

  get phase(): WorkflowPhase {
    return this.props.phase;
  }

  get reason(): string {
    return this.props.reason;
  }

  get attempts(): number {
    return this.props.attempts;
  }

  get lastError(): string | null {
    return this.props.lastError;
  }

  get occurredAt(): Date {
    return this.props.occurredAt;
  }

  get toProps(): EscalationProps {
    return { ...this.props };
  }

  get summary(): string {
    return `Slice ${this.props.sliceId}: blocked at ${this.props.phase} after ${this.props.attempts} attempts`;
  }
}
```

#### Step 4: Run tests, verify PASS

```bash
npx vitest run src/hexagons/workflow/domain/escalation.vo.spec.ts
```

**Expect:** PASS — all tests green.

#### Step 5: Commit

```bash
git add src/hexagons/workflow/domain/escalation.vo.ts src/hexagons/workflow/domain/escalation.vo.spec.ts
git commit -m "$(cat <<'EOF'
feat(S02/T03): implement Escalation value object

Escalation VO with create and fromRetryExhaustion factories,
summary getter, and Zod-validated props via ValueObject base.
EOF
)"
```

---

### T04: Implement WorkflowEscalationRaisedEvent

**Files:**
- Create `src/hexagons/workflow/domain/events/workflow-escalation-raised.event.ts`

**Traces to:** AC7 (event definition)

#### Step 1: Implement event class

**File:** `src/hexagons/workflow/domain/events/workflow-escalation-raised.event.ts`
```typescript
import { DomainEvent, DomainEventPropsSchema, EVENT_NAMES, type EventName } from "@kernel";
import { z } from "zod";
import { EscalationPropsSchema } from "../workflow-session.schemas";

const WorkflowEscalationRaisedEventPropsSchema = DomainEventPropsSchema.extend({
  escalation: EscalationPropsSchema,
});

type WorkflowEscalationRaisedEventProps = z.infer<typeof WorkflowEscalationRaisedEventPropsSchema>;

export class WorkflowEscalationRaisedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.WORKFLOW_ESCALATION_RAISED;
  readonly escalation: z.infer<typeof EscalationPropsSchema>;

  constructor(props: WorkflowEscalationRaisedEventProps) {
    const parsed = WorkflowEscalationRaisedEventPropsSchema.parse(props);
    super(parsed);
    this.escalation = parsed.escalation;
  }
}
```

#### Step 2: Run typecheck

```bash
npx tsc --noEmit
```

**Expect:** PASS.

#### Step 3: Commit

```bash
git add src/hexagons/workflow/domain/events/workflow-escalation-raised.event.ts
git commit -m "$(cat <<'EOF'
feat(S02/T04): add WorkflowEscalationRaisedEvent

Domain event emitted when workflow transitions to blocked.
Carries full EscalationProps payload.
EOF
)"
```

---

## Wave 2 (depends on T02, T03, T04)

### T05: Modify aggregate — add autonomy getter, escalation emission, lastEscalation

**Files:**
- Modify `src/hexagons/workflow/domain/workflow-session.aggregate.ts`
- Modify `src/hexagons/workflow/domain/workflow-session.aggregate.spec.ts`
- Modify `src/hexagons/workflow/domain/workflow-session.builder.ts`

**Traces to:** AC7, AC8, AC9

#### Step 1: Write failing tests

**File:** `src/hexagons/workflow/domain/workflow-session.aggregate.spec.ts`

Add new imports at top:
```typescript
import { Escalation } from "./escalation.vo";
import { WorkflowEscalationRaisedEvent } from "./events/workflow-escalation-raised.event";
import { shouldAutoTransition } from "./autonomy-policy";
```

Add new describe blocks at the end (inside the root `describe("WorkflowSession")`):
```typescript
  describe("shouldAutoTransition getter", () => {
    it("delegates to pure shouldAutoTransition function for guided mode", () => {
      const session = new WorkflowSessionBuilder()
        .withCurrentPhase("discussing")
        .withAutonomyMode("guided")
        .build();
      expect(session.shouldAutoTransition).toBe(false);
      expect(session.shouldAutoTransition).toBe(
        shouldAutoTransition("discussing", "guided").autoTransition,
      );
    });

    it("returns true for non-gate phase in plan-to-pr mode", () => {
      const session = new WorkflowSessionBuilder()
        .withCurrentPhase("discussing")
        .withAutonomyMode("plan-to-pr")
        .build();
      expect(session.shouldAutoTransition).toBe(true);
    });

    it("returns false for gate phase in plan-to-pr mode", () => {
      const session = new WorkflowSessionBuilder()
        .withCurrentPhase("planning")
        .withAutonomyMode("plan-to-pr")
        .build();
      expect(session.shouldAutoTransition).toBe(false);
    });
  });

  describe("escalation on blocked transition", () => {
    it("emits WorkflowEscalationRaisedEvent when transitioning to blocked", () => {
      const sliceId = faker.string.uuid();
      const session = new WorkflowSessionBuilder()
        .withCurrentPhase("executing")
        .withSliceId(sliceId)
        .withRetryCount(2)
        .build();

      const ctx: GuardContext = {
        complexityTier: "F-lite",
        retryCount: 2,
        maxRetries: 2,
        allSlicesClosed: false,
        lastError: "Test failed: expected 1 but got 2",
      };

      const result = session.trigger("fail", ctx, new Date());
      expect(result.ok).toBe(true);
      expect(session.currentPhase).toBe("blocked");

      const events = session.pullEvents();
      const phaseEvent = events.find((e) => e.eventName === "workflow.phase-changed");
      const escalationEvent = events.find(
        (e): e is WorkflowEscalationRaisedEvent =>
          e.eventName === "workflow.escalation-raised",
      );

      expect(phaseEvent).toBeDefined();
      expect(escalationEvent).toBeDefined();
      expect(escalationEvent!.escalation.sliceId).toBe(sliceId);
      expect(escalationEvent!.escalation.phase).toBe("executing");
      expect(escalationEvent!.escalation.attempts).toBe(2);
      expect(escalationEvent!.escalation.lastError).toBe("Test failed: expected 1 but got 2");
    });

    it("stores escalation on aggregate accessible via lastEscalation", () => {
      const sliceId = faker.string.uuid();
      const session = new WorkflowSessionBuilder()
        .withCurrentPhase("executing")
        .withSliceId(sliceId)
        .withRetryCount(2)
        .build();

      expect(session.lastEscalation).toBeNull();

      const ctx: GuardContext = {
        complexityTier: "F-lite",
        retryCount: 2,
        maxRetries: 2,
        allSlicesClosed: false,
        lastError: null,
      };

      session.trigger("fail", ctx, new Date());

      expect(session.lastEscalation).not.toBeNull();
      expect(session.lastEscalation!.sliceId).toBe(sliceId);
      expect(session.lastEscalation!.phase).toBe("executing");
    });
  });
```

#### Step 2: Run tests, verify FAIL

```bash
npx vitest run src/hexagons/workflow/domain/workflow-session.aggregate.spec.ts
```

**Expect:** FAIL — `session.shouldAutoTransition is not a function/property`, `session.lastEscalation is not a function/property`

#### Step 3: Implement aggregate modifications

**File:** `src/hexagons/workflow/domain/workflow-session.aggregate.ts`

Add imports:
```typescript
import { shouldAutoTransition as shouldAutoTransitionFn } from "./autonomy-policy";
import { Escalation } from "./escalation.vo";
import { WorkflowEscalationRaisedEvent } from "./events/workflow-escalation-raised.event";
import type { EscalationProps } from "./workflow-session.schemas";
```

Add getters after `get updatedAt()`:
```typescript
  get shouldAutoTransition(): boolean {
    return shouldAutoTransitionFn(this.props.currentPhase, this.props.autonomyMode).autoTransition;
  }

  get lastEscalation(): Escalation | null {
    return this.props.lastEscalation
      ? Escalation.create(this.props.lastEscalation)
      : null;
  }
```

Modify `applyTransition` — add escalation logic after `this.props.updatedAt = now;` and before `this.addEvent(new WorkflowPhaseChangedEvent(...))`:
```typescript
    if (toPhase === "blocked" && this.props.sliceId) {
      const escalation = Escalation.fromRetryExhaustion(
        this.props.sliceId,
        fromPhase,
        this.props.retryCount,
        ctx.lastError ?? null,
      );
      this.props.lastEscalation = escalation.toProps;

      this.addEvent(
        new WorkflowEscalationRaisedEvent({
          id: crypto.randomUUID(),
          aggregateId: this.props.id,
          occurredAt: now,
          escalation: escalation.toProps,
        }),
      );
    }
```

Note: The `applyTransition` method signature needs to accept `ctx` — update it:
```typescript
  private applyTransition(
    rule: TransitionRule,
    fromPhase: WorkflowPhase,
    trigger: WorkflowTrigger,
    now: Date,
    ctx: GuardContext,
  ): Result<void, WorkflowBaseError> {
```

And update the call site in `trigger()`:
```typescript
      return this.applyTransition(rule, fromPhase, trigger, now, ctx);
```

Also update builder to support `lastEscalation`:

**File:** `src/hexagons/workflow/domain/workflow-session.builder.ts`

Add import:
```typescript
import type { EscalationProps } from "./workflow-session.schemas";
```

Add field and method:
```typescript
  private _lastEscalation: EscalationProps | null = null;

  withLastEscalation(escalation: EscalationProps): this {
    this._lastEscalation = escalation;
    return this;
  }
```

Add to `buildProps()`:
```typescript
      lastEscalation: this._lastEscalation,
```

#### Step 4: Run tests, verify PASS

```bash
npx vitest run src/hexagons/workflow/domain/workflow-session.aggregate.spec.ts
```

**Expect:** PASS — all tests green (existing + new).

#### Step 5: Commit

```bash
git add src/hexagons/workflow/domain/workflow-session.aggregate.ts src/hexagons/workflow/domain/workflow-session.aggregate.spec.ts src/hexagons/workflow/domain/workflow-session.builder.ts
git commit -m "$(cat <<'EOF'
feat(S02/T05): add autonomy getter and escalation emission to aggregate

WorkflowSession.shouldAutoTransition delegates to pure function.
applyTransition emits WorkflowEscalationRaisedEvent and stores
Escalation on props when transitioning to blocked.
EOF
)"
```

---

## Wave 3 (depends on T05)

### T06: Update barrel exports and run full test suite

**Files:**
- Modify `src/hexagons/workflow/index.ts`

**Traces to:** All AC (integration)

#### Step 1: Update barrel exports

**File:** `src/hexagons/workflow/index.ts`

Add to events section:
```typescript
export { WorkflowEscalationRaisedEvent } from "./domain/events/workflow-escalation-raised.event";
```

Add new domain section:
```typescript
// Domain — Autonomy Policy
export { getHumanGates, shouldAutoTransition } from "./domain/autonomy-policy";

// Domain — Escalation
export { Escalation } from "./domain/escalation.vo";
```

Add to schema type exports:
```typescript
export type {
  AutoTransitionDecision,
  EscalationProps,
  // ... existing types ...
} from "./domain/workflow-session.schemas";
export {
  AutoTransitionDecisionSchema,
  EscalationPropsSchema,
  // ... existing schemas ...
} from "./domain/workflow-session.schemas";
```

#### Step 2: Run full test suite

```bash
npx vitest run
```

**Expect:** PASS — all tests green, no regressions.

#### Step 3: Run typecheck

```bash
npx tsc --noEmit
```

**Expect:** PASS.

#### Step 4: Commit

```bash
git add src/hexagons/workflow/index.ts
git commit -m "$(cat <<'EOF'
feat(S02/T06): export autonomy policy, escalation, and event from barrel

Add shouldAutoTransition, getHumanGates, Escalation, EscalationPropsSchema,
AutoTransitionDecisionSchema, and WorkflowEscalationRaisedEvent to
workflow hexagon public API.
EOF
)"
```

---

## Wave Summary

| Wave | Tasks | Parallel? |
|---|---|---|
| 0 | T01 (schemas + event name) | Solo — foundation for all others |
| 1 | T02 (autonomy policy), T03 (escalation VO), T04 (event class) | Yes — all depend only on T01, no mutual deps |
| 2 | T05 (aggregate mods) | Solo — depends on T02, T03, T04 |
| 3 | T06 (barrel + full suite) | Solo — depends on T05 |

## Dependency Graph

```
                            ┌─→ T02 (autonomy policy) ─┐
T01 (schemas + event name) ─┼─→ T03 (escalation VO) ───┼─→ T05 (aggregate) ──→ T06 (barrel)
                            └─→ T04 (event class) ─────┘
```
