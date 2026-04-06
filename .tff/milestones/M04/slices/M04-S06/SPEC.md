# M04-S06: Agent Status Protocol

## Goal

Replace the flat `success: boolean` in `AgentResult` with a structured status protocol. Agents report one of four explicit statuses, fill a self-review checklist, and surface concerns. A programmatic cross-checker validates agent claims against observable facts.

## Requirement Coverage

- **R09**: Structured status (DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED), self-review checklist, "never silently produce work you're unsure about"

## Design Divergence Note

The design spec defines `AgentResult` with `agentIdentity: z.string()`. The implementation (since S03) uses `agentType: AgentTypeSchema` instead. This slice continues using the implemented schema. See S05 SPEC.md for prior documentation of this divergence.

## Architecture Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Ownership | Kernel-level (`kernel/agents/`) | AgentResult lives in kernel; status is consumed by every hexagon that dispatches agents |
| Self-review mechanism | Both: prompt injection + programmatic cross-checker | Prompt gets the agent's self-assessment; cross-checker validates claims against facts |
| Status derivation | Agent sets status explicitly | No automatic derivation from checklist — simpler parsing, agent owns its assessment |
| Orchestrator reaction | Out of scope | Schema + parsing only; retry/escalation deferred to S07 (wave engine) |
| AgentType expansion | Deferred to S07 | Keep S06 focused on status protocol |
| TaskMetrics.success | Stays `z.boolean()` | Persisted JSONL metric; mapping layer uses `isSuccessfulStatus()` to derive the boolean |

## Schema Design

### AgentStatus

```
AgentStatusSchema = z.enum(["DONE", "DONE_WITH_CONCERNS", "NEEDS_CONTEXT", "BLOCKED"])
```

- `DONE` — task completed successfully, no concerns
- `DONE_WITH_CONCERNS` — task completed but agent flagged issues
- `NEEDS_CONTEXT` — agent cannot proceed without additional information
- `BLOCKED` — agent hit an unrecoverable obstacle

### AgentConcern

```
AgentConcernSchema = z.object({
  area: z.string(),
  description: z.string(),
  severity: z.enum(["info", "warning", "critical"]),
})
```

### SelfReviewChecklist

```
SelfReviewDimensionSchema = z.object({
  dimension: z.enum(["completeness", "quality", "discipline", "verification"]),
  passed: z.boolean(),
  note: z.string().optional(),
})

SelfReviewChecklistSchema = z.object({
  dimensions: z.array(SelfReviewDimensionSchema).length(4),
  overallConfidence: z.enum(["high", "medium", "low"]),
})
```

Four dimensions:
- **Completeness** — did the agent address all acceptance criteria?
- **Quality** — does the output meet quality standards?
- **Discipline** — did the agent follow prescribed methodology (TDD, commit conventions, etc.)?
- **Verification** — did the agent verify its own work?

The `.length(4)` constraint is intentional — the four dimensions are a fixed protocol, not an extensible list. Changes require a protocol version bump.

### AgentStatusReport (parsed from agent output)

```
AgentStatusReportSchema = z.object({
  status: AgentStatusSchema,
  concerns: z.array(AgentConcernSchema).default([]),
  selfReview: SelfReviewChecklistSchema,
})
```

This is the subset of data the agent itself produces. Distinct from the full `AgentResult` which includes transport data (cost, duration, filesChanged) that the adapter fills in.

### Evolved AgentResult

Remove `success: boolean`. Add:
- `status: AgentStatusSchema`
- `concerns: z.array(AgentConcernSchema).default([])`
- `selfReview: SelfReviewChecklistSchema`

Keep `error: z.string().optional()` for BLOCKED/NEEDS_CONTEXT explanations.

### Helper Function

```
isSuccessfulStatus(status: AgentStatus): boolean
  → status === "DONE" || status === "DONE_WITH_CONCERNS"
```

Standalone function in `kernel/agents/agent-status.schema.ts`.

## Output Parsing Protocol

### Agent Output Contract

Agents emit a structured JSON block at the end of their output, fenced with HTML comment markers:

```
<!-- TFF_STATUS_REPORT -->
{ "status": "...", "concerns": [...], "selfReview": {...} }
<!-- /TFF_STATUS_REPORT -->
```

### Parser

**File:** `kernel/agents/agent-status-parser.ts`

```
parseAgentStatusReport(rawOutput: string): Result<AgentStatusReport, AgentStatusParseError>
```

- Extract JSON between `<!-- TFF_STATUS_REPORT -->` and `<!-- /TFF_STATUS_REPORT -->` markers
- Validate extracted JSON with `AgentStatusReportSchema.safeParse()`
- On parse failure: return `AgentStatusParseError` with raw output preserved

