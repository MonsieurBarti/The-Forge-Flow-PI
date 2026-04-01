# M05-S04: Research — Multi-Stage Review Pipeline

## R1: Kernel Port Move — AgentDispatchPort + AgentDispatchError

### Current State
- `AgentDispatchPort` in `execution/domain/ports/agent-dispatch.port.ts` — imports only `@kernel` types
- `AgentDispatchError` in `execution/domain/errors/agent-dispatch.error.ts` — imports only `BaseDomainError` from `@kernel`
- Both are **fully generic** (no execution-specific fields)
- `AgentDispatchConfig` + `AgentResult` already live in `@kernel/agents`

### Import Graph (source files only)

**AgentDispatchPort** — 4 files:
| File | Import |
|---|---|
| `execution/infrastructure/agent-dispatch.contract.spec.ts:5` | `type { AgentDispatchPort }` from relative |
| `execution/infrastructure/pi-agent-dispatch.adapter.ts:30` | `{ AgentDispatchPort }` from relative |
| `execution/infrastructure/in-memory-agent-dispatch.adapter.ts:4` | `{ AgentDispatchPort }` from relative |
| `execution/application/execute-slice.use-case.ts:28` | `type { AgentDispatchPort }` from relative |

**AgentDispatchError** — 9 files:
| File | Import |
|---|---|
| `execution/domain/ports/agent-dispatch.port.ts:3` | `type { AgentDispatchError }` from relative |
| `execution/domain/errors/agent-dispatch.error.spec.ts:2` | `{ AgentDispatchError }` from relative |
| `execution/infrastructure/agent-dispatch.contract.spec.ts:4` | `{ AgentDispatchError }` from relative |
| `execution/infrastructure/pi-agent-dispatch.adapter.ts:29` | `{ AgentDispatchError }` from relative |
| `execution/infrastructure/pi-agent-dispatch.adapter.integration.spec.ts:9` | `type { AgentDispatchError }` from relative |
| `execution/infrastructure/in-memory-agent-dispatch.adapter.ts:3` | `{ AgentDispatchError }` from relative |
| `execution/infrastructure/in-memory-agent-dispatch.adapter.spec.ts:3` | `type { AgentDispatchError }` from relative |
| `execution/application/execute-slice.use-case.ts:17` | `type { AgentDispatchError }` from relative |
| `execution/application/execute-slice.use-case.spec.ts:23` | `type { AgentDispatchError }` from relative |

### Barrel Exports
- `execution/index.ts:47` — `export { AgentDispatchError } from "./domain/errors/agent-dispatch.error"`
- `execution/index.ts:143` — `export { AgentDispatchPort } from "./domain/ports/agent-dispatch.port"`

### Move Plan
1. Copy both files to `src/kernel/agents/`
2. Update internal import in port file: `AgentDispatchError` from `./agent-dispatch.error` (same dir)
3. Add exports to `src/kernel/agents/index.ts`
4. Update all 9 execution files to import from `@kernel/agents`
5. Change execution barrel (lines 47, 143) to re-export from `@kernel/agents` (NOT delete)
6. Move `agent-dispatch.error.spec.ts` to `src/kernel/agents/` alongside the error

### Risk: None
All consumers are within execution hexagon. No cross-hexagon imports exist yet. Clean mechanical refactor.

---

## R2: AgentResult.output is a String — JSON.parse Required

### AgentResult Schema (`@kernel/agents/agent-result.schema.ts`)
```
AgentResult: {
  taskId: string, agentType: AgentType,
  status: "DONE" | "DONE_WITH_CONCERNS" | "NEEDS_CONTEXT" | "BLOCKED",
  output: string,            // <-- RAW TEXT, not parsed JSON
  filesChanged: string[],
  concerns: AgentConcern[],
  selfReview: SelfReviewChecklist,
  cost: AgentCost,
  durationMs: number,
  error?: string,
}
```

### Implication for ConductReviewUseCase
Step 8 must: `JSON.parse(agentResult.output)` before `critiqueReflectionService.processResult(parsed)`.
Parse failure -> degraded (0 findings, not abort) per AC25.

For standard (spec-reviewer) results, the output also needs JSON parsing to extract findings. The spec-reviewer prompt must instruct the agent to return structured JSON.

### Test Pattern
`InMemoryAgentDispatchAdapter` + `AgentResultBuilder`:
- `new AgentResultBuilder().withTaskId(id).withOutput(JSON.stringify(critiqueReflectionResult)).build()`
- `givenResult(taskId, ok(result))` for sync dispatch
- `givenDelayedResult(taskId, ok(result), delayMs)` for timeout tests

---

## R3: Model Resolution — Happens Before Use Case

### Flow
1. `AgentCard.defaultModelProfile` (e.g., `"quality"`) — from `AGENT_REGISTRY`
2. settings.yaml `model-profiles.quality.model` (e.g., `"opus"`) — from `.tff/settings.yaml`
3. `ResolvedModel` (e.g., `{ provider: "anthropic", modelId: "claude-opus-4-6" }`) — pre-resolved

