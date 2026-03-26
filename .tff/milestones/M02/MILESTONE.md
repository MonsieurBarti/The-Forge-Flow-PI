# M02: Task + Settings + CLI Bootstrap

## Goal

Complete the entity stack with Task hexagon (including wave detection), add Settings hexagon, wire up the CLI entry point with PI SDK, and deliver the first working commands.

## Slices

### M02-S01: Task hexagon (R01)

**Requirements:** R01
**Dependencies:** none
**Complexity:** F-full

- Task aggregate root with status transitions (open, in_progress, closed, blocked)
- `createNew()`, `complete()`, `block()`, `unblock()`, `assignToWave()` business methods
- `TaskCompletedEvent`, `TaskBlockedEvent` domain events
- `CyclicDependencyError`, `TaskNotFoundError`
- `TaskRepositoryPort`, SQLite + in-memory adapters, contract tests
- `TaskBuilder` with chaining

**AC:**
- Task status transitions validated
- `blockedBy` array tracks dependency IDs
- Builder supports chaining

---

### M02-S02: Wave detection (R02)

**Requirements:** R02
**Dependencies:** M02-S01
**Complexity:** F-lite

- `Wave` value object with `WaveSchema` (index, taskIds)
- `DetectWavesUseCase`: topological sort using Kahn's algorithm
- Cycle detection with specific task IDs in error message
- Deterministic ordering (sorted task IDs within each wave)
- `WaveDetectionPort` abstract class

**AC:**
- Independent tasks land in wave 0
- Sequential dependencies produce ordered waves
- Cyclic dependency throws `CyclicDependencyError` with cycle path
- Deterministic: same input always produces same wave assignments

---

### M02-S03: Settings hexagon (R03)

**Requirements:** R03
**Dependencies:** none
**Complexity:** F-full

- `ProjectSettings` aggregate with `SettingsSchema`
- `ModelProfileNameSchema`, `ModelRoutingConfigSchema`
- `LoadSettingsUseCase`: YAML parsing with resilient validation
- `MergeSettingsUseCase`: settings cascade
- `ResolveModelUseCase`: phase + complexity + budget -> model
- Sequential fallback chains

**AC:**
- Partial/corrupted YAML falls back to defaults per field
- Every field has Zod `.default()`
- Model routing respects complexity tier mapping
- Budget enforcement with progressive downshift
- Fallback chains tested

---

### M02-S04: EventBus implementation (R05)

**Requirements:** R05
**Dependencies:** none
**Complexity:** F-lite

- `InProcessEventBus` implementing `EventBusPort`
- Sequential handler execution
- Type-safe subscriptions using `EVENT_NAMES`

**AC:**
- Handlers execute sequentially
- Unhandled errors in handlers don't crash the bus

---

### M02-S05: Git CLI adapter (R04)

**Requirements:** R04
**Dependencies:** none
**Complexity:** F-lite

- `GitCliAdapter` implementing `GitPort`
- Commands: listBranches, createBranch, showFile, log, status, commit
- All commands return `Result<T, GitError>`

**AC:**
- Adapter tested against real git repo (integration test)
- Error cases return typed errors

---

### M02-S06: Agent artifact schemas (R07)

**Requirements:** R07
**Dependencies:** none
**Complexity:** F-lite

- `AgentDispatchConfigSchema` and `AgentResultSchema`
- Agent Card manifest schema
- Machine-readable, discoverable by capability

**AC:**
- All agent-to-agent data passes through validated schemas
- Agent Card manifests are queryable by capability

---

### M02-S07: CLI bootstrap + PI SDK wiring (R06)

**Requirements:** R06
**Dependencies:** M02-S03, M02-S04, M02-S05
**Complexity:** F-full

- Two-file loader entry point
- PI SDK extension registration
- `createZodTool` adapter: Zod -> JSON Schema bridge
- `/tff:new` and `/tff:status` commands

**AC:**
- `tff` binary launches PI coding agent with TFF extensions
- `/tff:status` shows project, milestone, slice states, task counts
- Zod-to-JSON-Schema bridge converts all supported Zod types

## Dependency Graph

```
S01 --> S02
S03 --\
S04 --+--> S07
S05 --/
S06 (independent)
```

S01, S03, S04, S05, S06 are all parallelizable (no shared deps).
