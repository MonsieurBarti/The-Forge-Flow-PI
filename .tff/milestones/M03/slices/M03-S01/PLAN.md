# M03-S01: WorkflowSession Aggregate + State Machine — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Build the WorkflowSession aggregate with declarative transition table, guard functions, pause/resume, repository port + in-memory adapter.
**Architecture:** Hexagonal — all files in `src/hexagons/workflow/`, imports only from `@kernel` and `@hexagons/settings`.
**Tech Stack:** TypeScript, Zod, Vitest, Faker

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| EXTEND | `src/hexagons/workflow/domain/workflow-session.schemas.ts` | Add GuardName, TransitionEffect, GuardContext, TransitionRule schemas |
| CREATE | `src/hexagons/workflow/domain/errors/workflow-base.error.ts` | Abstract base error for workflow hexagon |
| CREATE | `src/hexagons/workflow/domain/errors/no-matching-transition.error.ts` | No rule matches phase + trigger |
| CREATE | `src/hexagons/workflow/domain/errors/guard-rejected.error.ts` | All guards failed |
| CREATE | `src/hexagons/workflow/domain/errors/slice-already-assigned.error.ts` | assignSlice when slice exists |
| CREATE | `src/hexagons/workflow/domain/errors/no-slice-assigned.error.ts` | Trigger requiring slice when none |
| CREATE | `src/hexagons/workflow/domain/events/workflow-phase-changed.event.ts` | Domain event with extra props |
| CREATE | `src/hexagons/workflow/domain/transition-table.ts` | 19-rule TRANSITION_TABLE + ACTIVE_PHASES + evaluateGuard |
| CREATE | `src/hexagons/workflow/domain/transition-table.spec.ts` | Tests for table structure, guard evaluation, rule matching |
| CREATE | `src/hexagons/workflow/domain/workflow-session.aggregate.ts` | WorkflowSession aggregate root |
| CREATE | `src/hexagons/workflow/domain/workflow-session.aggregate.spec.ts` | Full transition coverage + business methods |
| CREATE | `src/hexagons/workflow/domain/workflow-session.builder.ts` | Test builder with fluent API |
| CREATE | `src/hexagons/workflow/domain/ports/workflow-session.repository.port.ts` | Abstract repository |
| CREATE | `src/hexagons/workflow/infrastructure/in-memory-workflow-session.repository.ts` | Map-based in-memory impl |
| CREATE | `src/hexagons/workflow/infrastructure/in-memory-workflow-session.repository.spec.ts` | Repository tests |
| UPDATE | `src/hexagons/workflow/index.ts` | Export new types, errors, events, ports |

---

### Task 1: Extend schemas with guard, effect, and transition rule types

**Files:**
- Modify: `src/hexagons/workflow/domain/workflow-session.schemas.ts`
- Modify: `src/hexagons/workflow/domain/workflow-session.schemas.spec.ts`

**Traces to:** AC1, AC2

**Steps:**

- [ ] Step 1: Write failing tests for new schemas

```typescript
// In workflow-session.schemas.spec.ts — add these describe blocks:

describe("GuardNameSchema", () => {
  const validGuards = ["notSTier", "isSTier", "allSlicesClosed", "retriesExhausted"];

  it.each(validGuards)("accepts '%s'", (guard) => {
    expect(GuardNameSchema.parse(guard)).toBe(guard);
  });

  it("rejects invalid guard", () => {
    expect(() => GuardNameSchema.parse("unknownGuard")).toThrow();
  });
});

describe("TransitionEffectSchema", () => {
  const validEffects = [
    "incrementRetry", "savePreviousPhase", "restorePreviousPhase",
    "resetRetryCount", "clearSlice",
  ];

  it.each(validEffects)("accepts '%s'", (effect) => {
    expect(TransitionEffectSchema.parse(effect)).toBe(effect);
  });
});

describe("GuardContextSchema", () => {
  it("parses valid guard context", () => {
    const ctx = GuardContextSchema.parse({
      complexityTier: "S",
      retryCount: 0,
      maxRetries: 2,
      allSlicesClosed: false,
    });
    expect(ctx.complexityTier).toBe("S");
  });

  it("accepts null complexity tier", () => {
    const ctx = GuardContextSchema.parse({
      complexityTier: null,
      retryCount: 0,
      maxRetries: 2,
      allSlicesClosed: false,
    });
    expect(ctx.complexityTier).toBeNull();
  });
});

describe("TransitionRuleSchema", () => {
  it("parses rule with guard and effects", () => {
    const rule = TransitionRuleSchema.parse({
      from: "discussing",
      trigger: "next",
      to: "researching",
      guard: "notSTier",
      effects: [],
    });
    expect(rule.guard).toBe("notSTier");
  });

  it("accepts *active* wildcard as from", () => {
    const rule = TransitionRuleSchema.parse({
      from: "*active*",
      trigger: "pause",
      to: "paused",
    });
    expect(rule.from).toBe("*active*");
  });

  it("accepts *previousPhase* wildcard as to", () => {
    const rule = TransitionRuleSchema.parse({
      from: "paused",
      trigger: "resume",
      to: "*previousPhase*",
    });
    expect(rule.to).toBe("*previousPhase*");
  });

  it("defaults effects to empty array", () => {
    const rule = TransitionRuleSchema.parse({
      from: "idle",
      trigger: "start",
      to: "discussing",
    });
    expect(rule.effects).toEqual([]);
  });
});
```

- [ ] Step 2: Run `npx vitest run src/hexagons/workflow/domain/workflow-session.schemas.spec.ts`, verify FAIL (imports not found)

- [ ] Step 3: Implement schemas

