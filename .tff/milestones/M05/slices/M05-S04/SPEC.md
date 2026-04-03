# M05-S04: Multi-Stage Review Pipeline

## Problem

The review hexagon has domain primitives (Review aggregate, MergedReview VO, fresh-reviewer enforcement, critique-then-reflection processing) but no orchestrator to dispatch reviewer agents, collect results, merge findings, and drive the fixer loop. Without this use case, the ship workflow (S09) has no way to conduct a review.

## Approach

Single orchestrator use case (`ConductReviewUseCase`) in `review/application`. Takes a `sliceId`, resolves context via ports (spec + AC from workflow hexagon, changed files from git), dispatches 3 reviewer agents in parallel via `AgentDispatchPort` (moved to `@kernel/agents`), processes results through strategy-appropriate services (CTR for code-reviewer/security-auditor, standard for spec-reviewer), merges findings via `MergedReview.merge()`, and drives the fixer loop via `FixerPort` if blockers exist.

Key design decisions:
- **Reuse `AgentDispatchPort`**: moved from execution hexagon to kernel so both hexagons can depend on it without cross-hexagon imports
- **SliceId-driven**: use case resolves all inputs from domain state, not caller-provided DTOs
- **Two granular context ports**: `SliceSpecPort` (spec + AC) and `ChangedFilesPort` (git diff) -- separate concerns, separate adapters
- **S04 orchestrates fixer loop, S07 fills behavior**: `FixerPort` abstraction with `StubFixerAdapter` that defers all findings
- **All 3 reviewers required**: failed reviewer retried once; if still fails, `ConductReviewError`
- **Per-agent timeout**: `Promise.allSettled` with `AbortController`-style timeout; aborted dispatch cleaned up

## Scope

### In Scope
- `ConductReviewUseCase` (application layer orchestrator)
- `ConductReviewRequest` / `ConductReviewResult` schemas
- `SliceSpecPort` + `SliceSpecError` (outbound port -- spec + AC)
- `ChangedFilesPort` + `ChangedFilesError` (outbound port -- git diff)
- `FixerPort` + `FixerError` + `FixRequest` / `FixResult` schemas
- `ConductReviewError` (typed factory methods)
- `ReviewPipelineCompletedEvent` (domain event)
- `StubFixerAdapter` (defers all findings -- S07 fills real logic)
- `BeadSliceSpecAdapter` (reads SPEC.md via injected read function from ArtifactFilePort)
- `GitChangedFilesAdapter` (branch-to-branch diff via git port)
- `GitPort.diffAgainst(base, cwd)` — new kernel port method for branch comparison
- Move `AgentDispatchPort` + `AgentDispatchError` from execution to `@kernel/agents`
- `modelResolver` function dependency for profile-to-ResolvedModel resolution
- `standard-review.md` prompt template (spec-reviewer)
- `ReviewPromptBuilder` update: real standard template (S03 stubbed)
- Composition root wiring in `extension.ts`
- Barrel export updates

### Out of Scope
- Fixer agent internal behavior (S07)
- Review UI presentation (S05)
- Agent authoring protocol (S06)
- Ship command / PR creation (S09)
- Persistent cache for reviewer results
- Human-in-the-loop during review (S05/S09 concern)

## Design

### Kernel Refactor: AgentDispatchPort Move

Move `AgentDispatchPort` + `AgentDispatchError` from `execution/domain/` to `@kernel/agents/`. Both types are generic (use `taskId` identifier, no execution-specific fields). Config + Result schemas already in kernel. Update all execution hexagon imports. `execution/index.ts` must re-export `AgentDispatchPort` and `AgentDispatchError` from `@kernel/agents` (not delete the exports) to avoid breaking any downstream code that imports from the execution barrel.

