# M05-S05: Review UI Port

## Problem

The review pipeline (S04) produces structured findings, the verify workflow produces binary verdicts, and the plan/discuss workflows produce `.md` artifacts -- but none have a presentation layer. Results are returned as data structures with no user-facing display.

R05 requires: `ReviewUIPort` abstract class with `presentFindings`, `presentForApproval`, and a terminal default + plannotator auto-detect.

**Extension**: This spec adds `presentVerification` (not in R05) to support the S08 verify workflow's need to display binary PASS/FAIL verdicts per criterion. R05 is extended, not contradicted.

## Scope

### In Scope
- `ReviewUIPort` abstract class in review hexagon -- 3 methods
- Zod schemas for context/response types per method
- `ReviewUIError` domain error with factory methods
- `TerminalReviewUIAdapter` -- markdown-formatted string output (no pi-tui)
- `PlannotatorReviewUIAdapter` -- CLI subprocess (`plannotator annotate`)
- `InMemoryReviewUIAdapter` -- test double with inspectable presentation log
- Composition root wiring -- binary detection, adapter injection
- Contract tests, unit tests, integration test (real plannotator, skipped in CI)

### Out of Scope
- pi-tui terminal overlays (M06)
- Plannotator `review` mode for git diffs (future enhancement)
- Interactive terminal input (responses determined by orchestrator, not adapter)
- Wiring into future workflows (S08 verify, S09 ship) -- those slices wire themselves

## Approach

**B: Rich Data Model** -- typed context objects per use case, markdown terminal output, plannotator CLI integration. Strong contracts, moderate scope.

## Architecture

### Port Location

`src/hexagons/review/domain/ports/review-ui.port.ts` -- review hexagon port, exported via barrel. Other hexagons (workflow, execution) import from the review hexagon's public API. Consistent with `ExecutorQueryPort` cross-hexagon pattern. Avoids leaking review-domain types (`FindingProps`, verdicts, conflicts) into kernel.

### Port Interface

```
ReviewUIPort (abstract class)
  presentFindings(ctx: FindingsUIContext) -> Result<FindingsUIResponse, ReviewUIError>
  presentVerification(ctx: VerificationUIContext) -> Result<VerificationUIResponse, ReviewUIError>
  presentForApproval(ctx: ApprovalUIContext) -> Result<ApprovalUIResponse, ReviewUIError>
```

All methods: async, Result-based, single error type.

### Context Schemas (`review-ui.schemas.ts`)

Located in `src/hexagons/review/domain/review-ui.schemas.ts`.

**FindingsUIContext**: `{ sliceId, sliceLabel, verdict, findings[], conflicts[], fixCyclesUsed, timedOutReviewers[] }`
- `findings[]`: reuses `FindingProps` from review domain (no projection -- full schema)
- `conflicts[]`: reuses `ConflictProps` from `MergedReview`

**FindingsUIResponse**: `{ acknowledged: boolean, formattedOutput: string }`

**VerificationUIContext**: `{ sliceId, sliceLabel, criteria[{ criterion, verdict: PASS|FAIL, evidence }], overallVerdict }`

**VerificationUIResponse**: `{ accepted: boolean, formattedOutput: string }`

**ApprovalUIContext**: `{ sliceId, sliceLabel, artifactType: plan|spec|verification, artifactPath, summary }`

**ApprovalUIResponse**: `{ decision?: approved|rejected|changes_requested, feedback?: string, formattedOutput: string }`

Notes:
- `decision` on `ApprovalUIResponse` is **optional**:
  - Plannotator adapter: opens browser UI, captures user decision, returns it in `decision`
  - Terminal adapter: returns formatted markdown only, `decision` absent (formatter, not gate)
  - Tool layer checks: if `decision` present -> use it. If absent -> protocol handles user approval via AskUserQuestion (existing flow)
