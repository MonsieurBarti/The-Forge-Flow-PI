# M01-S04: Plan — Event Name Constants

## Task Decomposition

### T01: Create event-names.ts and event-names.spec.ts

**Files:** `src/kernel/event-names.ts` (new), `src/kernel/event-names.spec.ts` (new)
**AC:** AC1, AC2, AC3

Create the `EVENT_NAMES` const object with all 11 event names, the `EventName` type alias, and the `EventNameSchema` Zod enum. Tests verify:
- All 11 values present and unique
- `EventNameSchema.parse()` accepts valid names
- `EventNameSchema.parse()` rejects invalid strings
- `expectTypeOf` confirms `EventName` is the correct union

---

### T02: Tighten DomainEvent.eventName to EventName

**Files:** `src/kernel/domain-event.base.ts` (edit), `src/kernel/domain-event.base.spec.ts` (edit), `src/kernel/aggregate-root.base.spec.ts` (edit)
**AC:** AC4
**Blocked by:** T01

Change `abstract readonly eventName: string` to `abstract readonly eventName: EventName` in `DomainEvent`.

Fix test fixtures: replace `readonly eventName = "test.happened"` with `readonly eventName = EVENT_NAMES.PROJECT_INITIALIZED` in both `domain-event.base.spec.ts` and `aggregate-root.base.spec.ts`. Update assertion strings accordingly.

---

### T03: Tighten EventBusPort.subscribe to EventName

**Files:** `src/kernel/ports/event-bus.port.ts` (edit)
**AC:** AC5
**Blocked by:** T01

Change `eventType: string` to `eventType: EventName` in `subscribe` signature. Update the import from `DomainEvent` to also import `EventName` (or import from `@kernel/event-names`).

---

### T04: Update barrel and verify

**Files:** `src/kernel/index.ts` (edit)
**AC:** AC6
**Blocked by:** T02, T03

Add re-exports: `EVENT_NAMES`, `EventNameSchema` (value exports) and `EventName` (type export) from `./event-names`. Run `tsc --noEmit`, `vitest run`, `biome check`.

## Waves

```
Wave 0: [T01]
Wave 1: [T02, T03]  (parallel)
Wave 2: [T04]
```

## Dependency Graph

```
T01 ──┬── T02 ──┬── T04
      └── T03 ──┘
```
