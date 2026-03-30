# M03-S06: Research Command

## Problem

The workflow engine needs a research command (`/tff:research`) that dispatches an agent to investigate the codebase before planning. Research is optional for F-lite, required for F-full, and skipped for S-tier. The discuss command (S05) already transitions the workflow to "researching" state and produces SPEC.md. The research phase reads that spec, investigates the codebase, and produces structured RESEARCH.md findings.

## Approach

Protocol-driven command following S05's tool+protocol pattern, but architecturally simpler: the research command is a **read-only dispatcher** with no entry use case. Unlike discuss (which creates/mutates the workflow session via `StartDiscussUseCase`), the research command only validates preconditions and sends a protocol message. The sole use case (`WriteResearchUseCase`) is invoked by the LLM via tool call during execution, not by the command handler.

Protocol message drives the LLM, which dispatches a single Explore agent, synthesizes findings, writes RESEARCH.md via a dedicated tool, presents findings for user approval (max 2 investigation rounds), then transitions to planning.

New: research.command.ts, research-protocol.ts, WriteResearchUseCase, tff_write_research tool, Slice.setResearchPath(). Reuses: tff_workflow_transition, ArtifactFilePort (already supports 'research' type), NodeArtifactFileAdapter.

Note: `tff_write_research` uses `IdSchema` for sliceId (UUID validation) as an intentional improvement over `tff_write_spec` which uses plain `z.string()`. The existing `tff_write_spec` tool should be retrofitted to use `IdSchema` in this slice for consistency.

## Design

### Use Cases

**WriteResearchUseCase:**

```typescript
// hexagons/workflow/use-cases/write-research.use-case.ts

Dependencies:
  - artifactFilePort: ArtifactFilePort
  - sliceRepo: SliceRepositoryPort
  - dateProvider: DateProviderPort

Input: { milestoneLabel: string, sliceLabel: string, sliceId: string, content: string }
Steps:
  1. artifactFilePort.write(milestoneLabel, sliceLabel, 'research', content) -> path
  2. Load slice from sliceRepo by sliceId
  3. Call slice.setResearchPath(path, dateProvider.now())
  4. Save slice via sliceRepo.save(slice)
Output: Result<{ path: string }, FileIOError | SliceNotFoundError | PersistenceError>

Error cases:
  - Slice not found -> SliceNotFoundError
  - File write fails -> FileIOError
  - Repo save fails -> PersistenceError
```

Mirrors WriteSpecUseCase exactly, using 'research' artifact type.

### Tools

**`tff_write_research`:**

```typescript
// infrastructure/pi/write-research.tool.ts

const WriteResearchSchema = z.object({
  milestoneLabel: MilestoneLabelSchema.describe("Milestone label, e.g. M03"),
  sliceLabel: SliceLabelSchema.describe("Slice label, e.g. M03-S06"),
  sliceId: IdSchema.describe("Slice UUID"),
  content: z.string().describe("Markdown research content"),
});
```

Uses `IdSchema` from `@kernel` for UUID validation. Wraps WriteResearchUseCase. Returns `{ ok: true, path: "..." }` or error text.

Reused as-is: `tff_workflow_transition` handles `researching + next -> planning`.

### Command Handler

**`research.command.ts`** -- registers `/tff:research <slice-label-or-id>`:

```typescript
// infrastructure/pi/research.command.ts

interface ResearchCommandDeps {
  sliceRepo: SliceRepositoryPort;
  milestoneRepo: MilestoneRepositoryPort;
  sessionRepo: WorkflowSessionRepositoryPort;
  artifactFile: ArtifactFilePort;
}

Handler flow:
  1. Resolve slice by label or UUID (same pattern as discuss.command.ts)
  2. Load milestone from MilestoneRepositoryPort
  3. Load workflow session via WorkflowSessionRepositoryPort.findByMilestoneId()
     - If null: error "No workflow session found. Run /tff:discuss first."
  4. Validate session.currentPhase === 'researching'
     - If not: error "Slice {label} is in {phase}, not researching. Run /tff:discuss first."
  5. Read SPEC.md via ArtifactFilePort.read(milestoneLabel, sliceLabel, 'spec')
     - If FileIOError: error "Failed to read SPEC.md: {error.message}"
     - If null: error "No SPEC.md found. Run /tff:discuss first."
  6. Send protocol message via ctx.sendUserMessage(
       buildResearchProtocolMessage({
         sliceId, sliceLabel, milestoneLabel, milestoneId,
         sliceTitle, sliceDescription, specContent, autonomyMode
       })
     )
```

Registration via `registerResearchCommand(api, deps)` function called from `workflow.extension.ts`.

### Protocol Message

**`research-protocol.ts`** -- `buildResearchProtocolMessage(params)`:

Template variables: `{sliceId}`, `{sliceLabel}`, `{milestoneLabel}`, `{milestoneId}`, `{sliceTitle}`, `{sliceDescription}`, `{specContent}`, `{autonomyMode}`.

Protocol instructs the LLM to:

