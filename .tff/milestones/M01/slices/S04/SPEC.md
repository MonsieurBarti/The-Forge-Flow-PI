# M01-S04: Event Name Constants

## Scope

Define compile-time-safe event name constants and tighten the EventBusPort and DomainEvent base class to use them. All 11 event names from the design spec are defined now (including future hexagons) since they are zero-cost `as const` literals with no coupling to implementations.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Event names scope | All 11 from design spec | Zero runtime cost; future hexagons get compile-time protection immediately |
| DomainEvent.eventName type | Tighten from `string` to `EventName` | Forces all event subclasses to use valid EventName constants |
| EventNameSchema | Yes, Zod enum | Consistent with Zod-first principle; needed for journal deserialization |
| File location | `kernel/event-names.ts` | Kernel-level, used across all hexagons |

## Deliverables

### 1. `src/kernel/event-names.ts` — Event Name Constants

```typescript
import { z } from "zod";

export const EVENT_NAMES = {
  PROJECT_INITIALIZED: "project.initialized",
  MILESTONE_CREATED: "milestone.created",
  MILESTONE_CLOSED: "milestone.closed",
  SLICE_CREATED: "slice.created",
  SLICE_STATUS_CHANGED: "slice.status-changed",
  TASK_COMPLETED: "task.completed",
  TASK_BLOCKED: "task.blocked",
  ALL_TASKS_COMPLETED: "execution.all-tasks-completed",
  REVIEW_RECORDED: "review.recorded",
  SKILL_REFINED: "intelligence.skill-refined",
  WORKFLOW_PHASE_CHANGED: "workflow.phase-changed",
} as const;

export type EventName = (typeof EVENT_NAMES)[keyof typeof EVENT_NAMES];

export const EventNameSchema = z.enum([
  EVENT_NAMES.PROJECT_INITIALIZED,
  EVENT_NAMES.MILESTONE_CREATED,
  EVENT_NAMES.MILESTONE_CLOSED,
  EVENT_NAMES.SLICE_CREATED,
  EVENT_NAMES.SLICE_STATUS_CHANGED,
  EVENT_NAMES.TASK_COMPLETED,
  EVENT_NAMES.TASK_BLOCKED,
  EVENT_NAMES.ALL_TASKS_COMPLETED,
  EVENT_NAMES.REVIEW_RECORDED,
  EVENT_NAMES.SKILL_REFINED,
  EVENT_NAMES.WORKFLOW_PHASE_CHANGED,
]);
```

### 2. `src/kernel/event-names.spec.ts` — Tests

- EVENT_NAMES values are unique
- EventName type rejects arbitrary strings (compile-time — tested via `expectTypeOf`)
- EventNameSchema parses valid event names
- EventNameSchema rejects invalid strings

### 3. `src/kernel/domain-event.base.ts` — Tighten eventName

Change `abstract readonly eventName: string` to `abstract readonly eventName: EventName`.

### 4. `src/kernel/ports/event-bus.port.ts` — Tighten subscribe key

Change `eventType: string` to `eventType: EventName` in `subscribe` signature.

### 5. `src/kernel/index.ts` — Updated Barrel

Add re-exports for `EVENT_NAMES`, `EventName`, `EventNameSchema`.

## Acceptance Criteria

- [x] AC1: `EVENT_NAMES` is a `const` object with all 11 event names from design spec
- [x] AC2: `EventName` type is a union of all event name string literals
- [x] AC3: `EventNameSchema` Zod schema validates/rejects event names at runtime
- [x] AC4: `DomainEvent.eventName` typed as `EventName` (not `string`)
- [x] AC5: `EventBusPort.subscribe` uses `EventName` for event key parameter
- [x] AC6: `biome check`, `vitest run`, `tsc --noEmit` all pass

## Unknowns

None.

## Complexity

**S** — 1 new file + 1 test file, 2-3 modified files, no investigation, no architecture impact, fully specified.