```typescript
// Add to workflow-session.schemas.ts:

import { ComplexityTierSchema } from "@kernel";

export const GuardNameSchema = z.enum(["notSTier", "isSTier", "allSlicesClosed", "retriesExhausted"]);
export type GuardName = z.infer<typeof GuardNameSchema>;

export const TransitionEffectSchema = z.enum([
  "incrementRetry",
  "savePreviousPhase",
  "restorePreviousPhase",
  "resetRetryCount",
  "clearSlice",
]);
export type TransitionEffect = z.infer<typeof TransitionEffectSchema>;

export const GuardContextSchema = z.object({
  complexityTier: ComplexityTierSchema.nullable(),
  retryCount: z.number().int().min(0),
  maxRetries: z.number().int().min(0),
  allSlicesClosed: z.boolean(),
});
export type GuardContext = z.infer<typeof GuardContextSchema>;

export const TransitionRuleSchema = z.object({
  from: WorkflowPhaseSchema.or(z.literal("*active*")),
  trigger: WorkflowTriggerSchema,
  to: WorkflowPhaseSchema.or(z.literal("*previousPhase*")),
  guard: GuardNameSchema.optional(),
  effects: z.array(TransitionEffectSchema).default([]),
});
export type TransitionRule = z.infer<typeof TransitionRuleSchema>;
```

- [ ] Step 4: Run `npx vitest run src/hexagons/workflow/domain/workflow-session.schemas.spec.ts`, verify PASS
- [ ] Step 5: `git add src/hexagons/workflow/domain/workflow-session.schemas.ts src/hexagons/workflow/domain/workflow-session.schemas.spec.ts && git commit -m "feat(S01/T01): add guard, effect, context, and transition rule schemas"`

---

### Task 2: Create workflow error classes

**Files:**
- Create: `src/hexagons/workflow/domain/errors/workflow-base.error.ts`
- Create: `src/hexagons/workflow/domain/errors/no-matching-transition.error.ts`
- Create: `src/hexagons/workflow/domain/errors/guard-rejected.error.ts`
- Create: `src/hexagons/workflow/domain/errors/slice-already-assigned.error.ts`
- Create: `src/hexagons/workflow/domain/errors/no-slice-assigned.error.ts`

**Traces to:** AC4, AC5, AC8

**Steps:**

- [ ] Step 1: Create error classes (no separate test — errors are tested through aggregate tests)

```typescript
// workflow-base.error.ts
import { BaseDomainError } from "@kernel";

export abstract class WorkflowBaseError extends BaseDomainError {}

// no-matching-transition.error.ts
import type { WorkflowPhase, WorkflowTrigger } from "../workflow-session.schemas";
import { WorkflowBaseError } from "./workflow-base.error";

export class NoMatchingTransitionError extends WorkflowBaseError {
  readonly code = "WORKFLOW.NO_MATCHING_TRANSITION";

  constructor(phase: WorkflowPhase | "*active*", trigger: WorkflowTrigger) {
    super(`No transition from "${phase}" with trigger "${trigger}"`, { phase, trigger });
  }
}

// guard-rejected.error.ts
import type { GuardName, WorkflowPhase, WorkflowTrigger } from "../workflow-session.schemas";
import { WorkflowBaseError } from "./workflow-base.error";

export class GuardRejectedError extends WorkflowBaseError {
  readonly code = "WORKFLOW.GUARD_REJECTED";

  constructor(phase: WorkflowPhase, trigger: WorkflowTrigger, failedGuards: GuardName[]) {
    super(`All guards rejected for "${phase}" + "${trigger}": [${failedGuards.join(", ")}]`, {
      phase, trigger, failedGuards,
    });
  }
}

// slice-already-assigned.error.ts
import { WorkflowBaseError } from "./workflow-base.error";

export class SliceAlreadyAssignedError extends WorkflowBaseError {
  readonly code = "WORKFLOW.SLICE_ALREADY_ASSIGNED";

  constructor(currentSliceId: string) {
    super(`Slice already assigned: "${currentSliceId}"`, { currentSliceId });
  }
}

// no-slice-assigned.error.ts — reserved for S03 (orchestrator will use when
// trigger requires an active slice but none is assigned)
import { WorkflowBaseError } from "./workflow-base.error";

export class NoSliceAssignedError extends WorkflowBaseError {
  readonly code = "WORKFLOW.NO_SLICE_ASSIGNED";

  constructor() {
    super("No slice assigned to workflow session");
  }
}
```

- [ ] Step 2: `git add src/hexagons/workflow/domain/errors/ && git commit -m "feat(S01/T02): add workflow error classes"`

---

### Task 3: Create WorkflowPhaseChangedEvent

**Files:**
- Create: `src/hexagons/workflow/domain/events/workflow-phase-changed.event.ts`

**Traces to:** AC7

**Steps:**

- [ ] Step 1: Create event with extra props

```typescript
// workflow-phase-changed.event.ts
import { DomainEvent, type DomainEventProps, DomainEventPropsSchema, EVENT_NAMES, type EventName } from "@kernel";
import { z } from "zod";
import { WorkflowPhaseSchema, WorkflowTriggerSchema } from "../workflow-session.schemas";

const WorkflowPhaseChangedEventPropsSchema = DomainEventPropsSchema.extend({
  milestoneId: z.string().uuid(),
  sliceId: z.string().uuid().optional(),
  fromPhase: WorkflowPhaseSchema,
  toPhase: WorkflowPhaseSchema,
  trigger: WorkflowTriggerSchema,
  retryCount: z.number().int().min(0),
});

type WorkflowPhaseChangedEventProps = z.infer<typeof WorkflowPhaseChangedEventPropsSchema>;

export class WorkflowPhaseChangedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.WORKFLOW_PHASE_CHANGED;
  readonly milestoneId: string;
  readonly sliceId?: string;
  readonly fromPhase: WorkflowPhase;
  readonly toPhase: WorkflowPhase;
  readonly trigger: WorkflowTrigger;
  readonly retryCount: number;

  constructor(props: WorkflowPhaseChangedEventProps) {
    const parsed = WorkflowPhaseChangedEventPropsSchema.parse(props);
    super(parsed);
    this.milestoneId = parsed.milestoneId;
    this.sliceId = parsed.sliceId;
    this.fromPhase = parsed.fromPhase;
    this.toPhase = parsed.toPhase;
    this.trigger = parsed.trigger;
    this.retryCount = parsed.retryCount;
  }
}
```