### How ExecuteSliceUseCase Does It
- `ExecuteSliceInput.model` is already a `ResolvedModel` — resolved upstream
- `PromptBuilder` receives it as config, passes through to `AgentDispatchConfig`

### Implication for ConductReviewUseCase
- Use case needs a `ResolvedModel` per reviewer role
- Resolution: `getAgentCard(role).defaultModelProfile` -> lookup in settings -> `ResolvedModel`
- Options:
  A. Pass a `modelResolver: (profile: ModelProfileName) => ResolvedModel` function to the use case
  B. Pre-resolve all 3 models and pass as part of `ConductReviewRequest`
  C. Inject a `ModelResolverPort` abstraction

**Recommended: Option A** — simplest, no new port, injectable function. The composition root provides the resolver.

---

## R4: GitPort.diff() Gap — Branch-to-Branch Diff Missing

### Current GitPort Methods
- `diff(cwd)` → `git -C <cwd> diff` — **working tree changes only** (unstaged)
- `diffNameOnly(cwd)` → `git -C <cwd> diff --name-only` — file paths only

### Problem
Review needs **committed changes between milestone branch and slice branch** (e.g., `git diff milestone/M05...HEAD`). Neither existing method provides this.

### Solution: Add `diffAgainst(base, cwd)` to GitPort

```typescript
// kernel/ports/git.port.ts — NEW method
abstract diffAgainst(base: string, cwd: string): Promise<Result<string, GitError>>;

// kernel/infrastructure/git-cli.adapter.ts — implementation
async diffAgainst(base: string, cwd: string): Promise<Result<string, GitError>> {
  return this.runGit(["-C", cwd, "diff", `${base}...HEAD`]);
}
```

### Impact
- Kernel port extension (1 new abstract method)
- Must add to `GitPort`, `GitCliAdapter`, `InMemoryGitAdapter` (if exists)
- `GitChangedFilesAdapter` calls `gitPort.diffAgainst(milestoneBranch, workingDirectory)`
- Need to resolve milestone branch name from sliceId (e.g., sliceId -> milestone label -> `milestone/M05`)

### Alternative: `ChangedFilesPort` adapter calls git directly
Rejected — violates hexagonal boundaries. Kernel port is the right place.

---

## R5: BeadSliceSpecAdapter — Use ArtifactFilePort

### Current Pattern
`ArtifactFilePort` (workflow hexagon) reads SPEC.md:
```typescript
abstract read(milestoneLabel: string, sliceLabel: string, artifactType: "spec")
  : Promise<Result<string | null, FileIOError>>
```

Maps to: `.tff/milestones/{milestoneLabel}/slices/{sliceLabel}/SPEC.md`

### Problem
`ArtifactFilePort` is in the **workflow hexagon** — review hexagon cannot import it directly (import boundary).

### Solution Options
A. **Review hexagon defines own `SliceSpecPort`** (already in spec) + adapter reads file directly using `node:fs` — avoids cross-hexagon import
B. **SliceSpecPort adapter receives a function** `(sliceId) => Promise<string | null>` — composition root wires it to ArtifactFilePort
C. **Move ArtifactFilePort to kernel** — overkill

**Recommended: Option B** — `BeadSliceSpecAdapter` receives a `readSpec: (milestoneLabel, sliceLabel) => Promise<Result<string | null, FileIOError>>` function. Composition root wires it to `artifactFilePort.read(milestone, slice, "spec")`.

### AC Extraction
SPEC.md has a `## Acceptance Criteria` section. Extract via string search for the heading and capture everything until the next `## ` heading or EOF.

---

## R6: ReviewPromptBuilder — buildStandard() Replacement