### AgentStatusParseError

**File:** `kernel/agents/agent-status-parse.error.ts`

```
export class AgentStatusParseError extends BaseDomainError {
  readonly code = "AGENT_STATUS.PARSE_FAILED";
  constructor(
    message: string,
    public readonly rawOutput: string,
    public readonly cause?: unknown,
  ) { super(message); }
}
```

Extends `BaseDomainError`. Error code follows project convention (`DOMAIN.SPECIFIC`).

### Prompt Fragment

**File:** `kernel/agents/agent-status-prompt.ts`

Exports a constant `AGENT_STATUS_PROMPT: string` that:
1. Explains the 4 statuses and when to use each
2. Provides the self-review checklist with the 4 dimensions
3. Shows the exact JSON format expected between markers
4. Instructs: "Never report DONE if you have unresolved concerns"

Injected by the PI adapter into every dispatch's `systemPrompt`.

## Programmatic Cross-Checker

**File:** `kernel/agents/agent-status-cross-checker.ts`

```
crossCheckAgentResult(
  report: AgentStatusReport,
  result: Omit<AgentResult, "status" | "concerns" | "selfReview">,
  agentType: AgentType,
): CrossCheckResult

CrossCheckResult = {
  valid: boolean,
  discrepancies: AgentConcern[],
}
```

Named `crossCheckAgentResult` (not `validate...`) because it cross-checks agent claims against transport data, not validates the schema.

Four cross-checks (does not mutate status):

1. **Files claim** — if self-review `completeness` passed but `filesChanged` is empty and `agentType` is `fixer`, flag discrepancy. Other agent types (reviewers, etc.) are expected to produce no file changes.
2. **Error consistency** — if status is `DONE` but `error` field is populated, flag
3. **Concern consistency** — if status is `DONE` (not `DONE_WITH_CONCERNS`) but `concerns` array is non-empty, flag
4. **Cost sanity** — if `durationMs` is 0 or `costUsd` is 0 with non-zero tokens, flag (possible data issue)

Returns discrepancies for the orchestrator to decide on. Discrepancies reuse the `AgentConcern` schema with severity `warning`.

## Integration

### PI Adapter Changes

`pi-agent-dispatch.adapter.ts`:
1. Inject `AGENT_STATUS_PROMPT` into `systemPrompt`
2. After session completes successfully, call `parseAgentStatusReport(output)` to extract structured status
3. If parse succeeds: build `AgentResult` with parsed status + transport data (cost, duration, filesChanged)
4. If parse fails: build `AgentResult` with status `BLOCKED`, preserve raw output in `error`, add a parse-failure concern (area: "status-protocol", severity: "critical")
5. Call `crossCheckAgentResult()` and append any discrepancies to the concerns array
6. If dispatch itself fails (session creation error, timeout, abort): build `AgentResult` with status `BLOCKED` and the dispatch error in `error` — no parsing or cross-checking attempted

### In-Memory Adapter Changes

`in-memory-agent-dispatch.adapter.ts`:
- Pre-configured results now include `status`, `concerns`, `selfReview` instead of `success`
- Default test result: `DONE` with all-passed checklist, high confidence, empty concerns
- `givenResult()` and `givenDelayedResult()` accept status-aware result objects

### Downstream Consumer Migration

| Consumer | Change |
|---|---|
| `RecordTaskMetricsUseCase` | Map `isSuccessfulStatus(event.agentResult.status)` → `TaskMetrics.success: boolean` |
| `AggregateMetricsUseCase` | No change needed — reads `TaskMetrics.success` which remains boolean |
| `agent-dispatch.contract.spec.ts` | Assert `result.data.status` instead of `result.data.success` |
| `task-execution-completed.event.spec.ts` | Assert `event.agentResult.status` instead of `.success` |

`TaskMetrics.success` stays `z.boolean()` — it is a persisted JSONL metric. The mapping from status → boolean happens in `RecordTaskMetricsUseCase` at write time.

`JournalEventHandler` is NOT a consumer — it subscribes to task-level events (`TaskCompletedEvent`, `TaskBlockedEvent`) from the task hexagon, not `AgentResult`.

### Builder Migration

`kernel/agents/agent-result.builder.ts`:
- Remove `withSuccess(success: boolean)` and `withFailure(error: string)`
- Add `.withStatus(status)`, `.withConcerns(concerns)`, `.withSelfReview(checklist)`
- Add convenience methods: `.asDone()`, `.asDoneWithConcerns(concerns)`, `.asBlocked(error)`, `.asNeedsContext(error)`
- Default build: `DONE` status, all-passed checklist with high confidence, empty concerns