```
@kernel/agents/
  agent-dispatch.schema.ts    (existing)
  agent-dispatch.port.ts      <- MOVED
  agent-dispatch.error.ts     <- MOVED
  agent-card.schema.ts        (existing)
  agent-registry.ts           (existing)
  index.ts                    <- update exports

execution/domain/ports/
  agent-dispatch.port.ts      <- DELETED
execution/domain/errors/
  agent-dispatch.error.ts     <- DELETED
```

### New Ports

#### SliceSpecPort

```typescript
// review/domain/ports/slice-spec.port.ts
interface SliceSpec {
  sliceId: string;
  sliceLabel: string;     // e.g. "M05-S04"
  sliceTitle: string;
  specContent: string;
  acceptanceCriteria: string;
}

abstract class SliceSpecPort {
  abstract getSpec(sliceId: string): Promise<Result<SliceSpec, SliceSpecError>>;
}
```

#### ChangedFilesPort

```typescript
// review/domain/ports/changed-files.port.ts
abstract class ChangedFilesPort {
  abstract getDiff(sliceId: string, workingDirectory: string): Promise<Result<string, ChangedFilesError>>;
}
```

Note: `workingDirectory` needed because `GitPort.diff()` requires a cwd to resolve the slice branch vs milestone branch.

#### FixerPort

```typescript
// review/domain/ports/fixer.port.ts
interface FixRequest {
  sliceId: string;
  findings: FindingProps[];
  workingDirectory: string;
}

interface FixResult {
  fixed: FindingProps[];     // addressed
  deferred: FindingProps[];  // pushed back with reason
  testsPassing: boolean;
}

abstract class FixerPort {
  abstract fix(request: FixRequest): Promise<Result<FixResult, FixerError>>;
}
```

### ConductReviewUseCase

```typescript
// review/application/conduct-review.use-case.ts
class ConductReviewUseCase {
  constructor(
    sliceSpecPort: SliceSpecPort,
    changedFilesPort: ChangedFilesPort,
    freshReviewerService: FreshReviewerService,    // encapsulates ExecutorQueryPort internally
    agentDispatchPort: AgentDispatchPort,
    critiqueReflectionService: CritiqueReflectionService,
    reviewPromptBuilder: ReviewPromptBuilder,
    modelResolver: (profile: ModelProfileName) => ResolvedModel,
    fixerPort: FixerPort,
    reviewRepository: ReviewRepositoryPort,
    eventBus: EventBusPort,
    dateProvider: DateProviderPort,
    logger: LoggerPort,
  )

  async execute(request: ConductReviewRequest)
    : Promise<Result<ConductReviewResult, ConductReviewError>>
}
```

**Orchestration flow:**

1. `spec = sliceSpecPort.getSpec(sliceId)`
2. `diff = changedFilesPort.getDiff(sliceId)`
3. `roles = [code-reviewer, spec-reviewer, security-auditor]`
4. `forall role: freshReviewerService.enforce(sliceId, agentId)`
5. `forall role: prompt = reviewPromptBuilder.build({role, spec, diff})`
6. `results = Promise.allSettled(forall role: dispatchWithTimeout(role, prompt, timeoutMs))`
7. `forall failed: retry once -> if still fails -> ConductReviewError`
8. `forall result: if CTR role -> JSON.parse(agentResult.output) -> critiqueReflectionService.processResult(parsed)`
    Note: `AgentResult.output` is a string. Must JSON.parse before passing to `processResult(rawResult: unknown)`. Parse failure -> degraded (0 findings, per AC25).