**Phase 1 -- Research Dispatch:**
1. Review the embedded SPEC.md content
2. Identify 3-5 key research questions from the spec (existing patterns, affected files/modules, dependencies, technical risks)
3. Dispatch a single Explore agent via Agent tool with research questions as the prompt, instructed to search codebase for patterns, files, and dependencies

**Phase 2 -- Synthesis:**
4. Receive agent findings
5. Synthesize into structured RESEARCH.md with sections:
   - Questions Investigated
   - Codebase Findings (Existing Patterns, Relevant Files, Dependencies)
   - Technical Risks
   - Recommendations for Planning
6. Call `tff_write_research` tool with synthesized content

**Phase 3 -- User Gate:**
7. Present concise summary of key findings to user
8. Ask: "Research complete. Approve to proceed to planning, or request deeper investigation?"
9. If user requests more: dispatch another Explore agent for specific area (max 2 total rounds), rewrite RESEARCH.md, ask again
10. On approval: call `tff_workflow_transition` with milestoneId, trigger `next`

**Auto-Transition:**
11. If autonomyMode='plan-to-pr': invoke `/tff:plan {sliceLabel}`
12. If autonomyMode='guided': suggest "Next: `/tff:plan {sliceLabel}`"

### Slice Aggregate Addition

```typescript
// In slice.aggregate.ts
setResearchPath(path: string, now: Date): void {
  this.props.researchPath = path;
  this.props.updatedAt = now;
}
```

Consistent with existing `setSpecPath(path, now)` pattern. No domain event emitted.

### Workflow Extension Wiring

`WorkflowExtensionDeps`: no new deps needed (ArtifactFilePort, SliceRepositoryPort, DateProviderPort already wired).

New instantiations:
- `WriteResearchUseCase(artifactFile, sliceRepo, dateProvider)`

New registrations:
- `tff_write_research` tool (via `createWriteResearchTool`)
- `tff:research` command (via `registerResearchCommand`)

`registerResearchCommand` receives: `sliceRepo`, `milestoneRepo`, `sessionRepo`, `artifactFile` (all already available in extension scope).

### Barrel Exports

Additions to `index.ts`:
- `WriteResearchUseCase` from use-cases
- `createWriteResearchTool` from infrastructure/pi
- `registerResearchCommand` from infrastructure/pi

## Acceptance Criteria

1. `tff:research` command registers via `api.registerCommand`, resolves slice by label or UUID (same dual-resolution pattern as discuss.command.ts), validates the workflow session is in `researching` phase, reads SPEC.md via ArtifactFilePort, and sends RESEARCH_PROTOCOL_MESSAGE via `ctx.sendUserMessage`
2. Command handler returns error if session phase is not `researching` ("not researching, run /tff:discuss first")
3. Command handler returns error if no workflow session exists for the milestone ("No workflow session found, run /tff:discuss first")
4. Command handler returns error if SPEC.md does not exist ("No SPEC.md found, run /tff:discuss first") or if ArtifactFilePort.read returns FileIOError ("Failed to read SPEC.md")
5. WriteResearchUseCase writes RESEARCH.md to `.tff/milestones/{milestoneLabel}/slices/{sliceLabel}/RESEARCH.md` via ArtifactFilePort and calls `slice.setResearchPath(path)` to update the Slice aggregate
6. WriteResearchUseCase returns FileIOError when ArtifactFilePort.write fails, SliceNotFoundError when slice doesn't exist, PersistenceError when repo save fails
7. `tff_write_research` tool schema uses `IdSchema` for sliceId (UUID validation), `MilestoneLabelSchema` for milestoneLabel, `SliceLabelSchema` for sliceLabel
8. Slice aggregate gains `setResearchPath(path: string, now: Date)` business method that updates `researchPath` and `updatedAt`, with corresponding tests
9. RESEARCH_PROTOCOL_MESSAGE embeds the full SPEC.md content and contains: Phase 1 (dispatch single Explore agent with research questions derived from spec), Phase 2 (synthesize findings into structured RESEARCH.md format), Phase 3 (user gate with approval or deeper investigation, max 2 rounds)
10. RESEARCH.md structure includes: Questions Investigated, Codebase Findings (Existing Patterns, Relevant Files, Dependencies), Technical Risks, Recommendations for Planning
11. After `tff_workflow_transition` succeeds, protocol message instructs LLM to check autonomy mode: plan-to-pr -> invoke `/tff:plan`; guided -> suggest next step
12. `registerWorkflowExtension` registers `tff_write_research` tool and `tff:research` command
13. `tff_write_spec` tool retrofitted to use `IdSchema` for sliceId, matching `tff_write_research` (consistency improvement)
14. `registerResearchCommand` accepts explicit `ResearchCommandDeps` interface: `{ sliceRepo, milestoneRepo, sessionRepo, artifactFile }`
15. All use cases return `Result<T, E>` -- no thrown exceptions in use case code

## Non-Goals

- Plan command (M03-S07)
- Multiple parallel research agents (single Explore agent sufficient)
- ContextStagingPort integration (research has no skills to inject)
- PI SDK createAgentSession dispatch (uses built-in Agent tool for research)
- Beads/Dolt integration (TFF-PI uses hexagonal ports)