- [ ] Step 2: `git add src/hexagons/workflow/domain/events/ && git commit -m "feat(S01/T03): add WorkflowPhaseChangedEvent with domain-specific props"`

---

### Task 4: Create transition table with guards and ACTIVE_PHASES

**Files:**
- Create: `src/hexagons/workflow/domain/transition-table.ts`
- Create: `src/hexagons/workflow/domain/transition-table.spec.ts`

**Traces to:** AC1, AC2, AC3, AC5
**Deps:** T01

**Steps:**

- [ ] Step 1: Write failing tests

```typescript
// transition-table.spec.ts
import { describe, expect, it } from "vitest";
import {
  ACTIVE_PHASES,
  evaluateGuard,
  findMatchingRules,
  TRANSITION_TABLE,
} from "./transition-table";
import type { GuardContext } from "./workflow-session.schemas";

describe("TRANSITION_TABLE", () => {
  it("has exactly 19 rules", () => {
    expect(TRANSITION_TABLE).toHaveLength(19);
  });

  it("every rule has required fields", () => {
    for (const rule of TRANSITION_TABLE) {
      expect(rule.from).toBeDefined();
      expect(rule.trigger).toBeDefined();
      expect(rule.to).toBeDefined();
      expect(Array.isArray(rule.effects)).toBe(true);
    }
  });
});

describe("ACTIVE_PHASES", () => {
  it("contains the 7 active phases", () => {
    expect(ACTIVE_PHASES.size).toBe(7);
    expect(ACTIVE_PHASES.has("discussing")).toBe(true);
    expect(ACTIVE_PHASES.has("shipping")).toBe(true);
    expect(ACTIVE_PHASES.has("idle")).toBe(false);
    expect(ACTIVE_PHASES.has("paused")).toBe(false);
    expect(ACTIVE_PHASES.has("blocked")).toBe(false);
  });
});

describe("evaluateGuard", () => {
  const baseCtx: GuardContext = {
    complexityTier: "F-lite",
    retryCount: 0,
    maxRetries: 2,
    allSlicesClosed: false,
  };

  it("notSTier returns true when tier is not S", () => {
    expect(evaluateGuard("notSTier", baseCtx)).toBe(true);
  });

  it("notSTier returns false when tier is S", () => {
    expect(evaluateGuard("notSTier", { ...baseCtx, complexityTier: "S" })).toBe(false);
  });

  it("isSTier returns true when tier is S", () => {
    expect(evaluateGuard("isSTier", { ...baseCtx, complexityTier: "S" })).toBe(true);
  });

  it("isSTier returns false when tier is not S", () => {
    expect(evaluateGuard("isSTier", baseCtx)).toBe(false);
  });

  it("allSlicesClosed returns true when all closed", () => {
    expect(evaluateGuard("allSlicesClosed", { ...baseCtx, allSlicesClosed: true })).toBe(true);
  });

  it("allSlicesClosed returns false when not all closed", () => {
    expect(evaluateGuard("allSlicesClosed", baseCtx)).toBe(false);
  });

  it("retriesExhausted returns true when retryCount >= maxRetries", () => {
    expect(evaluateGuard("retriesExhausted", { ...baseCtx, retryCount: 2, maxRetries: 2 })).toBe(true);
    expect(evaluateGuard("retriesExhausted", { ...baseCtx, retryCount: 3, maxRetries: 2 })).toBe(true);
  });

  it("retriesExhausted returns false when retryCount < maxRetries", () => {
    expect(evaluateGuard("retriesExhausted", { ...baseCtx, retryCount: 1, maxRetries: 2 })).toBe(false);
  });
});

describe("findMatchingRules", () => {
  it("finds exact-match rules", () => {
    const rules = findMatchingRules("idle", "start");
    expect(rules.length).toBe(1);
    expect(rules[0].to).toBe("discussing");
  });

  it("finds wildcard *active* rules for active phases", () => {
    const rules = findMatchingRules("executing", "pause");
    expect(rules.some((r) => r.to === "paused")).toBe(true);
  });

  it("does not match *active* rules for non-active phases", () => {
    const rules = findMatchingRules("paused", "pause");
    expect(rules).toHaveLength(0);
  });

  it("returns guarded rules for discussing+next", () => {
    const rules = findMatchingRules("discussing", "next");
    expect(rules).toHaveLength(2);
    expect(rules[0].guard).toBe("notSTier");
    expect(rules[1].guard).toBe("isSTier");
  });
});
```

- [ ] Step 2: Run `npx vitest run src/hexagons/workflow/domain/transition-table.spec.ts`, verify FAIL

- [ ] Step 3: Implement transition table

