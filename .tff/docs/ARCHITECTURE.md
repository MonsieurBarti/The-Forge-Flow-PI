# Architecture

The Forge Flow PI (TFF-PI) is a workflow orchestration system for AI-driven software development, built as a PI coding agent extension. It manages the full lifecycle of project slices -- from discussion through execution, review, and shipping -- using hexagonal architecture with DDD aggregates and domain events.

## Layer Model

```
 ┌─────────────────────────────────────────────────┐
 │                   CLI / PI SDK                   │  Composition root, overlay UI
 │  src/cli/                                        │  (extensions, components, main)
 ├─────────────────────────────────────────────────┤
 │               Application Layer                  │  Use cases, coordinators
 │  src/hexagons/*/application/                     │
 │  src/hexagons/*/use-cases/                       │
 ├─────────────────────────────────────────────────┤
 │                 Domain Layer                     │  Aggregates, VOs, events, ports
 │  src/hexagons/*/domain/                          │
 │  src/kernel/                                     │
 ├─────────────────────────────────────────────────┤
 │             Infrastructure Layer                 │  Adapters, repos, PI tools
 │  src/hexagons/*/infrastructure/                  │
 │  src/kernel/infrastructure/                      │
 │  src/infrastructure/pi/                          │
 └─────────────────────────────────────────────────┘
```

**Dependency rule:** Infrastructure and CLI depend inward on Domain. Domain never imports from infrastructure or CLI. Application orchestrates domain objects via ports.

## Path Aliases

| Alias | Path | Purpose |
|-------|------|---------|
| `@kernel` | `src/kernel/` | Shared DDD building blocks, cross-cutting ports |
| `@hexagons/*` | `src/hexagons/*/` | Bounded context modules |
| `@infrastructure/*` | `src/infrastructure/*/` | Shared infra (PI SDK types) |
| `@resources` | `src/resources/` | Agent cards, prompts, protocols |

## Modules (Bounded Contexts)

| Module | Path | Aggregate(s) | Responsibility |
|--------|------|--------------|----------------|
| **project** | `src/hexagons/project/` | `Project` | Project initialization, filesystem scaffolding |
| **milestone** | `src/hexagons/milestone/` | `Milestone` | Milestone lifecycle (open/close) |
| **slice** | `src/hexagons/slice/` | `Slice` | Slice status transitions (discussing..closed) |
| **task** | `src/hexagons/task/` | `Task` | Task decomposition, wave detection |
| **workflow** | `src/hexagons/workflow/` | `WorkflowSession` | Phase state machine, transition guards, artifact I/O |
| **execution** | `src/hexagons/execution/` | `ExecutionSession`, `Checkpoint` | Agent dispatch, journaling, metrics, worktrees |
| **review** | `src/hexagons/review/` | `Review`, `Verification`, `ShipRecord`, `CompletionRecord` | Code review, verification, shipping, milestone completion |
| **settings** | `src/hexagons/settings/` | `ProjectSettings` (VO) | Model routing, autonomy config, hotkeys |
| **kernel** | `src/kernel/` | (base classes) | `AggregateRoot`, `Entity`, `ValueObject`, `DomainEvent`, `Result<T,E>`, agent registry |

## Domain Layer

### Building Blocks (`src/kernel/`)

| Base | File | Role |
|------|------|------|
| `Entity<TProps>` | `entity.base.ts` | Zod-validated props, abstract `id` |
| `AggregateRoot<TProps>` | `aggregate-root.base.ts` | Entity + domain event collection (`addEvent`/`pullEvents`) |
| `ValueObject<TProps>` | `value-object.base.ts` | Immutable, structural equality |
| `DomainEvent` | `domain-event.base.ts` | `id`, `aggregateId`, `occurredAt`, correlation/causation IDs |
| `Result<T,E>` | `result.ts` | Discriminated union (`ok`/`err`), no exceptions for expected failures |

All schemas use Zod. Entities and VOs validate props at construction time.

### Key Aggregates

- **Slice** -- status transitions enforced by `SliceStatusVO` (discussing -> researching -> planning -> executing -> verifying -> reviewing -> completing -> closed)
- **WorkflowSession** -- finite state machine driven by `TRANSITION_TABLE` with guards (`isSTier`, `notSTier`, `allSlicesClosed`, `retriesExhausted`) and effects (`incrementRetry`, `savePreviousPhase`, etc.)
- **ExecutionSession** -- tracks agent execution lifecycle (created -> running -> paused/completed/failed)
- **Checkpoint** -- execution state snapshot for pause/resume
- **Review** -- code review records with verdict, findings, agent identity

### Domain Events

Events follow naming convention `{Entity}{Action}Event` (e.g., `SliceStatusChangedEvent`, `ExecutionPausedEvent`). Published via `EventBusPort`, consumed by handlers in the application layer.

### Ports (Interfaces)

Ports are abstract classes in `domain/ports/` within each hexagon, plus cross-cutting ports in `src/kernel/ports/`.