### Barrel Export Updates

`kernel/agents/index.ts` adds:
- `AgentStatusSchema`, `AgentStatus`, `AgentConcernSchema`, `AgentConcern`
- `SelfReviewDimensionSchema`, `SelfReviewChecklistSchema`, `SelfReviewChecklist`
- `AgentStatusReportSchema`, `AgentStatusReport`
- `isSuccessfulStatus`
- `parseAgentStatusReport`
- `AGENT_STATUS_PROMPT`
- `crossCheckAgentResult`, `CrossCheckResult`
- `AgentStatusParseError`

## File Inventory

### New Files

| File | Purpose |
|---|---|
| `kernel/agents/agent-status.schema.ts` | AgentStatusSchema, AgentConcernSchema, SelfReviewChecklistSchema, AgentStatusReportSchema, isSuccessfulStatus() |
| `kernel/agents/agent-status-parser.ts` | parseAgentStatusReport() — extract + validate from raw output |
| `kernel/agents/agent-status-prompt.ts` | AGENT_STATUS_PROMPT constant — system prompt fragment |
| `kernel/agents/agent-status-cross-checker.ts` | crossCheckAgentResult() — cross-check claims vs facts |
| `kernel/agents/agent-status-parse.error.ts` | AgentStatusParseError class extending BaseDomainError |
| `kernel/agents/agent-status.schema.spec.ts` | Schema validation tests |
| `kernel/agents/agent-status-parser.spec.ts` | Parser tests (happy path, missing markers, malformed JSON) |
| `kernel/agents/agent-status-cross-checker.spec.ts` | Cross-checker tests for all 4 checks |

### Modified Files

| File | Change |
|---|---|
| `kernel/agents/agent-result.schema.ts` | Remove `success`, add `status` + `concerns` + `selfReview` |
| `kernel/agents/agent-result.schema.spec.ts` | Update for new fields |
| `kernel/agents/agent-result.builder.ts` | Replace `withSuccess`/`withFailure` with status-aware methods |
| `kernel/agents/agent-result.builder.spec.ts` | Update for new builder API |
| `kernel/agents/index.ts` | Export new schemas, parser, cross-checker, prompt, error |
| `execution/infrastructure/pi-agent-dispatch.adapter.ts` | Inject prompt, parse output, cross-check, handle failures |
| `execution/infrastructure/in-memory-agent-dispatch.adapter.ts` | Status-aware test results |
| `execution/infrastructure/agent-dispatch.contract.spec.ts` | Assert structured status |
| `execution/application/record-task-metrics.use-case.ts` | `isSuccessfulStatus()` mapping |
| `execution/application/record-task-metrics.use-case.spec.ts` | Updated assertions |
| `execution/domain/events/task-execution-completed.event.spec.ts` | Assert status field |

## Acceptance Criteria

- **AC1**: `AgentResult` replaces `success: boolean` with a `status` field typed as `AgentStatusSchema` (`DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`)
- **AC2**: `DONE_WITH_CONCERNS` results include a non-empty concerns array; `DONE` results have an empty concerns array. Each concern has area (string), description (string), and severity (info / warning / critical)
- **AC3**: Self-review checklist with 4 dimensions (completeness, quality, discipline, verification) and an overallConfidence level (high / medium / low) is present on every AgentResult
- **AC4**: Parser extracts status report JSON from agent output between `<!-- TFF_STATUS_REPORT -->` markers and validates with `AgentStatusReportSchema`
- **AC5**: Parse failure produces `AgentStatusParseError` (code: `AGENT_STATUS.PARSE_FAILED`) with raw output preserved
- **AC6**: Programmatic cross-checker detects all four discrepancy types: (1) completeness-passed but no filesChanged for fixer agents, (2) DONE status with populated error field, (3) DONE status with non-empty concerns, (4) zero duration or zero cost with non-zero tokens
- **AC7**: `isSuccessfulStatus()` returns true for DONE and DONE_WITH_CONCERNS, false for NEEDS_CONTEXT and BLOCKED
- **AC8**: `RecordTaskMetricsUseCase` maps `isSuccessfulStatus(agentResult.status)` → `TaskMetrics.success` (boolean stays, mapping changes)
- **AC9**: `AGENT_STATUS_PROMPT` constant exists and contains: status definitions, self-review checklist instructions, JSON output format with markers, "never report DONE with concerns" rule
- **AC10**: PI adapter injects status prompt, parses output on success, falls back to BLOCKED on parse failure or dispatch failure, and appends cross-checker discrepancies as concerns