```typescript
// transition-table.ts
import type { GuardContext, GuardName, TransitionRule, WorkflowPhase } from "./workflow-session.schemas";

export const ACTIVE_PHASES: ReadonlySet<WorkflowPhase> = new Set([
  "discussing", "researching", "planning", "executing", "verifying", "reviewing", "shipping",
]);

export const TRANSITION_TABLE: readonly TransitionRule[] = [
  // 1. idle → discussing
  { from: "idle", trigger: "start", to: "discussing", effects: [] },
  // 2. discussing → researching (non-S)
  { from: "discussing", trigger: "next", to: "researching", guard: "notSTier", effects: [] },
  // 3. discussing → planning (S-tier)
  { from: "discussing", trigger: "next", to: "planning", guard: "isSTier", effects: [] },
  // 4. discussing → planning (skip)
  { from: "discussing", trigger: "skip", to: "planning", effects: [] },
  // 5. researching → planning
  { from: "researching", trigger: "next", to: "planning", effects: [] },
  // 6. planning → executing (approved)
  { from: "planning", trigger: "approve", to: "executing", effects: ["resetRetryCount"] },
  // 7. planning → planning (rejected, replan)
  { from: "planning", trigger: "reject", to: "planning", effects: ["incrementRetry"] },
  // 8. executing → verifying
  { from: "executing", trigger: "next", to: "verifying", effects: [] },
  // 9. verifying → reviewing (approved)
  { from: "verifying", trigger: "approve", to: "reviewing", effects: ["resetRetryCount"] },
  // 10. verifying → executing (rejected)
  { from: "verifying", trigger: "reject", to: "executing", effects: ["incrementRetry"] },
  // 11. reviewing → shipping (approved)
  { from: "reviewing", trigger: "approve", to: "shipping", effects: ["resetRetryCount"] },
  // 12. reviewing → executing (rejected)
  { from: "reviewing", trigger: "reject", to: "executing", effects: ["incrementRetry"] },
  // 13. shipping → idle (slice done)
  { from: "shipping", trigger: "next", to: "idle", effects: ["clearSlice", "resetRetryCount"] },
  // 14. idle → completing-milestone (all slices closed)
  { from: "idle", trigger: "next", to: "completing-milestone", guard: "allSlicesClosed", effects: [] },
  // 15. completing-milestone → idle
  { from: "completing-milestone", trigger: "next", to: "idle", effects: [] },
  // 16. *active* → blocked (retries exhausted)
  { from: "*active*", trigger: "fail", to: "blocked", guard: "retriesExhausted", effects: [] },
  // 17. *active* → paused
  { from: "*active*", trigger: "pause", to: "paused", effects: ["savePreviousPhase"] },
  // 18. paused → *previousPhase*
  { from: "paused", trigger: "resume", to: "*previousPhase*", effects: ["restorePreviousPhase"] },
  // 19. blocked → idle (abort)
  { from: "blocked", trigger: "abort", to: "idle", effects: ["clearSlice", "resetRetryCount"] },
];

const GUARD_EVALUATORS: Record<GuardName, (ctx: GuardContext) => boolean> = {
  notSTier: (ctx) => ctx.complexityTier !== "S",
  isSTier: (ctx) => ctx.complexityTier === "S",
  allSlicesClosed: (ctx) => ctx.allSlicesClosed === true,
  retriesExhausted: (ctx) => ctx.retryCount >= ctx.maxRetries,
};

export function evaluateGuard(guard: GuardName, ctx: GuardContext): boolean {
  return GUARD_EVALUATORS[guard](ctx);
}

export function findMatchingRules(
  currentPhase: WorkflowPhase,
  trigger: TransitionRule["trigger"],
): TransitionRule[] {
  return TRANSITION_TABLE.filter((rule) => {
    if (rule.trigger !== trigger) return false;
    if (rule.from === currentPhase) return true;
    if (rule.from === "*active*" && ACTIVE_PHASES.has(currentPhase)) return true;
    return false;
  });
}
```

- [ ] Step 4: Run `npx vitest run src/hexagons/workflow/domain/transition-table.spec.ts`, verify PASS
- [ ] Step 5: `git add src/hexagons/workflow/domain/transition-table.ts src/hexagons/workflow/domain/transition-table.spec.ts && git commit -m "feat(S01/T04): add declarative transition table with guards and rule matching"`

---

### Task 5: Create WorkflowSession aggregate

**Files:**
- Create: `src/hexagons/workflow/domain/workflow-session.aggregate.ts`
- Create: `src/hexagons/workflow/domain/workflow-session.aggregate.spec.ts`

**Traces to:** AC1, AC2, AC3, AC4, AC5, AC7, AC8, AC9
**Deps:** T01, T02, T03, T04

**Steps:**

- [ ] Step 1: Write failing tests