9. `reviews = forall result: Review.createNew({...}, dateProvider.now()) + recordFindings(findings, dateProvider.now())`
10. `merged = MergedReview.merge(reviews, dateProvider.now())`
11. `reviewRepository.save(forall review)`
12. `if merged.hasBlockers() AND cycle < maxFixCycles: fixerPort.fix(ALL findings) -> goto step 2`
    Note: ALL findings passed to fixer (not just blockers); `hasBlockers()` is only the gate for entering the loop. Fixer decides per-finding whether to fix or defer.
    Note: Loop restarts at step 2 (re-fetch diff), NOT step 3. The fixer may have changed files, so the diff must be refreshed. Spec (step 1) is NOT re-fetched (spec doesn't change).
13. Emit `ReviewPipelineCompletedEvent`
14. Return `{ merged, reviews, fixCycles }`

**Building AgentDispatchConfig per reviewer:**
- `taskId`: generated UUID per dispatch (unique per reviewer per cycle)
- `sliceId`: from `ConductReviewRequest.sliceId`
- `agentType`: maps directly from `ReviewRole` (values overlap: `"code-reviewer"`, `"spec-reviewer"`, `"security-auditor"`)
- `workingDirectory`: from `ConductReviewRequest.workingDirectory`
- `systemPrompt`: output of `reviewPromptBuilder.build({role, spec, diff})`
- `taskPrompt`: brief instruction (e.g., "Review the changes and return structured findings as JSON")
- `model`: `this.modelResolver(getAgentCard(role).defaultModelProfile)` -> `ResolvedModel`
- `tools`: from `getAgentCard(role).requiredTools` (Read, Glob, Grep -- read-only)
- `filePaths`: empty (reviewers discover files via diff context in prompt)

**Agent identity and re-review semantics:**
- `agentIdentity` is role-based (e.g., `"code-reviewer-<uuid>"`), unique per role within a pipeline execution
- AC5 "distinct agentIdentity" means the 3 roles get different identities, NOT that identities change across fix cycles
- Fresh-reviewer enforcement on re-review is a genuine check (defense in depth), but will pass for the same identities since reviewer agents are never executors
- After `abort()` on timeout, the dispatch promise may still resolve in the background -- the timed-out result is discarded (not double-processed)

**Parallel dispatch with timeout:**

```
dispatchWithTimeout(role, prompt, timeoutMs):
  race(
    agentDispatch.dispatch(config),
    timeout(timeoutMs)
  )
  timeout -> agentDispatch.abort(taskId) -> { role, status: 'timed_out' }
  error   -> { role, status: 'failed', error }
  ok      -> { role, status: 'completed', result }
```

**Per-reviewer retry:**
- Each reviewer dispatched independently
- On failure or timeout: retry that specific reviewer once
- If retry also fails: `ConductReviewError.reviewerRetryExhausted()`
- All 3 must succeed (no degraded mode)

### Schemas

```typescript
// review/domain/conduct-review.schemas.ts
ConductReviewRequestSchema = z.object({
  sliceId: IdSchema,
  workingDirectory: z.string().min(1),
  timeoutMs: z.number().int().positive().default(300_000),  // 5 min
  maxFixCycles: z.number().int().nonnegative().default(2),
});

ConductReviewResultSchema = z.object({
  mergedReview: MergedReviewPropsSchema,       // from final cycle only
  individualReviews: z.array(ReviewPropsSchema), // ALL reviews from ALL cycles (3 * (1 + fixCyclesUsed))
  fixCyclesUsed: z.number().int().nonnegative(),
  timedOutReviewers: z.array(ReviewRoleSchema),  // roles that timed out (across all cycles)
  retriedReviewers: z.array(ReviewRoleSchema),   // roles that were retried (across all cycles)
});
```

### Errors

```typescript
// review/domain/errors/conduct-review.error.ts
// Follows AgentDispatchError pattern: private constructor + readonly code
class ConductReviewError extends BaseDomainError {
  readonly code: string;
  private constructor(code: string, message: string, metadata?: Record<string, unknown>)

  static contextResolutionFailed(sliceId, cause)
    // code: "REVIEW.CONTEXT_RESOLUTION_FAILED"
  static allReviewersFailed(sliceId, failures[])
    // code: "REVIEW.ALL_REVIEWERS_FAILED"
  static reviewerRetryExhausted(sliceId, role, cause)
    // code: "REVIEW.REVIEWER_RETRY_EXHAUSTED"
  static freshReviewerBlocked(sliceId, role, violation)
    // code: "REVIEW.FRESH_REVIEWER_BLOCKED"
  static mergeError(sliceId, cause)
    // code: "REVIEW.MERGE_FAILED"
}

// review/domain/errors/fixer.error.ts
class FixerError extends BaseDomainError {
  code = "REVIEW.FIXER_FAILED"
}

// review/domain/errors/review-context.error.ts
class SliceSpecError extends BaseDomainError {
  code = "REVIEW.SLICE_SPEC_FAILED"
}

class ChangedFilesError extends BaseDomainError {
  code = "REVIEW.CHANGED_FILES_FAILED"
}
```

### Events

```typescript
// review/domain/events/review-pipeline-completed.event.ts
class ReviewPipelineCompletedEvent extends DomainEvent {
  props: {
    sliceId: string;
    verdict: ReviewVerdict;
    reviewCount: number;
    findingsCount: number;
    blockerCount: number;
    conflictCount: number;
    fixCyclesUsed: number;
    timedOutRoles: ReviewRole[];
    retriedRoles: ReviewRole[];
  }
}
```

### Infrastructure Adapters

**StubFixerAdapter:** Returns all findings as deferred, testsPassing = true. S07 fills real behavior.

**BeadSliceSpecAdapter:** Reads SPEC.md from bead store for the given sliceId. Extracts acceptance criteria section. Returns `SliceSpec`.

**GitChangedFilesAdapter:** Runs git diff between slice branch and milestone branch via git port. Returns unified diff string.

### Prompt Template Update

**New: `src/resources/prompts/standard-review.md`** -- spec-reviewer prompt with AC checklist. Placeholders: `{{reviewRole}}`, `{{sliceLabel}}`, `{{sliceTitle}}`, `{{acceptanceCriteria}}`, `{{changedFiles}}`.

**Modified: `ReviewPromptBuilder.build()`** -- CTR roles load `critique-then-reflection.md` (S03), standard roles load `standard-review.md` (S04). All `{{...}}` placeholders interpolated.

### Composition Root Wiring

`extension.ts` instantiates:
- `BeadSliceSpecAdapter((m, s) => artifactFilePort.read(m, s, "spec"))` — injected read function from workflow hexagon's ArtifactFilePort
- `GitChangedFilesAdapter(gitPort)` — uses new `gitPort.diffAgainst(base, cwd)` method
- `StubFixerAdapter()`
- `modelResolver = (profile) => settingsAdapter.resolveModel(profile)` — resolves profile name to ResolvedModel
- `ConductReviewUseCase(sliceSpecAdapter, changedFilesAdapter, freshReviewerService, piAgentDispatchAdapter, critiqueReflectionService, reviewPromptBuilder, modelResolver, stubFixer, reviewRepository, eventBus, dateProvider, logger)`

Note: `FreshReviewerService` receives `CachedExecutorQueryAdapter` at its own construction site. `ConductReviewUseCase` does not interact with `ExecutorQueryPort` directly.

### Directory Structure

```
NEW:
src/kernel/agents/
  agent-dispatch.port.ts              <- MOVED
  agent-dispatch.error.ts             <- MOVED

src/hexagons/review/
  domain/
    ports/
      slice-spec.port.ts              <- NEW
      changed-files.port.ts           <- NEW
      fixer.port.ts                   <- NEW
    errors/
      conduct-review.error.ts         <- NEW
      review-context.error.ts         <- NEW
      fixer.error.ts                  <- NEW
    events/
      review-pipeline-completed.event.ts <- NEW
    conduct-review.schemas.ts         <- NEW
  application/
    conduct-review.use-case.ts        <- NEW
  infrastructure/
    stub-fixer.adapter.ts             <- NEW
    bead-slice-spec.adapter.ts        <- NEW
    git-changed-files.adapter.ts      <- NEW

src/resources/prompts/
  standard-review.md                  <- NEW

MODIFIED:
src/kernel/agents/index.ts            (re-export port + error)
src/kernel/ports/git.port.ts          (add diffAgainst method)
src/kernel/infrastructure/git-cli.adapter.ts (implement diffAgainst)
src/kernel/event-names.ts             (add REVIEW_PIPELINE_COMPLETED)
src/kernel/event-names.spec.ts        (update count assertion)
src/hexagons/execution/domain/ports/  (delete old port file)
src/hexagons/execution/domain/errors/ (delete old error file)
src/hexagons/execution/**             (update imports to @kernel/agents)
src/hexagons/review/application/review-prompt-builder.ts (real standard template)
src/hexagons/review/index.ts          (new exports)
src/cli/extension.ts                  (composition root wiring)
```

## Error Handling

| Scenario | Behavior |
|---|---|
| SliceSpecPort or ChangedFilesPort fails | `ConductReviewError.contextResolutionFailed()` -- pipeline aborts |
| Fresh-reviewer violation for any role | `ConductReviewError.freshReviewerBlocked()` -- pipeline aborts |
| ExecutorQueryError from FreshReviewerService | `ConductReviewError.contextResolutionFailed()` -- pipeline aborts (fail-closed) |
| Single reviewer timeout | Abort dispatch, retry once. If retry fails: `ConductReviewError.reviewerRetryExhausted()` |
| All 3 reviewers fail | `ConductReviewError.allReviewersFailed()` |
| CritiqueReflectionService parse error | Review for that role has 0 findings (degraded but not blocked) |
| MergedReview.merge() error | `ConductReviewError.mergeError()` |
| FixerPort fails | Log error, stop fixer loop, return current merged result |
| Max fix cycles reached | Return merged result with `fixCyclesUsed = maxFixCycles` |

## Testing Strategy

| Layer | Target | Method |
|---|---|---|
| Domain unit | ConductReviewUseCase | Stub all ports, verify orchestration flow |
| Domain unit | ConductReviewError | Factory methods produce correct codes + metadata |
| Domain unit | ReviewPipelineCompletedEvent | Schema validation |
| Application | Parallel dispatch + timeout | Stub dispatch with delays, verify allSettled + abort |
| Application | Per-reviewer retry | Stub dispatch: fail first call, succeed retry |
| Application | All-fail scenario | Stub dispatch: all fail twice -> ConductReviewError |
| Application | Fixer loop | Stub fixer, verify max cycles respected |
| Application | Fixer loop re-review | Verify re-dispatch after fix (new reviews created) |
| Application | CTR vs standard routing | Verify CTR service called for code-reviewer/security-auditor, not for spec-reviewer |
| Infra unit | StubFixerAdapter | Returns all findings as deferred |
| Infra unit | BeadSliceSpecAdapter | Mock bead store, verify spec extraction |
| Infra unit | GitChangedFilesAdapter | Mock git port, verify diff command |
| Integration | Full pipeline | InMemory adapters, 3 stub reviewers, end-to-end flow |
| Refactor | Kernel port move | All existing execution hexagon tests pass after move |

## Acceptance Criteria

### Parallel Dispatch
- AC1: All 3 dispatch calls initiated before awaiting any result; results collected via `Promise.allSettled` (failure of one does not cancel others)
- AC2: Per-agent timeout: dispatch aborted via `agentDispatch.abort(taskId)` after `timeoutMs` elapses
- AC3: A reviewer whose dispatch fails or times out is retried exactly once; if retry also fails/times out, `ConductReviewError.reviewerRetryExhausted(sliceId, role, cause)` is returned
- AC4: All 3 reviewers fail after retry -> `ConductReviewError.allReviewersFailed(sliceId, failures)`
- AC5: Each of the 3 reviewer dispatch calls uses a distinct `agentIdentity` value within the same pipeline execution

### Fresh-Reviewer Wiring
- AC6: `FreshReviewerService.enforce()` called for every reviewer before dispatch is initiated
- AC7: Fresh-reviewer violation for any role -> `ConductReviewError.freshReviewerBlocked()` -- pipeline aborts (not silent skip)

### Result Processing
- AC8: CTR roles (code-reviewer, security-auditor) processed via `CritiqueReflectionService.processResult()`
- AC9: Standard role (spec-reviewer) NOT processed via `CritiqueReflectionService`
- AC10: 3 `Review` aggregates created (one per reviewer) and each saved individually via `reviewRepository.save(review)`

### Findings Merge
- AC11: `MergedReview.merge()` invoked with the 3 individual reviews; deduplicates by `(filePath, lineStart)` (S01 VO behavior)
- AC12: Contradictions flagged when same `(filePath, lineStart)` has severity diff >= 2 levels (S01 VO behavior)
- AC13: Merged verdict derived from individual review verdicts: exists `rejected` -> `rejected`; exists `changes_requested` -> `changes_requested`; else `approved` (S01 VO behavior)

### Fixer Loop
- AC14: `fixerPort.fix()` invoked when `merged.hasBlockers()` returns true (critical or high findings present)
- AC15: Fixer loop terminates after exactly `maxFixCycles` fix-then-re-review iterations; result returned with `fixCyclesUsed = maxFixCycles`
- AC16: After fix, all 3 reviewers re-dispatched (full re-review cycle with fresh-reviewer enforcement re-applied)
- AC17: `StubFixerAdapter.fix()` returns `{ fixed: [], deferred: request.findings, testsPassing: true }` for any input

### Prompt Builder
- AC18: File `src/resources/prompts/standard-review.md` exists with placeholders `{{reviewRole}}`, `{{sliceLabel}}`, `{{sliceTitle}}`, `{{acceptanceCriteria}}`, `{{changedFiles}}`
- AC19: `ReviewPromptBuilder.build()` for spec-reviewer loads `standard-review.md`; output contains zero raw `{{...}}` tokens

### Composition Root
- AC20: `extension.ts` instantiates `ConductReviewUseCase` and TypeScript compiler accepts it with no type errors (type-level dependency verification)

### Kernel Refactor
- AC21: `AgentDispatchPort` + `AgentDispatchError` exported from `@kernel/agents` (files in `src/kernel/agents/`)
- AC22: All existing execution hexagon tests pass after move (zero regressions)

### Events
- AC23: `ReviewPipelineCompletedEvent` emitted with all schema fields: `sliceId`, `verdict`, `reviewCount`, `findingsCount`, `blockerCount`, `conflictCount`, `fixCyclesUsed`, `timedOutRoles`, `retriedRoles`

### Error Paths
- AC24: `SliceSpecPort` or `ChangedFilesPort` failure -> `ConductReviewError.contextResolutionFailed()` -- pipeline aborts before dispatch
- AC25: `CritiqueReflectionService` parse error for a CTR role -> that role's review recorded with 0 findings (degraded, not abort)
- AC26: `FixerPort.fix()` failure -> fixer loop stops, current merged result returned (no `ConductReviewError`)

## Dependencies

- S01 (closed): Review aggregate, MergedReview VO, ReviewRepositoryPort, ReviewRecordedEvent, FindingPropsSchema
- S02 (closed): FreshReviewerService, ExecutorQueryPort, CachedExecutorQueryAdapter
- S03 (closed): CritiqueReflectionService, ReviewPromptBuilder, strategyForRole()
- `@kernel`: BaseDomainError, DomainEvent, IdSchema, Result, AgentDispatchConfig, AgentResult
- `@kernel/agents`: AgentDispatchPort (after move), AgentCard, getAgentCard()
- Execution hexagon (public API): PiAgentDispatchAdapter (composition root only)