- `formattedOutput` on all responses carries the markdown-formatted display string (terminal adapter generates it, plannotator adapter includes annotation summary of user's feedback)
- `changes_requested` aligns with `ReviewVerdictSchema` vocabulary (not `revision_requested`)
- `findings[]` reuses full `FindingProps` -- no projection, no mapping ambiguity

### Context Construction

The **tool layer** (PI tool `execute()` method) constructs UI context objects from use case results and calls the port:
- `tff_write_spec` tool: calls `WriteSpecUseCase.execute()`, then `reviewUI.presentForApproval()` with the returned path
- `tff_write_plan` tool: same pattern -- write, then present for approval
- Future `tff_conduct_review` tool (S09): calls `ConductReviewUseCase.execute()`, maps result to `FindingsUIContext`, calls `reviewUI.presentFindings()`
- Future verify tool (S08): calls verification logic, maps to `VerificationUIContext`, calls `reviewUI.presentVerification()`

Write*UseCase stays pure domain logic. The tool is the orchestrator. Mapping logic lives in the tool, not in the port or adapters.

### Adapters

#### TerminalReviewUIAdapter
- Location: `src/hexagons/review/infrastructure/terminal-review-ui.adapter.ts`
- Pure formatter -- returns markdown strings in `formattedOutput`, no I/O side effects
- Findings: severity-sorted table with unicode indicators (critical first)
- Verification: PASS/FAIL table with evidence per criterion
- Approval: artifact path + summary + decision prompt text
- Conflict section highlighted separately

#### PlannotatorReviewUIAdapter
- Location: `src/hexagons/review/infrastructure/plannotator-review-ui.adapter.ts`
- Dependency: `plannotator` CLI binary on PATH
- `presentFindings`: write findings as markdown -> `plannotator annotate <temp.md>` -> parse stdout
- `presentVerification`: write verification report as markdown -> `plannotator annotate <temp.md>` -> parse stdout
- `presentForApproval`: `plannotator annotate <artifactPath>` -> parse stdout -> map to ApprovalUIResponse
- Every `.md` artifact triggers plannotator for interactive review
- Temp files written for findings/verification cleaned up after plannotator exits (try/finally)
- No timeout -- user controls when they close plannotator UI
- **Parse failure degradation**:
  - `presentFindings` -> `{ acknowledged: true }` (user saw content even if annotations lost)
  - `presentVerification` -> `{ accepted: true }` (user saw results)
  - `presentForApproval` -> `{ decision: "changes_requested", feedback: "Plannotator parse error -- please review manually" }` (fail-safe: never auto-approve)

#### InMemoryReviewUIAdapter
- Location: `src/hexagons/review/infrastructure/in-memory-review-ui.adapter.ts`
- Stores presentations in inspectable array
- Constructor: configurable default responses or per-call response queue
- Used by: all use case tests, integration tests

### Detection & Wiring (Composition Root)

```
compositionRoot (src/cli/extension.ts):
  plannotatorPath = detectPlannotator()
    // execFileSync('which', ['plannotator']) wrapped in try/catch
    // returns absolute path or undefined
    // runs once at startup, result cached
  terminalAdapter = new TerminalReviewUIAdapter()
  reviewUI = plannotatorPath
    ? new PlannotatorReviewUIAdapter(plannotatorPath)
    : terminalAdapter
  inject reviewUI -> tool factories (createWriteSpecTool, createWritePlanTool, etc.)
```

Detection: `child_process.execFileSync('which', ['plannotator'])` wrapped in try/catch. Returns `undefined` on failure (not installed, Windows compat handled separately if needed). Runs once at startup.

### Consumer Integration

Tool-layer orchestrator pattern -- Write*UseCase stays pure. PI tools call `reviewUI.presentForApproval()` after use case succeeds.

| Consumer | Method | Trigger | Wired in this slice? |
|---|---|---|---|
| `tff_write_spec` tool | presentForApproval | After WriteSpecUseCase succeeds | Yes |
| `tff_write_plan` tool | presentForApproval | After WritePlanUseCase succeeds | Yes |
| Future `tff_conduct_review` tool (S09) | presentFindings | After ConductReviewUseCase succeeds | No (future) |
| Future verify tool (S08) | presentVerification | After criteria validated | No (future) |
| Future verify tool (S08) | presentForApproval | After VERIFICATION.md written | No (future) |

Note: `ReviewUIPort` is injected into tool factories at composition root. The tools modify their `execute()` to call the port after the use case returns. Use cases are NOT modified -- they stay pure domain logic.

## Error Handling

```
ReviewUIError (extends BaseDomainError)
  private constructor + static factory methods (follows ConductReviewError pattern)
  presentationFailed(context, cause)   -> adapter crashed or subprocess error
  plannotatorNotFound()                -> binary not on PATH (composition root)
  feedbackParseError(raw)              -> stdout parse failure
```

All errors: Result-based, never thrown. No timeout -- plannotator is user-interactive.

Parse failure behavior per method (see Adapters section):
- findings/verification: degrade to acknowledged/accepted (user saw content)
- approval: degrade to `changes_requested` (never auto-approve)

## Acceptance Criteria

- **AC1**: `ReviewUIPort` abstract class in `src/hexagons/review/domain/ports/` with 3 typed async methods returning `Result<*Response, ReviewUIError>`
- **AC2**: Terminal adapter formats findings as severity-sorted markdown with conflicts in a dedicated section
- **AC3**: Terminal adapter returns `Ok` results without plannotator installed
- **AC4**: Plannotator adapter invokes `plannotator annotate` via CLI subprocess for all 3 methods
- **AC5**: Plannotator detected at composition root via PATH check; composition root selects plannotator adapter when found, terminal adapter otherwise
- **AC6**: Composition root provides injectable `ReviewUIPort` instance usable by orchestrators
- **AC7**: `InMemoryReviewUIAdapter` records each presentation call in an inspectable log with context and response
- **AC8**: All 3 adapters return `Ok<*UIResponse>` for valid input contexts (verified via shared parameterized test suite)
- **AC9**: Plannotator adapter produces valid `FindingsUIResponse` against real plannotator binary (test skipped in CI via env flag)
- **AC10**: All 6 Zod schemas (FindingsUIContext, FindingsUIResponse, VerificationUIContext, VerificationUIResponse, ApprovalUIContext, ApprovalUIResponse) accept valid input and reject malformed input
- **AC11**: Parse failure on `presentForApproval` degrades to `{ decision: "changes_requested" }` (never auto-approves)
- **AC12**: Parse failure on `presentFindings` degrades to `{ acknowledged: true }`
- **AC13**: Parse failure on `presentVerification` degrades to `{ accepted: true }`
- **AC14**: `ReviewUIError` extends `BaseDomainError` with factory methods: `presentationFailed`, `plannotatorNotFound`, `feedbackParseError`
- **AC15**: All 3 adapter methods return responses with non-empty `formattedOutput` string
- **AC16**: Terminal adapter's `presentVerification` formats criteria as PASS/FAIL table with evidence per criterion
- **AC17**: `ReviewUIPort` and all 6 context/response schemas exported from `src/hexagons/review/index.ts`

## Non-Goals

- Real-time streaming of findings (batch presentation only)
- Custom themes or styling for terminal output
- Plannotator `review` mode (git diff based) -- future enhancement
- pi-tui overlays (M06 scope)