```typescript
// workflow-session.aggregate.spec.ts
import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";
import { WorkflowSession } from "./workflow-session.aggregate";
import type { GuardContext } from "./workflow-session.schemas";

const defaultCtx: GuardContext = {
  complexityTier: "F-lite",
  retryCount: 0,
  maxRetries: 2,
  allSlicesClosed: false,
};

describe("WorkflowSession", () => {
  describe("createNew", () => {
    it("starts at idle phase", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      expect(session.currentPhase).toBe("idle");
      expect(session.sliceId).toBeUndefined();
      expect(session.retryCount).toBe(0);
    });
  });

  describe("assignSlice", () => {
    it("assigns when no slice is set", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      const sliceId = faker.string.uuid();
      const result = session.assignSlice(sliceId);
      expect(result.ok).toBe(true);
      expect(session.sliceId).toBe(sliceId);
    });

    it("returns error when slice already assigned", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.assignSlice(faker.string.uuid());
      const result = session.assignSlice(faker.string.uuid());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("WORKFLOW.SLICE_ALREADY_ASSIGNED");
    });
  });

  describe("clearSlice", () => {
    it("nullifies sliceId and resets retryCount", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.assignSlice(faker.string.uuid());
      // Advance to discussing, then reject to increment retry
      session.trigger("start", defaultCtx, new Date());
      session.clearSlice();
      expect(session.sliceId).toBeUndefined();
      expect(session.retryCount).toBe(0);
    });
  });

  describe("trigger — happy path transitions", () => {
    it("idle + start → discussing", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      const result = session.trigger("start", defaultCtx, new Date());
      expect(result.ok).toBe(true);
      expect(session.currentPhase).toBe("discussing");
    });

    it("discussing + next → researching (notSTier)", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.trigger("start", defaultCtx, new Date());
      const result = session.trigger("next", defaultCtx, new Date());
      expect(result.ok).toBe(true);
      expect(session.currentPhase).toBe("researching");
    });

    it("discussing + next → planning (isSTier)", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.trigger("start", defaultCtx, new Date());
      const sTierCtx: GuardContext = { ...defaultCtx, complexityTier: "S" };
      const result = session.trigger("next", sTierCtx, new Date());
      expect(result.ok).toBe(true);
      expect(session.currentPhase).toBe("planning");
    });

    it("discussing + skip → planning", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.trigger("start", defaultCtx, new Date());
      const result = session.trigger("skip", defaultCtx, new Date());
      expect(result.ok).toBe(true);
      expect(session.currentPhase).toBe("planning");
    });
  });

  describe("trigger — full lifecycle", () => {
    it("walks the complete happy path: idle → discussing → researching → planning → executing → verifying → reviewing → shipping → idle", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.trigger("start", defaultCtx, new Date());
      expect(session.currentPhase).toBe("discussing");

      session.trigger("next", defaultCtx, new Date()); // rule 2: notSTier
      expect(session.currentPhase).toBe("researching");

      session.trigger("next", defaultCtx, new Date()); // rule 5
      expect(session.currentPhase).toBe("planning");

      session.trigger("approve", defaultCtx, new Date()); // rule 6
      expect(session.currentPhase).toBe("executing");

      session.trigger("next", defaultCtx, new Date()); // rule 8
      expect(session.currentPhase).toBe("verifying");

      session.trigger("approve", defaultCtx, new Date()); // rule 9
      expect(session.currentPhase).toBe("reviewing");

      session.trigger("approve", defaultCtx, new Date()); // rule 11
      expect(session.currentPhase).toBe("shipping");

      session.trigger("next", defaultCtx, new Date()); // rule 13
      expect(session.currentPhase).toBe("idle");
      expect(session.sliceId).toBeUndefined();
    });

    it("verifying + reject → executing (rule 10)", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.trigger("start", defaultCtx, new Date());
      session.trigger("skip", defaultCtx, new Date());
      session.trigger("approve", defaultCtx, new Date());
      session.trigger("next", defaultCtx, new Date());
      expect(session.currentPhase).toBe("verifying");
      session.trigger("reject", defaultCtx, new Date());
      expect(session.currentPhase).toBe("executing");
      expect(session.retryCount).toBe(1);
    });

    it("reviewing + reject → executing (rule 12)", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.trigger("start", defaultCtx, new Date());
      session.trigger("skip", defaultCtx, new Date());
      session.trigger("approve", defaultCtx, new Date());
      session.trigger("next", defaultCtx, new Date());
      session.trigger("approve", defaultCtx, new Date());
      expect(session.currentPhase).toBe("reviewing");
      session.trigger("reject", defaultCtx, new Date());
      expect(session.currentPhase).toBe("executing");
      expect(session.retryCount).toBe(1);
    });

    it("completing-milestone + next → idle (rule 15)", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      const closedCtx: GuardContext = { ...defaultCtx, allSlicesClosed: true };
      session.trigger("next", closedCtx, new Date()); // rule 14
      expect(session.currentPhase).toBe("completing-milestone");
      session.trigger("next", defaultCtx, new Date()); // rule 15
      expect(session.currentPhase).toBe("idle");
    });
  });

  describe("trigger — retry and back-edges", () => {
    it("planning + reject increments retryCount", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.trigger("start", defaultCtx, new Date());
      session.trigger("skip", defaultCtx, new Date());
      session.trigger("reject", defaultCtx, new Date());
      expect(session.retryCount).toBe(1);
      expect(session.currentPhase).toBe("planning");
    });

    it("planning + approve resets retryCount", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.trigger("start", defaultCtx, new Date());
      session.trigger("skip", defaultCtx, new Date());
      session.trigger("reject", defaultCtx, new Date());
      expect(session.retryCount).toBe(1);
      session.trigger("approve", defaultCtx, new Date());
      expect(session.retryCount).toBe(0);
      expect(session.currentPhase).toBe("executing");
    });
  });

  describe("trigger — pause/resume", () => {
    it("pause saves previousPhase, resume restores it", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.trigger("start", defaultCtx, new Date());
      expect(session.currentPhase).toBe("discussing");
      session.trigger("pause", defaultCtx, new Date());
      expect(session.currentPhase).toBe("paused");
      expect(session.previousPhase).toBe("discussing");
      session.trigger("resume", defaultCtx, new Date());
      expect(session.currentPhase).toBe("discussing");
    });
  });

  describe("trigger — blocked", () => {
    it("fail + retriesExhausted transitions to blocked", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.trigger("start", defaultCtx, new Date());
      const exhaustedCtx: GuardContext = { ...defaultCtx, retryCount: 2, maxRetries: 2 };
      const result = session.trigger("fail", exhaustedCtx, new Date());
      expect(result.ok).toBe(true);
      expect(session.currentPhase).toBe("blocked");
    });

    it("fail without retriesExhausted returns guard rejected", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.trigger("start", defaultCtx, new Date());
      const result = session.trigger("fail", defaultCtx, new Date());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("WORKFLOW.GUARD_REJECTED");
    });

    it("blocked + abort returns to idle", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.trigger("start", defaultCtx, new Date());
      session.trigger("fail", { ...defaultCtx, retryCount: 2, maxRetries: 2 }, new Date());
      const result = session.trigger("abort", defaultCtx, new Date());
      expect(result.ok).toBe(true);
      expect(session.currentPhase).toBe("idle");
    });
  });

  describe("trigger — completing-milestone", () => {
    it("idle + next + allSlicesClosed → completing-milestone", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      const closedCtx: GuardContext = { ...defaultCtx, allSlicesClosed: true };
      const result = session.trigger("next", closedCtx, new Date());
      expect(result.ok).toBe(true);
      expect(session.currentPhase).toBe("completing-milestone");
    });
  });

  describe("trigger — events", () => {
    it("emits WorkflowPhaseChangedEvent on every transition", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      session.pullEvents(); // clear creation events if any
      session.trigger("start", defaultCtx, new Date());
      const events = session.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe("workflow.phase-changed");
    });
  });

  describe("trigger — error cases", () => {
    it("returns NoMatchingTransitionError for invalid combo", () => {
      const session = WorkflowSession.createNew({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        autonomyMode: "guided",
        now: new Date(),
      });
      const result = session.trigger("approve", defaultCtx, new Date());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("WORKFLOW.NO_MATCHING_TRANSITION");
    });
  });

  describe("reconstitute", () => {
    it("reconstitutes from props without events", () => {
      const now = new Date();
      const session = WorkflowSession.reconstitute({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        currentPhase: "executing",
        previousPhase: "planning",
        retryCount: 1,
        autonomyMode: "plan-to-pr",
        createdAt: now,
        updatedAt: now,
      });
      expect(session.currentPhase).toBe("executing");
      expect(session.pullEvents()).toHaveLength(0);
    });
  });
});
```