| Port | Location | Purpose |
|------|----------|---------|
| `EventBusPort` | kernel | Publish/subscribe domain events |
| `GitPort` | kernel | Branch, commit, worktree, diff operations |
| `GitHubPort` | kernel | PR creation, queries |
| `StateSyncPort` | kernel | Push/pull state to git branches |
| `LoggerPort` | kernel | Structured logging |
| `DateProviderPort` | kernel | Clock abstraction |
| `AgentEventPort` | kernel | Agent lifecycle event streaming |
| `OverlayDataPort` | kernel | Dashboard data queries |
| `SliceRepositoryPort` | slice | CRUD for slices |
| `TaskRepositoryPort` | task | CRUD for tasks |
| `WorktreePort` | execution | Git worktree lifecycle |
| `OverseerPort` | execution | Agent oversight strategy |
| `OutputGuardrailPort` | execution | Output validation rules |
| `SliceTransitionPort` | workflow | Slice status changes from workflow |
| `ArtifactFilePort` | workflow | Read/write spec, research, plan files |
| `ReviewUIPort` | review | Human review interaction (terminal or plannotator) |
| `FixerPort` | review | Auto-fix review findings via agent |
| `MergeGatePort` | review | PR merge approval |

## Application Layer

Use cases live in `application/` or `use-cases/` per hexagon. Naming convention: `{verb}-{noun}.use-case.ts`.

| Hexagon | Key Use Cases |
|---------|--------------|
| **project** | `InitProjectUseCase` |
| **settings** | `LoadSettingsUseCase`, `MergeSettingsUseCase`, `ResolveModelUseCase` |
| **workflow** | `StartDiscussUseCase`, `ClassifyComplexityUseCase`, `WritePlanUseCase`, `WriteResearchUseCase`, `WriteSpecUseCase`, `OrchestratePhaseTransitionUseCase`, `GetStatusUseCase`, `SuggestNextStepUseCase` |
| **execution** | `ExecuteSliceUseCase`, `ExecutionCoordinatorUseCase`, `RollbackSliceUseCase`, `ReplayJournalUseCase`, `RecordTaskMetricsUseCase`, `AggregateMetricsUseCase`, `CleanupOrphanedWorktreesUseCase` |
| **task** | `CreateTasksUseCase`, `DetectWavesUseCase` |
| **review** | `ConductReviewUseCase`, `VerifyAcceptanceCriteriaUseCase`, `ShipSliceUseCase`, `CompleteMilestoneUseCase` |

## Infrastructure Layer

### Adapter Naming Convention

- `InMemory*` -- test doubles and initial implementations
- `Sqlite*` -- persistent storage (better-sqlite3)
- `Git*` / `GhCli*` -- Git/GitHub CLI wrappers
- `Node*` -- Node.js filesystem adapters
- `Pi*` -- PI SDK agent dispatch adapters
- `Markdown*` -- Markdown file persistence
- `Plannotator*` -- External plannotator tool integration
- `Bead*` -- Bead issue tracker integration

### PI SDK Integration (`src/infrastructure/pi/`)

Shared helpers for the PI coding agent SDK. `createZodTool` wraps Zod schemas into PI tool definitions. Each hexagon registers its tools via `infrastructure/pi/*.tool.ts` files and extensions (`*.extension.ts`).

### Persistence Strategy

Repositories use in-memory adapters by default, with SQLite adapters for `ShipRecord`, `CompletionRecord`, and milestone/project/slice/task persistence. State files live in `.tff/` (gitignored).

## CLI / Composition Root

| File | Role |
|------|------|
| `src/cli/main.ts` | Entry point (PI session bootstrap) |
| `src/cli/extension.ts` | **Composition root** -- wires all ports to adapters, registers hexagon extensions |
| `src/cli/overlay.extension.ts` | TUI overlay (dashboard, workflow status, execution monitor) |
| `src/cli/components/` | Overlay UI components (`DashboardComponent`, `WorkflowComponent`, `ExecutionMonitorComponent`) |

## Data Flow

A typical slice lifecycle request flows as follows:

```
User command (PI tool call)
  -> PI extension handler (infrastructure/pi/*.tool.ts)
    -> Use case (application layer)
      -> Aggregate method (domain layer)
        -> Domain event emitted
      -> Repository port (persist via adapter)
    -> EventBus dispatches events to handlers
  -> Tool result returned to PI agent
```

Workflow phase transitions specifically:

```
WorkflowTransitionTool -> OrchestratePhaseTransitionUseCase
  -> WorkflowSession.transition(trigger, guardContext)
    -> TRANSITION_TABLE lookup + guard evaluation
    -> Effects applied (retry count, phase save, etc.)
    -> WorkflowPhaseChangedEvent emitted
  -> SliceTransitionPort.transition() (updates Slice status)
  -> EventBus.publish()
```

## Module Boundaries

- Hexagons communicate only through ports and domain events -- never by direct import of another hexagon's domain
- The kernel is the only shared dependency allowed in domain layers
- Cross-hexagon coordination happens in the CLI composition root or via event bus subscriptions
- The `SliceTransitionPort` in the workflow hexagon is implemented by an adapter in the slice hexagon, maintaining boundary separation

---

*Last generated: 2026-04-04*
