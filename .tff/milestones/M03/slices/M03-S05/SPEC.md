# M03-S05: Discuss Command

## Problem

The workflow engine needs a discuss command (`/tff:discuss`) that drives multi-turn Q&A to produce a validated SPEC.md and classify slice complexity. The conversation cannot be delegated to a subagent — the orchestrator drives it directly.

## Approach

Hybrid: use cases manage state transitions and file I/O; the LLM drives the conversation naturally; tools expose use case operations.

Three focused tools: `tff_write_spec`, `tff_classify_complexity`, `tff_workflow_transition`. The `tff:discuss` command sends a protocol message that instructs the LLM to run the 3-phase Q&A (scope, approach, design), call tools at each gate, dispatch a spec reviewer via the Agent tool, and handle autonomy mode transitions.

## Design

### Ports

**ArtifactFilePort** (workflow hexagon):

```typescript
// hexagons/workflow/domain/ports/artifact-file.port.ts
export const ArtifactTypeSchema = z.enum(['spec', 'plan', 'research', 'checkpoint']);
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

export abstract class ArtifactFilePort {
  abstract write(
    milestoneLabel: string,
    sliceLabel: string,
    artifactType: ArtifactType,
    content: string,
  ): Promise<Result<string, FileIOError>>;

  abstract read(
    milestoneLabel: string,
    sliceLabel: string,
    artifactType: ArtifactType,
  ): Promise<Result<string | null, FileIOError>>;
}
```

Maps artifact types to filenames: `spec` -> `SPEC.md`, `plan` -> `PLAN.md`, `research` -> `RESEARCH.md`, `checkpoint` -> `CHECKPOINT.md`.

**FileIOError** (workflow hexagon):

```typescript
// hexagons/workflow/domain/errors/file-io.error.ts
export class FileIOError extends WorkflowBaseError {
  readonly code = "WORKFLOW.FILE_IO";
}
```

### Use Cases

**StartDiscussUseCase:**

```typescript
// hexagons/workflow/use-cases/start-discuss.use-case.ts

Dependencies:
  - sliceRepo: SliceRepositoryPort
  - sessionRepo: WorkflowSessionRepositoryPort
  - eventBus: EventBusPort
  - dateProvider: DateProviderPort
  - settingsProvider: AutonomyModeProvider (reads autonomy.mode from settings)

Input: { sliceId: string, milestoneId: string }
Steps:
  1. Load slice from sliceRepo by sliceId (validate it exists)
  2. Find workflow session by milestoneId via sessionRepo
  3. If no session: create one via WorkflowSession.createNew({
       id: crypto.randomUUID(),
       milestoneId,
       autonomyMode: settingsProvider.getAutonomyMode(),
       now: dateProvider.now()
     })
  4. Assign slice to session via session.assignSlice(sliceId)
  5. Trigger 'start' transition: session.trigger('start', guardContext, dateProvider.now())
  6. Save session via sessionRepo.save(session)
  7. Publish domain events via eventBus
Output: Result<{ sessionId, fromPhase, toPhase, autonomyMode }, WorkflowBaseError | SliceNotFoundError | PersistenceError>

Error cases:
  - Slice not found -> SliceNotFoundError (imported from @hexagons/slice barrel — same cross-hexagon import pattern as SliceRepositoryPort)
  - Session already has active slice -> SliceAlreadyAssignedError
  - Invalid transition (not idle) -> NoMatchingTransitionError

Note: ID generation uses crypto.randomUUID() (consistent with codebase pattern in WorkflowSession, Slice aggregates).
```

**WriteSpecUseCase:**

```typescript
// hexagons/workflow/use-cases/write-spec.use-case.ts

Dependencies:
  - artifactFilePort: ArtifactFilePort
  - sliceRepo: SliceRepositoryPort
  - dateProvider: DateProviderPort

Input: { milestoneLabel: string, sliceLabel: string, sliceId: string, content: string }
Steps:
  1. artifactFilePort.write(milestoneLabel, sliceLabel, 'spec', content) -> path
  2. Load slice from sliceRepo by sliceId
  3. Call slice.setSpecPath(path, dateProvider.now()) (new Slice mutation — takes `now` for updatedAt)
  4. Save slice via sliceRepo.save(slice)
Output: Result<{ path: string }, FileIOError | SliceNotFoundError | PersistenceError>

Note: Slice aggregate needs a new `setSpecPath(path: string, now: Date)` business method (consistent with existing `classify(criteria, now)` pattern).
```

**ClassifyComplexityUseCase:**