- [ ] Step 2: Run `npx vitest run src/hexagons/workflow/domain/workflow-session.aggregate.spec.ts`, verify FAIL

- [ ] Step 3: Implement aggregate

```typescript
// workflow-session.aggregate.ts
import { AggregateRoot, err, ok, type Result } from "@kernel";
import { GuardRejectedError } from "./errors/guard-rejected.error";
import { NoMatchingTransitionError } from "./errors/no-matching-transition.error";
import { SliceAlreadyAssignedError } from "./errors/slice-already-assigned.error";
import { WorkflowPhaseChangedEvent } from "./events/workflow-phase-changed.event";
import { evaluateGuard, findMatchingRules } from "./transition-table";
import type {
  GuardContext,
  GuardName,
  TransitionEffect,
  TransitionRule,
  WorkflowPhase,
  WorkflowSessionProps,
  WorkflowTrigger,
} from "./workflow-session.schemas";
import { WorkflowSessionPropsSchema } from "./workflow-session.schemas";
import type { WorkflowBaseError } from "./errors/workflow-base.error";

export class WorkflowSession extends AggregateRoot<WorkflowSessionProps> {
  private constructor(props: WorkflowSessionProps) {
    super(props, WorkflowSessionPropsSchema);
  }

  get id(): string { return this.props.id; }
  get milestoneId(): string { return this.props.milestoneId; }
  get sliceId(): string | undefined { return this.props.sliceId; }
  get currentPhase(): WorkflowPhase { return this.props.currentPhase; }
  get previousPhase(): WorkflowPhase | undefined { return this.props.previousPhase; }
  get retryCount(): number { return this.props.retryCount; }
  get autonomyMode(): string { return this.props.autonomyMode; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  static createNew(params: {
    id: string;
    milestoneId: string;
    autonomyMode: "guided" | "plan-to-pr";
    now: Date;
  }): WorkflowSession {
    return new WorkflowSession({
      id: params.id,
      milestoneId: params.milestoneId,
      currentPhase: "idle",
      retryCount: 0,
      autonomyMode: params.autonomyMode,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static reconstitute(props: WorkflowSessionProps): WorkflowSession {
    return new WorkflowSession(props);
  }

  trigger(
    trigger: WorkflowTrigger,
    ctx: GuardContext,
    now: Date,
  ): Result<void, WorkflowBaseError> {
    const fromPhase = this.props.currentPhase;
    const matchingRules = findMatchingRules(fromPhase, trigger);

    if (matchingRules.length === 0) {
      return err(new NoMatchingTransitionError(fromPhase, trigger));
    }

    const failedGuards: GuardName[] = [];
    for (const rule of matchingRules) {
      if (rule.guard && !evaluateGuard(rule.guard, ctx)) {
        failedGuards.push(rule.guard);
        continue;
      }
      return this.applyTransition(rule, fromPhase, trigger, now);
    }

    return err(new GuardRejectedError(fromPhase, trigger, failedGuards));
  }

  assignSlice(sliceId: string): Result<void, SliceAlreadyAssignedError> {
    if (this.props.sliceId) {
      return err(new SliceAlreadyAssignedError(this.props.sliceId));
    }
    this.props.sliceId = sliceId;
    return ok(undefined);
  }

  clearSlice(): void {
    this.props.sliceId = undefined;
    this.props.retryCount = 0;
  }

  private resolveTargetPhase(rule: TransitionRule, fromPhase: WorkflowPhase): WorkflowPhase {
    if (rule.to === "*previousPhase*") {
      return this.props.previousPhase ?? fromPhase;
    }
    return rule.to;
  }

  private applyTransition(
    rule: TransitionRule,
    fromPhase: WorkflowPhase,
    trigger: WorkflowTrigger,
    now: Date,
  ): Result<void, WorkflowBaseError> {
    for (const effect of rule.effects) {
      this.applyEffect(effect);
    }

    const toPhase = this.resolveTargetPhase(rule, fromPhase);

    this.props.currentPhase = toPhase;
    this.props.updatedAt = now;

    this.addEvent(
      new WorkflowPhaseChangedEvent({
        id: crypto.randomUUID(),
        aggregateId: this.props.id,
        occurredAt: now,
        milestoneId: this.props.milestoneId,
        sliceId: this.props.sliceId,
        fromPhase,
        toPhase,
        trigger,
        retryCount: this.props.retryCount,
      }),
    );

    return ok(undefined);
  }

  private applyEffect(effect: TransitionEffect): void {
    switch (effect) {
      case "incrementRetry":
        this.props.retryCount++;
        break;
      case "savePreviousPhase":
        this.props.previousPhase = this.props.currentPhase;
        break;
      case "restorePreviousPhase":
        // currentPhase set by caller after effects
        break;
      case "resetRetryCount":
        this.props.retryCount = 0;
        break;
      case "clearSlice":
        this.props.sliceId = undefined;
        break;
    }
  }
}
```

