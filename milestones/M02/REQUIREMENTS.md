# M02: Task + Settings + CLI Bootstrap

## Goal

Complete the entity stack with Task hexagon (including wave detection), add Settings hexagon, wire up the CLI entry point with PI SDK, and deliver the first working commands.

## Requirements

### R01: Task Hexagon -- Entity and Schemas

- `Task` aggregate root with `TaskPropsSchema` (id, sliceId, label, title, description, acceptanceCriteria, filePaths, status, blockedBy, waveIndex, timestamps)
- `TaskStatusSchema`: open, in_progress, closed, blocked
- `createNew()`, `complete()`, `block()`, `unblock()`, `assignToWave()` business methods
- `TaskCompletedEvent`, `TaskBlockedEvent` domain events
- `CyclicDependencyError`, `TaskNotFoundError`
- `TaskRepositoryPort`, SQLite + in-memory adapters with contract tests
- `TaskBuilder`
- Label format: `T01`, `T02`

**AC:**
- Task status transitions validated
- `blockedBy` array tracks dependency IDs
- Builder supports chaining (`.withSliceId()`, `.withBlockedBy()`, etc.)

### R02: Wave Detection (Kahn's Algorithm)

- `Wave` value object with `WaveSchema` (index, taskIds)
- `DetectWavesUseCase`: topological sort using Kahn's algorithm
- Cycle detection with specific task IDs in error message
- Deterministic ordering (sorted task IDs within each wave for reproducible output)
- `WaveDetectionPort` abstract class (for cross-hexagon use by Execution hexagon)

**AC:**
- Independent tasks land in wave 0 (parallel)
- Sequential dependencies produce ordered waves
- Cyclic dependency throws `CyclicDependencyError` with the cycle path
- Deterministic: same input always produces same wave assignments

### R03: Settings Hexagon

- `ProjectSettings` aggregate with `SettingsSchema` (modelRouting, autonomy, autoLearn, persistence)
- `ModelProfileNameSchema`: quality, balanced, budget
- `ModelRoutingConfigSchema` with profiles, phaseOverrides, complexityMapping, budget, fallbackChains
- `LoadSettingsUseCase`: YAML parsing with resilient validation (`.default()` + `.catch()` per field)
- `MergeSettingsUseCase`: settings cascade (hardcoded defaults < team settings < local settings < env vars)
- `ResolveModelUseCase`: phase + complexity + budget -> concrete model selection
- Sequential fallback chains: per-profile fallback if primary model unavailable

**AC:**
- Partial/corrupted YAML falls back to defaults per field (not entire file)
- Every field has a Zod `.default()` so partial configs always produce valid `Settings`
- Model routing respects complexity tier mapping (S->budget, F-lite->balanced, F-full->quality)
- Budget enforcement: progressive downshift at thresholds (50%->balanced, 75%->budget)
- Fallback chains tested: primary model down -> secondary selected automatically

### R04: Git Port + CLI Adapter

- `GitPort` implementation using git CLI (`GitCliAdapter`)
- Commands: listBranches, createBranch, showFile, log, status, commit
- All commands return `Result<T, GitError>` (never throw)
- Non-interactive: always use `-f` flags on cp/mv/rm

**AC:**
- Adapter tested against real git repo (integration test)
- Error cases (missing branch, conflicts) return typed errors

### R05: EventBus Implementation

- `InProcessEventBus` implementing `EventBusPort`
- Sequential handler execution (subscription order, not concurrent)
- Type-safe subscriptions using `EVENT_NAMES` constants

**AC:**
- Handlers execute sequentially (no race conditions)
- Unhandled errors in handlers don't crash the bus (logged + continue)

### R06: CLI Bootstrap + PI SDK Wiring

- Two-file loader entry point (`cli/`)
- PI SDK extension registration for TFF extensions
- `createZodTool` adapter: Zod schema -> JSON Schema bridge for PI SDK tools
- Tool parameter constraint: only JSON-Schema-compatible Zod features (no `.transform()`, `.pipe()`, `.preprocess()`, `.brand()`, `.refine()`)
- `/tff:new` command (project initialization)
- `/tff:status` command (current state display)

**AC:**
- `tff` binary launches PI coding agent with TFF extensions pre-loaded
- `/tff:status` shows project, active milestone, slice states, task counts
- Zod-to-JSON-Schema bridge correctly converts all supported Zod types

### R07: Structured Inter-Agent Artifacts

- Define JSON schemas for all data passed between agents (structured handoffs, not free-form text)
- `AgentDispatchConfigSchema` and `AgentResultSchema` (from design spec)
- Agent Card manifest schema: capabilities, inputs, outputs, required tools per agent type
- Manifests are machine-readable and support dynamic routing

**AC:**
- All agent-to-agent data passes through validated schemas
- Agent Card manifests are discoverable and queryable by capability
