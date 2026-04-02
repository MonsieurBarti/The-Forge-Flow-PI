# M03-S05: Discuss Command — Research

## Existing Infrastructure (Reuse)

| Component | Location | Notes |
|---|---|---|
| WorkflowSession aggregate | `hexagons/workflow/domain/` | Full state machine, `trigger()`, `assignSlice()`, guards |
| OrchestratePhaseTransitionUseCase | `hexagons/workflow/use-cases/` | Session transitions + slice status sync via SliceTransitionPort |
| SliceTransitionPort + adapter | `hexagons/workflow/` | Wired in CLI extension via `WorkflowSliceTransitionAdapter` |
| GuardContext | `hexagons/workflow/domain/` | `complexityTier`, `retryCount`, `maxRetries`, `allSlicesClosed` |
| createZodTool | `infrastructure/pi/` | Zod schema → JSON Schema bridge, used by `tff_status` |
| InProcessEventBus | `kernel/` | In-memory pub/sub, sequential handler execution |
| AutonomyPolicy | `hexagons/settings/` | `shouldAutoTransition(phase, mode)`, `getHumanGates(mode)` |
| Context staging (S04) | `hexagons/workflow/infrastructure/` | `InMemoryContextStagingAdapter`, phase-skill mapping |
| Result helpers | `kernel/result.ts` | `ok()`, `err()`, `isOk()`, `isErr()`, `match()` |

## New Components Required

### Domain Layer

- **ArtifactFilePort** (`hexagons/workflow/domain/ports/artifact-file.port.ts`)
  - `write(milestoneLabel, sliceLabel, artifactType, content) → Result<string, FileIOError>`
  - `read(milestoneLabel, sliceLabel, artifactType) → Result<string | null, FileIOError>`
  - ArtifactType: spec → SPEC.md, plan → PLAN.md, research → RESEARCH.md, checkpoint → CHECKPOINT.md

- **FileIOError** (`hexagons/workflow/domain/errors/file-io.error.ts`)
  - Extends `WorkflowBaseError`, code = `WORKFLOW.FILE_IO`

- **AutonomyModeProvider** (interface)
  - `getAutonomyMode(): AutonomyMode`
  - Decouples StartDiscussUseCase from settings loading

### Use Cases

- **StartDiscussUseCase**: Load slice → find/create session → `assignSlice` → `trigger('start')` → save → publish events
  - Dependencies: sliceRepo, sessionRepo, eventBus, dateProvider, autonomyModeProvider
  - Error cases: SliceNotFoundError, SliceAlreadyAssignedError, NoMatchingTransitionError

- **WriteSpecUseCase**: `artifactFilePort.write()` → load slice → `slice.setSpecPath(path)` → save
  - Dependencies: artifactFilePort, sliceRepo, dateProvider

- **ClassifyComplexityUseCase**: Load slice → `slice.setComplexity(tier)` → save
  - Dependencies: sliceRepo, dateProvider

### Slice Aggregate Mutations

- `setSpecPath(path: string, now: Date)` — new business method, updates `specPath` + `updatedAt`
- `setComplexity(tier: ComplexityTier, now: Date)` — new business method, direct tier assignment (vs. existing `classify(criteria, now)` which computes tier from criteria)

### Tools

- **tff_write_spec**: schema `{milestoneLabel, sliceLabel, sliceId, content}` → WriteSpecUseCase
- **tff_classify_complexity**: schema `{sliceId, tier}` → ClassifyComplexityUseCase
- **tff_workflow_transition**: schema `{milestoneId, trigger, complexityTier?}` → OrchestratePhaseTransitionUseCase
  - Key detail: constructs GuardContext internally (reads retryCount/maxRetries from session, allSlicesClosed from sliceRepo, complexityTier from param or slice entity)

### Infrastructure

- **NodeArtifactFileAdapter** (`infrastructure/artifact/`)
  - Path: `{projectRoot}/.tff/milestones/{milestoneLabel}/slices/{sliceLabel}/{FILENAME}`
  - `mkdir -p` + UTF-8 read/write via `node:fs/promises`

- **InMemoryArtifactFileAdapter** (`infrastructure/artifact/`)
  - `Map<string, string>` keyed by `"{milestoneLabel}/{sliceLabel}/{artifactType}"`

### Command + Protocol

- **tff:discuss command**: resolves slice → calls StartDiscussUseCase → sends DISCUSS_PROTOCOL_MESSAGE
- **DISCUSS_PROTOCOL_MESSAGE**: Template with `{sliceId}`, `{sliceLabel}`, `{milestoneLabel}`, `{milestoneId}`, `{sliceTitle}`, `{sliceDescription}`, `{autonomyMode}` — instructs 3-phase Q&A, tool calls at gates, spec reviewer dispatch, autonomy handling

### Wiring Changes

- `WorkflowExtensionDeps` gains: `artifactFile: ArtifactFilePort`, `workflowSessionRepo: WorkflowSessionRepositoryPort`
- `registerWorkflowExtension` instantiates 3 use cases, registers 3 tools + 1 command
- `createTffExtension` wires `NodeArtifactFileAdapter` with `projectRoot`

## Integration Risks

1. **GuardContext construction in tool** — `tff_workflow_transition` must internally build GuardContext from session + sliceRepo state. This is a new pattern; the existing `OrchestratePhaseTransitionUseCase` receives `guardContext` as input from the caller. The tool becomes the "smart caller" that assembles context before delegating to the use case.

2. **Cross-hexagon AutonomyModeProvider** — Bridges settings hexagon → workflow hexagon. Must avoid direct import of settings internals. Simple interface + adapter wired at CLI extension level.

3. **Slice barrel export gap** — Slice hexagon currently exports `SliceRepositoryPort` and `SliceNotFoundError` but not the `Slice` aggregate or `ComplexityTierSchema`. WriteSpecUseCase and ClassifyComplexityUseCase need slice access through the repository port (load → mutate → save), which is the correct pattern. `ComplexityTierSchema` needs barrel export for the tool schema.

## Dependencies

- S04 (Context Staging Area) — **closed**, provides `ContextStagingPort` and `InMemoryContextStagingAdapter`
- No blocking dependencies on S06-S08
- `tff_workflow_transition` tool is reusable by S06 (Research) and S07 (Plan) commands