- [ ] Step 4: Run `npx vitest run src/hexagons/workflow/domain/workflow-session.aggregate.spec.ts`, verify PASS
- [ ] Step 5: `git add src/hexagons/workflow/domain/workflow-session.aggregate.ts src/hexagons/workflow/domain/workflow-session.aggregate.spec.ts && git commit -m "feat(S01/T05): implement WorkflowSession aggregate with trigger, assignSlice, clearSlice"`

---

### Task 6: Create WorkflowSession builder

**Files:**
- Create: `src/hexagons/workflow/domain/workflow-session.builder.ts`

**Traces to:** AC4 (enables testing)
**Deps:** T05

**Steps:**

- [ ] Step 1: Create builder

```typescript
// workflow-session.builder.ts
import { faker } from "@faker-js/faker";
import { WorkflowSession } from "./workflow-session.aggregate";
import type { WorkflowPhase, WorkflowSessionProps } from "./workflow-session.schemas";

export class WorkflowSessionBuilder {
  private _id: string = faker.string.uuid();
  private _milestoneId: string = faker.string.uuid();
  private _sliceId: string | undefined = undefined;
  private _currentPhase: WorkflowPhase = "idle";
  private _previousPhase: WorkflowPhase | undefined = undefined;
  private _retryCount = 0;
  private _autonomyMode: "guided" | "plan-to-pr" = "guided";
  private _now: Date = faker.date.recent();

  withId(id: string): this { this._id = id; return this; }
  withMilestoneId(milestoneId: string): this { this._milestoneId = milestoneId; return this; }
  withSliceId(sliceId: string): this { this._sliceId = sliceId; return this; }
  withCurrentPhase(phase: WorkflowPhase): this { this._currentPhase = phase; return this; }
  withPreviousPhase(phase: WorkflowPhase): this { this._previousPhase = phase; return this; }
  withRetryCount(count: number): this { this._retryCount = count; return this; }
  withAutonomyMode(mode: "guided" | "plan-to-pr"): this { this._autonomyMode = mode; return this; }

  build(): WorkflowSession {
    return WorkflowSession.createNew({
      id: this._id,
      milestoneId: this._milestoneId,
      autonomyMode: this._autonomyMode,
      now: this._now,
    });
  }

  buildProps(): WorkflowSessionProps {
    return {
      id: this._id,
      milestoneId: this._milestoneId,
      sliceId: this._sliceId,
      currentPhase: this._currentPhase,
      previousPhase: this._previousPhase,
      retryCount: this._retryCount,
      autonomyMode: this._autonomyMode,
      createdAt: this._now,
      updatedAt: this._now,
    };
  }
}
```

- [ ] Step 2: `git add src/hexagons/workflow/domain/workflow-session.builder.ts && git commit -m "feat(S01/T06): add WorkflowSession builder for testing"`

---

### Task 7: Create repository port + in-memory adapter

**Files:**
- Create: `src/hexagons/workflow/domain/ports/workflow-session.repository.port.ts`
- Create: `src/hexagons/workflow/infrastructure/in-memory-workflow-session.repository.ts`
- Create: `src/hexagons/workflow/infrastructure/in-memory-workflow-session.repository.spec.ts`

**Traces to:** AC6
**Deps:** T05, T06

**Steps:**

- [ ] Step 1: Write failing tests

```typescript
// in-memory-workflow-session.repository.spec.ts
import { faker } from "@faker-js/faker";
import { describe, expect, it, beforeEach } from "vitest";
import { WorkflowSessionBuilder } from "../domain/workflow-session.builder";
import { InMemoryWorkflowSessionRepository } from "./in-memory-workflow-session.repository";

describe("InMemoryWorkflowSessionRepository", () => {
  let repo: InMemoryWorkflowSessionRepository;

  beforeEach(() => {
    repo = new InMemoryWorkflowSessionRepository();
  });

  it("saves and finds by id", async () => {
    const session = new WorkflowSessionBuilder().build();
    const saveResult = await repo.save(session);
    expect(saveResult.ok).toBe(true);
    const findResult = await repo.findById(session.id);
    expect(findResult.ok).toBe(true);
    if (findResult.ok) {
      expect(findResult.data).not.toBeNull();
      expect(findResult.data!.id).toBe(session.id);
    }
  });

  it("finds by milestoneId", async () => {
    const milestoneId = faker.string.uuid();
    const session = new WorkflowSessionBuilder().withMilestoneId(milestoneId).build();
    await repo.save(session);
    const result = await repo.findByMilestoneId(milestoneId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).not.toBeNull();
      expect(result.data!.milestoneId).toBe(milestoneId);
    }
  });

  it("returns null for non-existent id", async () => {
    const result = await repo.findById(faker.string.uuid());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBeNull();
  });

  it("enforces one session per milestone", async () => {
    const milestoneId = faker.string.uuid();
    const session1 = new WorkflowSessionBuilder().withMilestoneId(milestoneId).build();
    const session2 = new WorkflowSessionBuilder().withMilestoneId(milestoneId).build();
    await repo.save(session1);
    const result = await repo.save(session2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("cardinality");
  });

  it("allows updating existing session (same id)", async () => {
    const session = new WorkflowSessionBuilder().build();
    await repo.save(session);
    const result = await repo.save(session); // same id = update
    expect(result.ok).toBe(true);
  });
});
```

- [ ] Step 2: Run `npx vitest run src/hexagons/workflow/infrastructure/in-memory-workflow-session.repository.spec.ts`, verify FAIL

- [ ] Step 3: Implement port and adapter