```typescript
// hexagons/workflow/use-cases/classify-complexity.use-case.ts

Dependencies:
  - sliceRepo: SliceRepositoryPort
  - dateProvider: DateProviderPort

Input: { sliceId: string, tier: ComplexityTier }
Steps:
  1. Load slice from sliceRepo by sliceId
  2. Call slice.setComplexity(tier, dateProvider.now()) (new Slice mutation — takes `now` for updatedAt)
  3. Save slice via sliceRepo.save(slice)
Output: Result<{ sliceId: string, tier: ComplexityTier }, SliceNotFoundError | PersistenceError>

Note: Slice aggregate needs a new `setComplexity(tier: ComplexityTier, now: Date)` method. The existing `classify(criteria, now)` computes tier from criteria; `setComplexity(tier, now)` allows direct tier assignment when user confirms.
```

**OrchestratePhaseTransitionUseCase** (existing, reused for discussing -> researching/planning).

### Tools

**`tff_write_spec`:**

```typescript
schema: z.object({
  milestoneLabel: z.string().describe("Milestone label, e.g. M03"),
  sliceLabel: z.string().describe("Slice label, e.g. M03-S05"),
  sliceId: z.string().describe("Slice UUID"),
  content: z.string().describe("Markdown spec content"),
})
```

**`tff_classify_complexity`:**

```typescript
schema: z.object({
  sliceId: z.string().describe("Slice UUID"),
  tier: z.enum(["S", "F-lite", "F-full"]).describe("Complexity tier"),
})
```

**`tff_workflow_transition`** (generic, reusable by research/plan commands):

```typescript
schema: z.object({
  milestoneId: z.string().describe("Milestone UUID"),
  trigger: WorkflowTriggerSchema.describe("Workflow trigger: next, skip, approve, etc."),
  complexityTier: ComplexityTierSchema.optional().describe("Slice complexity tier if known"),
})
```

The tool implementation constructs the full `GuardContext` internally:
- `complexityTier`: from the LLM-provided parameter (or from slice entity if not provided)
- `retryCount`, `maxRetries`: read from session state and settings (never from LLM)
- `allSlicesClosed`: computed from sliceRepo query (never from LLM)

This prevents the LLM from needing to know session-internal state.

**Tool dependency chain:**
- `tff_write_spec` -> WriteSpecUseCase -> (artifactFilePort, sliceRepo, dateProvider)
- `tff_classify_complexity` -> ClassifyComplexityUseCase -> (sliceRepo, dateProvider)
- `tff_workflow_transition` -> OrchestratePhaseTransitionUseCase -> (sessionRepo, sliceTransitionPort, eventBus, dateProvider) + sliceRepo for guard context resolution

### Command Handler

```typescript
api.registerCommand("tff:discuss", {
  description: "Start the discuss phase for a slice — multi-turn Q&A producing SPEC.md",
  handler: async (args, ctx) => {
    // 1. Resolve target slice (from args or prompt user)
    // 2. Call StartDiscussUseCase
    // 3. Send protocol message with 3-phase discuss instructions
    ctx.sendUserMessage(DISCUSS_PROTOCOL_MESSAGE);
  },
});
```

The protocol message is a template interpolated with resolved values from the command handler:
- `{sliceId}`, `{sliceLabel}`, `{milestoneLabel}`, `{milestoneId}` — from resolved slice/milestone
- `{sliceTitle}`, `{sliceDescription}` — for LLM context on what's being discussed
- `{autonomyMode}` — from StartDiscussUseCase result

The interpolated protocol message instructs the LLM to:
1. Phase 1 (Scope): Ask 2-4 clarifying questions about the slice
2. Phase 2 (Approach): Propose 2-3 approaches, recommend one, user picks
3. Phase 3 (Design): Present section by section, user approves each
4. Call `tff_write_spec` with `{milestoneLabel}`, `{sliceLabel}`, `{sliceId}`, and the validated design content
5. Dispatch spec reviewer via Agent tool (max 3 iterations)
6. User gate: ask user to approve the spec
7. Call `tff_classify_complexity` with `{sliceId}` and user-confirmed tier
8. Call `tff_workflow_transition` with `{milestoneId}`, trigger `next` (or `skip`), and the confirmed tier
9. Check `{autonomyMode}`: plan-to-pr -> invoke next phase command; guided -> output next-step suggestion

### Adapters

**NodeArtifactFileAdapter** (`src/infrastructure/artifact/`):
- Constructs path: `{projectRoot}/.tff/milestones/{milestoneLabel}/slices/{sliceLabel}/{FILENAME}`
- Creates directories recursively via `node:fs/promises mkdir`
- Reads/writes UTF-8 markdown files

**InMemoryArtifactFileAdapter** (`src/infrastructure/artifact/`):
- `Map<string, string>` keyed by `"{milestoneLabel}/{sliceLabel}/{artifactType}"`
- For unit/integration tests

### Workflow Extension Wiring

