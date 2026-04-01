# M05-S04: Multi-Stage Review Pipeline — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Build `ConductReviewUseCase` — orchestrates 3 parallel reviewer agents, merges findings, drives fixer loop.
**Architecture:** Hexagonal (review hexagon application layer) + kernel refactor (AgentDispatchPort move).
**Tech Stack:** TypeScript, Zod, Vitest, hexagonal DDD.

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/kernel/agents/agent-dispatch.port.ts` | AgentDispatchPort (moved from execution) |
| `src/kernel/agents/agent-dispatch.error.ts` | AgentDispatchError (moved from execution) |
| `src/kernel/agents/agent-dispatch.error.spec.ts` | Error spec (moved from execution) |
| `src/hexagons/review/domain/ports/slice-spec.port.ts` | SliceSpecPort + SliceSpec interface |
| `src/hexagons/review/domain/ports/changed-files.port.ts` | ChangedFilesPort |
| `src/hexagons/review/domain/ports/fixer.port.ts` | FixerPort + FixRequest/FixResult |
| `src/hexagons/review/domain/errors/conduct-review.error.ts` | ConductReviewError (5 factory methods) |
| `src/hexagons/review/domain/errors/review-context.error.ts` | SliceSpecError + ChangedFilesError |
| `src/hexagons/review/domain/errors/fixer.error.ts` | FixerError |
| `src/hexagons/review/domain/events/review-pipeline-completed.event.ts` | ReviewPipelineCompletedEvent |
| `src/hexagons/review/domain/conduct-review.schemas.ts` | ConductReviewRequest/Result schemas |
| `src/hexagons/review/application/conduct-review.use-case.ts` | ConductReviewUseCase |
| `src/hexagons/review/infrastructure/stub-fixer.adapter.ts` | StubFixerAdapter |
| `src/hexagons/review/infrastructure/bead-slice-spec.adapter.ts` | BeadSliceSpecAdapter |
| `src/hexagons/review/infrastructure/git-changed-files.adapter.ts` | GitChangedFilesAdapter |
| `src/resources/prompts/standard-review.md` | Spec-reviewer prompt template |

### Modified Files
| File | Change |
|------|--------|
| `src/kernel/agents/index.ts` | Re-export AgentDispatchPort + AgentDispatchError |
| `src/kernel/ports/git.port.ts` | Add `diffAgainst(base, cwd)` method |
| `src/kernel/infrastructure/git-cli.adapter.ts` | Implement `diffAgainst` |
| `src/kernel/event-names.ts` | Add `REVIEW_PIPELINE_COMPLETED` |
| `src/kernel/event-names.spec.ts` | Update count 20→21 |
| `src/hexagons/execution/index.ts` | Re-export from `@kernel/agents` |
| `src/hexagons/execution/**` | ~9 import path updates |
| `src/hexagons/review/application/review-prompt-builder.ts` | `buildStandard()` loads template |
| `src/hexagons/review/index.ts` | New exports |
| `src/cli/extension.ts` | Wire ConductReviewUseCase |

---

## Wave 0 — Kernel + Domain Foundation (parallel)

### T01: Move AgentDispatchPort + AgentDispatchError to kernel

**Files:**
- Move `src/hexagons/execution/domain/ports/agent-dispatch.port.ts` → `src/kernel/agents/agent-dispatch.port.ts`
- Move `src/hexagons/execution/domain/errors/agent-dispatch.error.ts` → `src/kernel/agents/agent-dispatch.error.ts`
- Move `src/hexagons/execution/domain/errors/agent-dispatch.error.spec.ts` → `src/kernel/agents/agent-dispatch.error.spec.ts`
- Modify `src/kernel/agents/index.ts`
- Modify `src/hexagons/execution/index.ts` (lines 47, 143)
- Modify 9 execution files (update relative imports → `@kernel/agents`)

**Traces to:** AC21, AC22

**Steps:**
1. Copy `agent-dispatch.port.ts` to `src/kernel/agents/agent-dispatch.port.ts`. Update internal import:
   ```typescript
   import type { Result } from "@kernel";
   import type { AgentDispatchConfig, AgentResult } from "./agent-dispatch.schema";
   import type { AgentDispatchError } from "./agent-dispatch.error";
   ```
2. Copy `agent-dispatch.error.ts` to `src/kernel/agents/agent-dispatch.error.ts`. Update import:
   ```typescript
   import { BaseDomainError } from "@kernel/errors";
   ```
3. Copy `agent-dispatch.error.spec.ts` to `src/kernel/agents/agent-dispatch.error.spec.ts`. Update import:
   ```typescript
   import { AgentDispatchError } from "./agent-dispatch.error";
   ```
4. Add to `src/kernel/agents/index.ts`:
   ```typescript
   export { AgentDispatchPort } from "./agent-dispatch.port";
   export { AgentDispatchError } from "./agent-dispatch.error";
   ```
5. Update `src/hexagons/execution/index.ts` lines 47 and 143:
   ```typescript
   export { AgentDispatchError } from "@kernel/agents";
   export { AgentDispatchPort } from "@kernel/agents";
   ```
6. Update all 9 execution files to import from `@kernel/agents`:
   - `execution/infrastructure/agent-dispatch.contract.spec.ts` — lines 4, 5
   - `execution/infrastructure/pi-agent-dispatch.adapter.ts` — lines 29, 30
   - `execution/infrastructure/in-memory-agent-dispatch.adapter.ts` — lines 3, 4
   - `execution/infrastructure/in-memory-agent-dispatch.adapter.spec.ts` — line 3
   - `execution/infrastructure/pi-agent-dispatch.adapter.integration.spec.ts` — line 9
   - `execution/application/execute-slice.use-case.ts` — lines 17, 28
   - `execution/application/execute-slice.use-case.spec.ts` — line 23
7. Delete original files from execution hexagon.
8. Run: `npx vitest run --reporter=verbose 2>&1 | tail -5`
   **Expect:** All existing tests PASS (zero regressions).
9. Commit: `refactor(S04/T01): move AgentDispatchPort + Error to @kernel/agents`

---

### T02: Add GitPort.diffAgainst + REVIEW_PIPELINE_COMPLETED event name

**Files:**
- Modify `src/kernel/ports/git.port.ts`
- Modify `src/kernel/infrastructure/git-cli.adapter.ts`
- Create `src/kernel/infrastructure/git-cli.adapter.diffAgainst.spec.ts` (or add to existing spec)
- Modify `src/kernel/event-names.ts`
- Modify `src/kernel/event-names.spec.ts`

**Traces to:** AC23 (partial)

**Steps:**
1. Add to `src/kernel/ports/git.port.ts` (after line 24, before closing `}`):
   ```typescript
   abstract diffAgainst(base: string, cwd: string): Promise<Result<string, GitError>>;
   ```
2. Write test for `diffAgainst` — create or extend spec to verify `runGit` called with `["-C", cwd, "diff", "${base}...HEAD"]`.
3. Add to `src/kernel/infrastructure/git-cli.adapter.ts` (after `diff()` method):
   ```typescript
   async diffAgainst(base: string, cwd: string): Promise<Result<string, GitError>> {
     return this.runGit(["-C", cwd, "diff", `${base}...HEAD`]);
   }
   ```
4. Add to `src/kernel/event-names.ts` (in EVENT_NAMES object):
   ```typescript
   REVIEW_PIPELINE_COMPLETED: "review.pipeline-completed",
   ```
   And add to EventNameSchema z.enum array:
   ```typescript
   EVENT_NAMES.REVIEW_PIPELINE_COMPLETED,
   ```
4. Update `src/kernel/event-names.spec.ts` line 7:
   ```typescript
   expect(Object.keys(EVENT_NAMES)).toHaveLength(21);
   ```
5. Run: `npx vitest run src/kernel/ --reporter=verbose 2>&1 | tail -5`
   **Expect:** All kernel tests PASS.
6. Commit: `feat(S04/T02): add GitPort.diffAgainst + REVIEW_PIPELINE_COMPLETED event name`

---

### T03: Domain ports — SliceSpecPort, ChangedFilesPort, FixerPort

**Files:**
- Create `src/hexagons/review/domain/ports/slice-spec.port.ts`
- Create `src/hexagons/review/domain/ports/changed-files.port.ts`
- Create `src/hexagons/review/domain/ports/fixer.port.ts`

**Traces to:** Foundation for AC1-AC26

**Steps:**
1. Create `src/hexagons/review/domain/ports/slice-spec.port.ts`:
   ```typescript
   import type { Result } from "@kernel";
   import { z } from "zod";
   import type { SliceSpecError } from "../errors/review-context.error";

   export const SliceSpecSchema = z.object({
     sliceId: z.string().min(1),
     sliceLabel: z.string().min(1),
     sliceTitle: z.string().min(1),
     specContent: z.string().min(1),
     acceptanceCriteria: z.string().min(1),
   });
   export type SliceSpec = z.infer<typeof SliceSpecSchema>;

   export abstract class SliceSpecPort {
     abstract getSpec(sliceId: string): Promise<Result<SliceSpec, SliceSpecError>>;
   }
   ```
2. Create `src/hexagons/review/domain/ports/changed-files.port.ts`:
   ```typescript
   import type { Result } from "@kernel";
   import type { ChangedFilesError } from "../errors/review-context.error";

   export abstract class ChangedFilesPort {
     abstract getDiff(
       sliceId: string,
       workingDirectory: string,
     ): Promise<Result<string, ChangedFilesError>>;
   }
   ```
3. Create `src/hexagons/review/domain/ports/fixer.port.ts`:
   ```typescript
   import type { Result } from "@kernel";
   import { z } from "zod";
   import { FindingPropsSchema } from "../review.schemas";
   import type { FixerError } from "../errors/fixer.error";

   export const FixRequestSchema = z.object({
     sliceId: z.string().min(1),
     findings: z.array(FindingPropsSchema),
     workingDirectory: z.string().min(1),
   });
   export type FixRequest = z.infer<typeof FixRequestSchema>;

   export const FixResultSchema = z.object({
     fixed: z.array(FindingPropsSchema),
     deferred: z.array(FindingPropsSchema),
     testsPassing: z.boolean(),
   });
   export type FixResult = z.infer<typeof FixResultSchema>;

   export abstract class FixerPort {
     abstract fix(request: FixRequest): Promise<Result<FixResult, FixerError>>;
   }
   ```
4. Write schema tests for `SliceSpecSchema`, `FixRequestSchema`, `FixResultSchema` — valid/invalid payloads.
5. Run: `npx vitest run src/hexagons/review/domain/ports/ --reporter=verbose 2>&1 | tail -5`
   **Expect:** PASS.

   Note: test files (`*.spec.ts`) are exempt from import boundary checks — they can import `InMemoryAgentDispatchAdapter` from `@hexagons/execution`.
5. Commit: `feat(S04/T03): add SliceSpecPort, ChangedFilesPort, FixerPort`

---

### T04: Domain errors — ConductReviewError, SliceSpecError, ChangedFilesError, FixerError

**Files:**
- Create `src/hexagons/review/domain/errors/conduct-review.error.ts`
- Create `src/hexagons/review/domain/errors/conduct-review.error.spec.ts`
- Create `src/hexagons/review/domain/errors/review-context.error.ts`
- Create `src/hexagons/review/domain/errors/fixer.error.ts`

**Traces to:** AC3, AC4, AC7, AC24

**Steps:**
1. Create `src/hexagons/review/domain/errors/conduct-review.error.ts`:
   ```typescript
   import { BaseDomainError } from "@kernel";
   import type { ReviewRole } from "../review.schemas";

   export class ConductReviewError extends BaseDomainError {
     readonly code: string;

     private constructor(code: string, message: string, metadata?: Record<string, unknown>) {
       super(message, metadata);
       this.code = code;
     }

     static contextResolutionFailed(sliceId: string, cause: unknown): ConductReviewError {
       const msg = cause instanceof Error ? cause.message : String(cause);
       return new ConductReviewError(
         "REVIEW.CONTEXT_RESOLUTION_FAILED",
         `Failed to resolve review context for slice ${sliceId}: ${msg}`,
         { sliceId, cause: msg },
       );
     }

     static allReviewersFailed(sliceId: string, failures: Array<{ role: string; cause: string }>): ConductReviewError {
       return new ConductReviewError(
         "REVIEW.ALL_REVIEWERS_FAILED",
         `All reviewers failed for slice ${sliceId} after retry`,
         { sliceId, failures },
       );
     }

     static reviewerRetryExhausted(sliceId: string, role: ReviewRole, cause: unknown): ConductReviewError {
       const msg = cause instanceof Error ? cause.message : String(cause);
       return new ConductReviewError(
         "REVIEW.REVIEWER_RETRY_EXHAUSTED",
         `Reviewer ${role} failed for slice ${sliceId} after retry: ${msg}`,
         { sliceId, role, cause: msg },
       );
     }

     static freshReviewerBlocked(sliceId: string, role: ReviewRole, reviewerId: string): ConductReviewError {
       return new ConductReviewError(
         "REVIEW.FRESH_REVIEWER_BLOCKED",
         `Fresh-reviewer violation: ${reviewerId} cannot review slice ${sliceId} as ${role}`,
         { sliceId, role, reviewerId },
       );
     }

     static mergeError(sliceId: string, cause: unknown): ConductReviewError {
       const msg = cause instanceof Error ? cause.message : String(cause);
       return new ConductReviewError(
         "REVIEW.MERGE_FAILED",
         `Failed to merge reviews for slice ${sliceId}: ${msg}`,
         { sliceId, cause: msg },
       );
     }
   }
   ```
2. Create `src/hexagons/review/domain/errors/review-context.error.ts`:
   ```typescript
   import { BaseDomainError } from "@kernel";

   export class SliceSpecError extends BaseDomainError {
     readonly code = "REVIEW.SLICE_SPEC_FAILED";
     constructor(message: string, metadata?: Record<string, unknown>) {
       super(message, metadata);
     }
   }

   export class ChangedFilesError extends BaseDomainError {
     readonly code = "REVIEW.CHANGED_FILES_FAILED";
     constructor(message: string, metadata?: Record<string, unknown>) {
       super(message, metadata);
     }
   }
   ```
3. Create `src/hexagons/review/domain/errors/fixer.error.ts`:
   ```typescript
   import { BaseDomainError } from "@kernel";

   export class FixerError extends BaseDomainError {
     readonly code = "REVIEW.FIXER_FAILED";
     constructor(message: string, metadata?: Record<string, unknown>) {
       super(message, metadata);
     }
   }
   ```
4. Write test `conduct-review.error.spec.ts` — verify all 5 factory methods produce correct codes and metadata.
5. Run: `npx vitest run src/hexagons/review/domain/errors/ --reporter=verbose 2>&1 | tail -10`
   **Expect:** PASS — all factory method tests green.
6. Commit: `feat(S04/T04): add ConductReviewError, SliceSpecError, ChangedFilesError, FixerError`

---

### T05: Domain schemas + ReviewPipelineCompletedEvent

**Files:**
- Create `src/hexagons/review/domain/conduct-review.schemas.ts`
- Create `src/hexagons/review/domain/conduct-review.schemas.spec.ts`
- Create `src/hexagons/review/domain/events/review-pipeline-completed.event.ts`
- Create `src/hexagons/review/domain/events/review-pipeline-completed.event.spec.ts`

**Traces to:** AC23

**Steps:**
1. Create `src/hexagons/review/domain/conduct-review.schemas.ts`:
   ```typescript
   import { IdSchema } from "@kernel";
   import { z } from "zod";
   import { MergedReviewPropsSchema } from "./merged-review.schemas";
   import { ReviewPropsSchema, ReviewRoleSchema } from "./review.schemas";

   export const ConductReviewRequestSchema = z.object({
     sliceId: IdSchema,
     workingDirectory: z.string().min(1),
     timeoutMs: z.number().int().positive().default(300_000),
     maxFixCycles: z.number().int().nonnegative().default(2),
   });
   export type ConductReviewRequest = z.infer<typeof ConductReviewRequestSchema>;

   export const ConductReviewResultSchema = z.object({
     mergedReview: MergedReviewPropsSchema,
     individualReviews: z.array(ReviewPropsSchema),
     fixCyclesUsed: z.number().int().nonnegative(),
     timedOutReviewers: z.array(ReviewRoleSchema),
     retriedReviewers: z.array(ReviewRoleSchema),
   });
   export type ConductReviewResult = z.infer<typeof ConductReviewResultSchema>;
   ```
2. Write schema spec — valid/invalid payloads, defaults applied.
3. Create `review-pipeline-completed.event.ts` following `ReviewRecordedEvent` pattern:
   ```typescript
   import { DomainEvent, DomainEventPropsSchema, EVENT_NAMES, type EventName, IdSchema } from "@kernel";
   import { z } from "zod";
   import { ReviewRoleSchema, ReviewVerdictSchema } from "../review.schemas";

   const ReviewPipelineCompletedEventPropsSchema = DomainEventPropsSchema.extend({
     sliceId: IdSchema,
     verdict: ReviewVerdictSchema,
     reviewCount: z.number().int().min(0),
     findingsCount: z.number().int().min(0),
     blockerCount: z.number().int().min(0),
     conflictCount: z.number().int().min(0),
     fixCyclesUsed: z.number().int().min(0),
     timedOutRoles: z.array(ReviewRoleSchema),
     retriedRoles: z.array(ReviewRoleSchema),
   });
   type ReviewPipelineCompletedEventProps = z.infer<typeof ReviewPipelineCompletedEventPropsSchema>;

   export class ReviewPipelineCompletedEvent extends DomainEvent {
     readonly eventName: EventName = EVENT_NAMES.REVIEW_PIPELINE_COMPLETED;
     readonly sliceId: string;
     readonly verdict: string;
     readonly reviewCount: number;
     readonly findingsCount: number;
     readonly blockerCount: number;
     readonly conflictCount: number;
     readonly fixCyclesUsed: number;
     readonly timedOutRoles: string[];
     readonly retriedRoles: string[];

     constructor(props: ReviewPipelineCompletedEventProps) {
       const parsed = ReviewPipelineCompletedEventPropsSchema.parse(props);
       super(parsed);
       this.sliceId = parsed.sliceId;
       this.verdict = parsed.verdict;
       this.reviewCount = parsed.reviewCount;
       this.findingsCount = parsed.findingsCount;
       this.blockerCount = parsed.blockerCount;
       this.conflictCount = parsed.conflictCount;
       this.fixCyclesUsed = parsed.fixCyclesUsed;
       this.timedOutRoles = [...parsed.timedOutRoles];
       this.retriedRoles = [...parsed.retriedRoles];
     }
   }
   ```
4. Write event spec — schema validation, all fields present.
5. Run: `npx vitest run src/hexagons/review/domain/conduct-review --reporter=verbose && npx vitest run src/hexagons/review/domain/events/review-pipeline --reporter=verbose`
   **Expect:** PASS.
6. Commit: `feat(S04/T05): add ConductReviewRequest/Result schemas + ReviewPipelineCompletedEvent`

---

## Wave 1 — Adapters + Prompt (parallel, depends on Wave 0)

### T06: Infrastructure adapters — StubFixer, BeadSliceSpec, GitChangedFiles

**Files:**
- Create `src/hexagons/review/infrastructure/stub-fixer.adapter.ts`
- Create `src/hexagons/review/infrastructure/stub-fixer.adapter.spec.ts`
- Create `src/hexagons/review/infrastructure/bead-slice-spec.adapter.ts`
- Create `src/hexagons/review/infrastructure/bead-slice-spec.adapter.spec.ts`
- Create `src/hexagons/review/infrastructure/git-changed-files.adapter.ts`
- Create `src/hexagons/review/infrastructure/git-changed-files.adapter.spec.ts`

**Traces to:** AC17, AC24

**Steps:**
1. Create `stub-fixer.adapter.ts`:
   ```typescript
   import { ok, type Result } from "@kernel";
   import type { FixerError } from "../domain/errors/fixer.error";
   import { FixerPort, type FixRequest, type FixResult } from "../domain/ports/fixer.port";

   export class StubFixerAdapter extends FixerPort {
     async fix(request: FixRequest): Promise<Result<FixResult, FixerError>> {
       return ok({
         fixed: [],
         deferred: [...request.findings],
         testsPassing: true,
       });
     }
   }
   ```
2. Test: call `fix()` with findings → assert `fixed=[], deferred=all, testsPassing=true`.
3. Create `bead-slice-spec.adapter.ts`:
   ```typescript
   import { err, ok, type Result } from "@kernel";
   import { SliceSpecError } from "../domain/errors/review-context.error";
   import { SliceSpecPort, type SliceSpec } from "../domain/ports/slice-spec.port";

   export class BeadSliceSpecAdapter extends SliceSpecPort {
     constructor(
       private readonly readSpec: (
         milestoneLabel: string,
         sliceLabel: string,
       ) => Promise<Result<string | null, Error>>,
       private readonly resolveLabels: (sliceId: string) => { milestoneLabel: string; sliceLabel: string; sliceTitle: string },
     ) {
       super();
     }

     async getSpec(sliceId: string): Promise<Result<SliceSpec, SliceSpecError>> {
       const { milestoneLabel, sliceLabel, sliceTitle } = this.resolveLabels(sliceId);
       const readResult = await this.readSpec(milestoneLabel, sliceLabel);
       if (!readResult.ok) {
         return err(new SliceSpecError(`Failed to read spec for ${sliceLabel}`, { sliceId, cause: readResult.error.message }));
       }
       if (readResult.data === null) {
         return err(new SliceSpecError(`No spec found for ${sliceLabel}`, { sliceId }));
       }
       const specContent = readResult.data;
       const acceptanceCriteria = this.extractAC(specContent);
       return ok({ sliceId, sliceLabel, sliceTitle, specContent, acceptanceCriteria });
     }

     private extractAC(content: string): string {
       const acIndex = content.indexOf("## Acceptance Criteria");
       if (acIndex === -1) return "";
       const afterAC = content.slice(acIndex);
       const nextHeading = afterAC.indexOf("\n## ", 1);
       return nextHeading === -1 ? afterAC : afterAC.slice(0, nextHeading);
     }
   }
   ```
4. Test: mock `readSpec` + `resolveLabels`, verify AC extraction.
5. Create `git-changed-files.adapter.ts`:
   ```typescript
   import { err, ok, type Result } from "@kernel";
   import type { GitPort } from "@kernel/ports";
   import { ChangedFilesError } from "../domain/errors/review-context.error";
   import { ChangedFilesPort } from "../domain/ports/changed-files.port";

   export class GitChangedFilesAdapter extends ChangedFilesPort {
     constructor(
       private readonly gitPort: GitPort,
       private readonly resolveMilestoneBranch: (sliceId: string) => string,
     ) {
       super();
     }

     async getDiff(sliceId: string, workingDirectory: string): Promise<Result<string, ChangedFilesError>> {
       const base = this.resolveMilestoneBranch(sliceId);
       const result = await this.gitPort.diffAgainst(base, workingDirectory);
       if (!result.ok) {
         return err(new ChangedFilesError(`Failed to get diff for slice ${sliceId}`, { sliceId, cause: result.error.message }));
       }
       return ok(result.data);
     }
   }
   ```
6. Test: mock `gitPort.diffAgainst()`, verify correct base branch passed.
7. Run: `npx vitest run src/hexagons/review/infrastructure/ --reporter=verbose 2>&1 | tail -10`
   **Expect:** PASS — all adapter tests green.
8. Commit: `feat(S04/T06): add StubFixerAdapter, BeadSliceSpecAdapter, GitChangedFilesAdapter`

---

### T07: ReviewPromptBuilder — standard template + update buildStandard

**Files:**
- Create `src/resources/prompts/standard-review.md`
- Modify `src/hexagons/review/application/review-prompt-builder.ts`
- Modify `src/hexagons/review/application/review-prompt-builder.spec.ts`

**Traces to:** AC18, AC19

**Steps:**
1. Create `src/resources/prompts/standard-review.md`:
   ```markdown
   # Spec Compliance Review: {{sliceLabel}} — {{sliceTitle}}

   **Role:** {{reviewRole}}
   **Slice ID:** {{sliceId}}

   ## Instructions

   Review the changed files against the acceptance criteria below. For each criterion, determine whether the implementation satisfies it.

   Return your findings as a JSON array of findings. Each finding must have:
   - `id`: unique UUID
   - `severity`: "critical" | "high" | "medium" | "low" | "info"
   - `message`: description of the issue
   - `filePath`: path to the affected file
   - `lineStart`: starting line number
   - `suggestion`: (optional) suggested fix

   If all acceptance criteria are met and no issues found, return an empty findings array.

   ## Changed Files

   {{changedFiles}}

   ## Acceptance Criteria

   {{acceptanceCriteria}}
   ```
2. Update `buildStandard()` in `review-prompt-builder.ts` to load the template:
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
3. Update spec to verify: template loader called with `"prompts/standard-review.md"`, no `{{...}}` tokens in output, does NOT contain "PASS 1" / "PASS 2".
4. Run: `npx vitest run src/hexagons/review/application/review-prompt-builder --reporter=verbose`
   **Expect:** PASS — all prompt builder tests green.
5. Commit: `feat(S04/T07): add standard-review.md template + update buildStandard`

---

## Wave 2 — ConductReviewUseCase (depends on Wave 1)

### T08: ConductReviewUseCase — parallel dispatch + timeout + retry

**Files:**
- Create `src/hexagons/review/application/conduct-review.use-case.ts`
- Create `src/hexagons/review/application/conduct-review.use-case.spec.ts`

**Traces to:** AC1, AC2, AC3, AC4, AC5, AC24

**Steps:**
1. Write failing test: 3 reviewers dispatched in parallel via `Promise.allSettled`. Stub all ports. Assert `agentDispatch.dispatch()` called 3 times with distinct `agentIdentity` values. Use `InMemoryAgentDispatchAdapter` with `givenResult()` for each reviewer taskId.
2. Write failing test: per-agent timeout. Use `givenDelayedResult()` with delay exceeding `timeoutMs`. Assert `abort()` called and reviewer retried.
3. Write failing test: retry exhausted. Stub dispatch to fail twice for one reviewer. Assert `ConductReviewError.reviewerRetryExhausted()`.
4. Write failing test: all 3 fail after retry. Assert `ConductReviewError.allReviewersFailed()`.
5. Write failing test: context resolution failure. Stub `sliceSpecPort.getSpec()` to return error. Assert `ConductReviewError.contextResolutionFailed()`.
6. Implement `ConductReviewUseCase` constructor + `execute()` method covering:
   - Context resolution (steps 1-2 of orchestration flow)
   - Agent identity generation (UUID per role)
   - `dispatchWithTimeout()` private method using `Promise.race`
   - Parallel dispatch via `Promise.allSettled`
   - Per-reviewer retry logic (max 1 retry)
   - Error mapping for all failure paths
7. Run: `npx vitest run src/hexagons/review/application/conduct-review --reporter=verbose 2>&1 | tail -15`
   **Expect:** PASS — dispatch, timeout, retry, error path tests all green.
8. Commit: `feat(S04/T08): ConductReviewUseCase — parallel dispatch + timeout + retry`

---

### T09: ConductReviewUseCase — fresh-reviewer + CTR + merge + persist

**Files:**
- Modify `src/hexagons/review/application/conduct-review.use-case.ts`
- Modify `src/hexagons/review/application/conduct-review.use-case.spec.ts`

**Traces to:** AC6, AC7, AC8, AC9, AC10, AC11, AC12, AC13, AC25

**Steps:**
1. Write failing test: `FreshReviewerService.enforce()` called for each of 3 reviewers before dispatch. Spy on enforce, assert 3 calls with correct `(sliceId, agentIdentity)` pairs.
2. Write failing test: fresh-reviewer violation → `ConductReviewError.freshReviewerBlocked()`. Stub enforce to return `FreshReviewerViolationError`.
3. Write failing test: CTR roles processed via `CritiqueReflectionService.processResult()`. Stub dispatch to return JSON output for code-reviewer/security-auditor. Assert `processResult()` called for those 2, NOT for spec-reviewer.
4. Write failing test: CTR parse failure → degraded (0 findings). Stub dispatch to return invalid JSON for code-reviewer. Assert review created with 0 findings (AC25).
5. Write failing test: 3 Review aggregates created + saved. Assert `reviewRepository.save()` called 3 times.
6. Write failing test: `MergedReview.merge()` invoked with 3 reviews. Assert merged verdict logic.
7. Implement: add fresh-reviewer enforcement before dispatch, CTR processing with JSON.parse + error handling, Review creation, merge, persistence.
8. Run: `npx vitest run src/hexagons/review/application/conduct-review --reporter=verbose 2>&1 | tail -15`
   **Expect:** PASS — all fresh-reviewer, CTR, merge, persist tests green.
9. Commit: `feat(S04/T09): ConductReviewUseCase — fresh-reviewer + CTR + merge + persist`

---

### T10: ConductReviewUseCase — fixer loop + event + error paths

**Files:**
- Modify `src/hexagons/review/application/conduct-review.use-case.ts`
- Modify `src/hexagons/review/application/conduct-review.use-case.spec.ts`

**Traces to:** AC14, AC15, AC16, AC17, AC23, AC26

**Steps:**
1. Write failing test: `fixerPort.fix()` invoked when `merged.hasBlockers()` is true. Stub dispatch to return critical findings. Assert fixer called.
2. Write failing test: fixer loop respects `maxFixCycles`. Stub fixer to always defer. Assert loop terminates after exactly 2 cycles (default). Assert `fixCyclesUsed = 2`.
3. Write failing test: after fix, all 3 reviewers re-dispatched (6 total dispatches for 1 fix cycle). Assert diff re-fetched (changedFilesPort called again).
4. Write failing test: fixer failure → loop stops, current result returned. Stub fixer to return error. Assert no `ConductReviewError` (graceful stop, AC26).
5. Write failing test: `ReviewPipelineCompletedEvent` emitted with all fields. Capture events via event bus spy.
6. Implement: fixer loop (re-fetch diff at step 2, re-dispatch at step 3), event emission, graceful fixer error handling.
7. Run: `npx vitest run src/hexagons/review/application/conduct-review --reporter=verbose 2>&1 | tail -15`
   **Expect:** PASS — all fixer loop, event, error path tests green.
8. Commit: `feat(S04/T10): ConductReviewUseCase — fixer loop + event emission + error paths`

---

## Wave 3 — Integration (depends on Wave 2)

### T11: Barrel exports + composition root + integration test

**Files:**
- Modify `src/hexagons/review/index.ts`
- Modify `src/cli/extension.ts`
- Create `src/hexagons/review/integration/conduct-review.integration.spec.ts`

**Traces to:** AC20, AC22

**Steps:**
1. Update `src/hexagons/review/index.ts` — add all new exports:
   - Application: `ConductReviewUseCase`
   - Domain schemas: `ConductReviewRequestSchema`, `ConductReviewResultSchema`, types
   - Domain ports: `SliceSpecPort`, `ChangedFilesPort`, `FixerPort`, `SliceSpec`, `FixRequest`, `FixResult`
   - Domain errors: `ConductReviewError`, `SliceSpecError`, `ChangedFilesError`, `FixerError`
   - Domain events: `ReviewPipelineCompletedEvent`
   - Infrastructure: `StubFixerAdapter`, `BeadSliceSpecAdapter`, `GitChangedFilesAdapter`
2. Wire in `src/cli/extension.ts` — instantiate all adapters and `ConductReviewUseCase` with proper dependencies.
3. Write integration test: full pipeline with `InMemoryAgentDispatchAdapter`, `InMemoryReviewRepository`, stub ports. Dispatch 3 reviewers → merge → verify merged verdict + persisted reviews + event emitted.
4. Run: `npx vitest run --reporter=verbose 2>&1 | tail -10`
   **Expect:** PASS — all tests green including integration.
5. Run: `npx tsc --noEmit 2>&1 | tail -5`
   **Expect:** No type errors (AC20).
6. Commit: `feat(S04/T11): barrel exports + composition root wiring + integration test`

---

## Task Dependency Graph

```
Wave 0:  T01  T02  T03  T04  T05   (all parallel)
          \    |    |    |    /
Wave 1:    T06 (T02,T03,T04)  T07 (parallel)
              \              /
Wave 2:       T08 → T09 → T10  (sequential)
                         |
Wave 3:                 T11
```

## Summary

| Wave | Tasks | Parallel? | Estimated |
|------|-------|-----------|-----------|
| 0 | T01, T02, T03, T04, T05 | Yes (5 parallel) | Foundation |
| 1 | T06, T07 | Yes (2 parallel) | Adapters |
| 2 | T08, T09, T10 | Sequential | Core use case |
| 3 | T11 | Single | Integration |

**Total:** 11 tasks, 4 waves, 26 acceptance criteria.