```typescript
// workflow-session.repository.port.ts
import type { Id, PersistenceError, Result } from "@kernel";
import type { WorkflowSession } from "../workflow-session.aggregate";

export abstract class WorkflowSessionRepositoryPort {
  abstract save(session: WorkflowSession): Promise<Result<void, PersistenceError>>;
  abstract findById(id: Id): Promise<Result<WorkflowSession | null, PersistenceError>>;
  abstract findByMilestoneId(milestoneId: Id): Promise<Result<WorkflowSession | null, PersistenceError>>;
}

// in-memory-workflow-session.repository.ts
import { err, type Id, ok, PersistenceError, type Result } from "@kernel";
import { WorkflowSessionRepositoryPort } from "../domain/ports/workflow-session.repository.port";
import { WorkflowSession } from "../domain/workflow-session.aggregate";
import type { WorkflowSessionProps } from "../domain/workflow-session.schemas";

export class InMemoryWorkflowSessionRepository extends WorkflowSessionRepositoryPort {
  private store = new Map<string, WorkflowSessionProps>();

  async save(session: WorkflowSession): Promise<Result<void, PersistenceError>> {
    const props = session.toJSON();
    for (const [existingId, existingProps] of this.store) {
      if (existingId !== props.id && existingProps.milestoneId === props.milestoneId) {
        return err(
          new PersistenceError(
            `Milestone cardinality violated: session for milestone "${props.milestoneId}" already exists`,
          ),
        );
      }
    }
    this.store.set(props.id, props);
    return ok(undefined);
  }

  async findById(id: Id): Promise<Result<WorkflowSession | null, PersistenceError>> {
    const props = this.store.get(id);
    if (!props) return ok(null);
    return ok(WorkflowSession.reconstitute(props));
  }

  async findByMilestoneId(milestoneId: Id): Promise<Result<WorkflowSession | null, PersistenceError>> {
    for (const props of this.store.values()) {
      if (props.milestoneId === milestoneId) {
        return ok(WorkflowSession.reconstitute(props));
      }
    }
    return ok(null);
  }

  seed(session: WorkflowSession): void {
    this.store.set(session.id, session.toJSON());
  }

  reset(): void {
    this.store.clear();
  }
}
```

- [ ] Step 4: Run `npx vitest run src/hexagons/workflow/infrastructure/in-memory-workflow-session.repository.spec.ts`, verify PASS
- [ ] Step 5: `git add src/hexagons/workflow/domain/ports/ src/hexagons/workflow/infrastructure/in-memory-workflow-session.repository.ts src/hexagons/workflow/infrastructure/in-memory-workflow-session.repository.spec.ts && git commit -m "feat(S01/T07): add WorkflowSession repository port and in-memory adapter"`

---

### Task 8: Update barrel exports and run full test suite

**Files:**
- Modify: `src/hexagons/workflow/index.ts`

**Traces to:** All ACs (integration)
**Deps:** T01-T07

**Steps:**

- [ ] Step 1: Update barrel

```typescript
// index.ts — add new exports organized by layer

// Domain — Errors
export { GuardRejectedError } from "./domain/errors/guard-rejected.error";
export { NoMatchingTransitionError } from "./domain/errors/no-matching-transition.error";
export { NoSliceAssignedError } from "./domain/errors/no-slice-assigned.error";
export { SliceAlreadyAssignedError } from "./domain/errors/slice-already-assigned.error";
export { WorkflowBaseError } from "./domain/errors/workflow-base.error";

// Domain — Events
export { WorkflowPhaseChangedEvent } from "./domain/events/workflow-phase-changed.event";

// Domain — Ports
export { WorkflowSessionRepositoryPort } from "./domain/ports/workflow-session.repository.port";

// Domain — Schemas (add new types)
export type {
  GuardContext,
  GuardName,
  TransitionEffect,
  TransitionRule,
  WorkflowPhase,
  WorkflowSessionProps,
  WorkflowTrigger,
} from "./domain/workflow-session.schemas";
export {
  GuardContextSchema,
  GuardNameSchema,
  TransitionEffectSchema,
  TransitionRuleSchema,
  WorkflowPhaseSchema,
  WorkflowSessionPropsSchema,
  WorkflowTriggerSchema,
} from "./domain/workflow-session.schemas";

// Domain — Transition Table
export { ACTIVE_PHASES, evaluateGuard, findMatchingRules, TRANSITION_TABLE } from "./domain/transition-table";

// Domain — Aggregate
export { WorkflowSession } from "./domain/workflow-session.aggregate";

// Domain — Builder
export { WorkflowSessionBuilder } from "./domain/workflow-session.builder";

// Infrastructure
export { InMemoryWorkflowSessionRepository } from "./infrastructure/in-memory-workflow-session.repository";

// Extensions (existing)
export type { WorkflowExtensionDeps } from "./infrastructure/pi/workflow.extension";
export { registerWorkflowExtension } from "./infrastructure/pi/workflow.extension";

// Use Cases (existing)
export type { StatusReport } from "./use-cases/get-status.use-case";
export { GetStatusUseCase, StatusReportSchema } from "./use-cases/get-status.use-case";
```

- [ ] Step 2: Run `npx vitest run src/hexagons/workflow/`, verify ALL PASS
- [ ] Step 3: Run `npx vitest run`, verify no regressions across entire codebase
- [ ] Step 4: `git add src/hexagons/workflow/index.ts && git commit -m "feat(S01/T08): update workflow barrel exports"`

---

## Wave Detection

```
Wave 1: T01 (schemas), T02 (errors), T03 (event)
Wave 2: T04 (transition table) — depends on T01
Wave 3: T05 (aggregate) — depends on T01, T02, T03, T04
Wave 4: T06 (builder) — depends on T05
         T07 (repository) — depends on T05, T06
Wave 5: T08 (barrel + full suite) — depends on all
```