`WorkflowExtensionDeps` gains:
- `artifactFile: ArtifactFilePort`
- `workflowSessionRepo: WorkflowSessionRepositoryPort`

`registerWorkflowExtension` instantiates:
- `StartDiscussUseCase(sliceRepo, sessionRepo, eventBus, dateProvider, autonomyModeProvider)`
- `WriteSpecUseCase(artifactFile, sliceRepo, dateProvider)`
- `ClassifyComplexityUseCase(sliceRepo, dateProvider)`
- `OrchestratePhaseTransitionUseCase(sessionRepo, sliceTransitionPort, eventBus, dateProvider)` — already defined, now instantiated

And registers the three tools + `tff:discuss` command.

**AutonomyModeProvider:** A simple interface `{ getAutonomyMode(): AutonomyMode }` to decouple StartDiscussUseCase from settings loading. The CLI extension wires it to read from `.tff/settings.yaml`.

### CLI Extension Wiring

`createTffExtension` instantiates `NodeArtifactFileAdapter` with `projectRoot` and passes it to `registerWorkflowExtension`.

## Acceptance Criteria

1. `tff:discuss` command registers via `api.registerCommand`, accepts a slice identifier, calls StartDiscussUseCase, and sends DISCUSS_PROTOCOL_MESSAGE via `ctx.sendUserMessage`
2. StartDiscussUseCase loads slice (validates existence), finds/creates workflow session (using DateProviderPort for `now`, crypto.randomUUID() for ID, AutonomyModeProvider for autonomyMode), calls `session.assignSlice(sliceId)`, triggers `start` transition (idle -> discussing), saves session, publishes domain events
3. WriteSpecUseCase writes SPEC.md to `.tff/milestones/{milestoneLabel}/slices/{sliceLabel}/SPEC.md` via ArtifactFilePort and calls `slice.setSpecPath(path)` to update the Slice aggregate
4. ClassifyComplexityUseCase calls `slice.setComplexity(tier)` with user-confirmed ComplexityTier (S | F-lite | F-full) — new Slice mutation method
5. `tff_workflow_transition` tool constructs GuardContext internally (reads retryCount/maxRetries from session, allSlicesClosed from sliceRepo, complexityTier from LLM param or slice entity), then calls OrchestratePhaseTransitionUseCase; discussing + next → researching (guard: notSTier) or planning (guard: isSTier); discussing + skip → planning
6. All use cases return `Result<T, E>` — no thrown exceptions in use case code
7. InMemoryArtifactFileAdapter and NodeArtifactFileAdapter both pass shared contract tests (write + read round-trip, read returns null for missing artifact, write creates directories)
8. DISCUSS_PROTOCOL_MESSAGE contains: Phase 1 (Scope: 2-4 clarifying questions), Phase 2 (Approach: 2-3 options with recommendation), Phase 3 (Design: section-by-section approval), spec reviewer dispatch via Agent tool (max 3 iterations), user gate for spec approval
9. StartDiscussUseCase returns SliceNotFoundError if sliceId doesn't exist, SliceAlreadyAssignedError if session has active slice, NoMatchingTransitionError if session not in idle phase
10. WriteSpecUseCase returns FileIOError when ArtifactFilePort.write fails (e.g., permission denied, disk full)
11. ClassifyComplexityUseCase returns SliceNotFoundError if sliceId doesn't exist in sliceRepo
12. After `tff_workflow_transition` succeeds, protocol message instructs LLM to check autonomy mode: plan-to-pr → LLM invokes next phase command (`/tff:research` or `/tff:plan`); guided → LLM outputs next-step suggestion text
13. `registerWorkflowExtension` registers all three tools (`tff_write_spec`, `tff_classify_complexity`, `tff_workflow_transition`) and the `tff:discuss` command
14. `WorkflowExtensionDeps` includes `artifactFile: ArtifactFilePort` and `workflowSessionRepo: WorkflowSessionRepositoryPort`; `createTffExtension` wires NodeArtifactFileAdapter
15. Slice aggregate gains `setSpecPath(path: string, now: Date)` and `setComplexity(tier: ComplexityTier, now: Date)` business methods (both update `updatedAt`) with corresponding tests
16. ArtifactFilePort maps artifact types to filenames: spec → SPEC.md, plan → PLAN.md, research → RESEARCH.md, checkpoint → CHECKPOINT.md

## Non-Goals

- Research command (M03-S06), Plan command (M03-S07)
- Full context staging integration (discuss doesn't dispatch agents via PI SDK)
- Beads/Dolt integration (TFF-PI uses hexagonal ports)
- tff-tools CLI (TFF-PI uses hexagonal ports)
- PI SDK createAgentSession dispatch (discuss uses built-in Agent tool for spec reviewer)