### Current Implementation (`review/application/review-prompt-builder.ts`)
```typescript
private buildStandard(config: ReviewPromptConfig): string {
  return [
    `# Review: ${config.sliceLabel} — ${config.sliceTitle}`,
    `Role: ${config.role}`,
    `Slice: ${config.sliceId}`,
    "", "## Changed Files", config.changedFiles,
    "", "## Acceptance Criteria", config.acceptanceCriteria,
  ].join("\n");
}
```

Inline string join. Does NOT use `this.templateLoader`. No placeholder interpolation.

### S04 Change
Replace with template-loaded approach matching `buildCTR()`:
```typescript
private buildStandard(config: ReviewPromptConfig): string {
  const template = this.templateLoader("prompts/standard-review.md");
  return template
    .replace(/\{\{sliceLabel\}\}/g, config.sliceLabel)
    .replace(/\{\{sliceTitle\}\}/g, config.sliceTitle)
    .replace(/\{\{sliceId\}\}/g, config.sliceId)
    .replace(/\{\{reviewRole\}\}/g, config.role)
    .replace(/\{\{changedFiles\}\}/g, config.changedFiles)
    .replace(/\{\{acceptanceCriteria\}\}/g, config.acceptanceCriteria);
}
```

### Test Impact
Existing tests verify:
- Standard prompt does NOT contain "PASS 1" or "PASS 2" ✓ (still true)
- No raw `{{...}}` tokens ✓ (must update test to provide template loader that reads new file)
- Template loader called with correct path (new assertion needed)

---

## R7: Event Registration — event-names.ts

### Current State
- 20 events in `EVENT_NAMES` object
- `event-names.spec.ts:7` asserts `toHaveLength(20)`
- Pattern: `REVIEW_RECORDED: "review.recorded"` (existing review event)

### S04 Addition
```typescript
REVIEW_PIPELINE_COMPLETED: "review.pipeline-completed",
```
Following pattern: `review.*` namespace for review hexagon events.

Update spec assertion to `toHaveLength(21)`.

---

## R8: Import Boundary Compatibility

### Review Application Layer Rules
Allowed imports: `../domain/`, `zod`, `node:*`, `@kernel`

`@kernel/agents` matches `@kernel` prefix via regex `/^@kernel/` → **PASS**

### Verified
`ConductReviewUseCase` in `review/application/` can safely import:
- `AgentDispatchPort` from `@kernel/agents` ✓
- `AgentDispatchConfig`, `AgentResult` from `@kernel/agents` ✓
- `getAgentCard` from `@kernel/agents` ✓
- All domain ports/services from `../domain/` ✓

---

## R9: InMemoryAgentDispatchAdapter — Test Pattern for S04

### Key Methods
- `givenResult(taskId, Result)` — synchronous return
- `givenDelayedResult(taskId, Result, delayMs)` — delayed via setTimeout
- `abort(taskId)` — clears timeout, resolves with `AgentDispatchError.sessionAborted()`
- `dispatchedConfigs` — getter for assertion (all dispatched configs)
- Default behavior: returns success with `AgentResultBuilder` defaults if no result configured

### Contract Spec Pattern
```typescript
interface TestConfigurator {
  givenSuccess(taskId): void;
  givenFailure(taskId, error): void;
  givenDelayed(taskId, delayMs): void;
  reset(): void;
}
```

### Usage for S04 Tests
```typescript
// 3 parallel reviewers
adapter.givenResult(codeReviewerTaskId, ok(codeReviewerResult));
adapter.givenResult(specReviewerTaskId, ok(specReviewerResult));
adapter.givenResult(securityAuditorTaskId, ok(securityAuditorResult));

// Timeout test
adapter.givenDelayedResult(taskId, ok(result), 600_000); // exceeds timeout
// After timeout, adapter.abort(taskId) resolves with sessionAborted error

// Retry test
adapter.givenResult(taskId, err(AgentDispatchError.unexpectedFailure(taskId, "fail")));
// After first dispatch fails, use case retries — need to reconfigure for retry
// InMemoryAdapter returns same result for same taskId — may need different taskId per attempt
```

### Important: Retry Test Pattern
`InMemoryAgentDispatchAdapter` uses `Map<taskId, Result>`. If the same taskId is retried, it returns the same configured result. For retry testing:
- Option A: Use different taskIds per attempt (uuid per dispatch call)
- Option B: Mutate the result map between attempts (call `givenResult` again)

Since S04 generates a new `taskId` per dispatch (UUID per reviewer per cycle), Option A works naturally.

---

## R10: Composition Root — Extension Registration Pattern

### Current Pattern in extension.ts
```typescript
export function createTffExtension(api: ExtensionAPI, options: TffExtensionOptions): void {
  const logger = new ConsoleLoggerAdapter();
  const eventBus = new InProcessEventBus(logger);
  const dateProvider = new SystemDateProvider();
  // ... repos ...
  registerProjectExtension(api, { /* deps */ });
  registerWorkflowExtension(api, { /* deps */ });
  registerExecutionExtension(api, { /* deps */ });
}
```

### S04 Addition
Either:
A. Add `registerReviewExtension(api, deps)` — new function in review hexagon
B. Inline wiring in `createTffExtension()` — simpler for now

**Recommended: Option A** if the review extension will register multiple commands (review, ship, verify). For S04 alone, Option B suffices. Decision deferred to planning.

---

## Summary: Spec Adjustments Needed

| # | Finding | Spec Impact |
|---|---------|-------------|
| R4 | GitPort missing `diffAgainst()` | Add to scope: new kernel port method + adapter |
| R3 | Model resolution not in use case | Add `modelResolver` function to constructor or request |
| R5 | ArtifactFilePort is workflow-hexagon | BeadSliceSpecAdapter receives injected read function |
| R9 | InMemory retry needs different taskIds | Confirmed: S04 generates UUID per dispatch, compatible |
| R6 | buildStandard() test needs updating | Note in plan: update existing test expectations |
