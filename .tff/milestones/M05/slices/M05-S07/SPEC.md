# M05-S07: Fixer Behavior

## Problem

`StubFixerAdapter` defers all review findings (no-op). When `ConductReviewUseCase` detects blockers (critical/high severity), the fixer loop runs but makes no changes -- reviewers re-review identical code. R07 requires: per-finding triage (UNDERSTAND -> VERIFY -> EVALUATE -> IMPLEMENT), evidence-based push-back on incorrect findings, and test verification after each fix cycle.

## Scope

### In Scope
- `PiFixerAdapter` -- infrastructure adapter implementing `FixerPort`, dispatches fixer agent via `AgentDispatchPort`
- Fixer prompt template (`src/resources/prompts/fixer.md`) -- instructs agent on finding triage protocol
- `FixResult` schema extension -- add `justifications` map (findingId -> reason string) for push-back tracking
- `FixerOutputParser` -- application service parsing structured JSON from agent output into `FixResult`
- `extension.ts` wiring -- replace `StubFixerAdapter` with `PiFixerAdapter`
- Unit tests for adapter, parser, schema changes
- Integration test with `InMemoryAgentDispatchAdapter`

### Out of Scope
- Changes to `ConductReviewUseCase` logic (fixer loop already works correctly)
- Changes to `FixerPort` abstract class signature (only `FixResult` type extended)
- New `TestRunnerPort` (fixer agent runs tests via Bash tool directly)
- Fixer agent card changes (already done in S06)
- CLI command for manual fixer invocation
- Per-finding dispatch (single-dispatch batch chosen for token efficiency)

## Approach

**Single-dispatch batch**: one fixer agent dispatch per fix cycle. The agent receives ALL findings in a single prompt with priority ordering (critical first). The agent decides which to fix, which to push back on, and which to defer. Structured JSON output parsed by adapter. Most token-efficient -- one agent session handles all findings.

Rationale: per-finding dispatch would incur N x base token cost. Two-phase (triage then fix) adds latency. Batch dispatch lets the agent see the full picture and make informed triage decisions.

## Architecture

### PiFixerAdapter

Infrastructure adapter in `@hexagons/review/infrastructure/`. Implements `FixerPort`.

```
class PiFixerAdapter extends FixerPort:
  constructor(
    agentDispatch: AgentDispatchPort,
    promptLoader: (path: string) => string,
    modelResolver: (profile: ModelProfileName) => ResolvedModel,
    logger: LoggerPort,
  )

  async fix(request: FixRequest): Promise<Result<FixResult, FixerError>>
```

Flow:
1. Load fixer agent card via `getAgentCard("fixer")`
2. Load prompt template via `promptLoader("prompts/fixer.md")`
3. Build task prompt: template + serialized findings as JSON (priority-ordered: critical -> high -> medium -> low -> info)
4. Resolve model from `card.defaultModelProfile` via `modelResolver`
5. Dispatch agent via `agentDispatch.dispatch(config)` with `AgentDispatchConfig`:
   - `taskId: randomUUID()`
   - `sliceId: request.sliceId`
   - `agentType: "fixer"`
   - `tools: card.requiredTools`
   - `workingDirectory: request.workingDirectory`
   - `systemPrompt: card.identity` (identity only; `PiAgentDispatchAdapter` appends `AGENT_STATUS_PROMPT` + `GUARDRAIL_PROMPT` automatically)
   - `taskPrompt`: rendered template with findings JSON
   - `model`: resolved from `card.defaultModelProfile`
   - `filePaths: []`
6. Parse agent output via `FixerOutputParser.parse(output, request.findings)`
7. Return `Ok(fixResult)` or `Err(FixerError)` on dispatch/parse failure

### FixerOutputParser

Application service in `@hexagons/review/application/`. Pure function, no I/O.

```
parse(agentOutput: string, originalFindings: FindingProps[]):
  Result<FixResult, FixerError>
```

Flow:
1. Extract JSON block from agent output (look for ```json ... ``` fenced block or bare JSON object)
2. Parse JSON and validate against `FixerOutputSchema`
3. Map `findingId` references back to original `FindingProps` from request
4. Findings not mentioned in output = deferred (no justification)
5. Unknown findingIds silently ignored
6. Return `Ok(FixResult)` or `Err(FixerError)` on extraction/parse failure

### FixerOutputSchema

Defined in `fixer-output-parser.ts` (application layer, not domain -- this is agent output format, not a domain contract).

What the fixer agent produces (JSON block in output):

```
FixerOutputSchema = z.object({
  fixed: z.array(z.string()),                    // findingIds
  deferred: z.array(z.string()),                  // findingIds
  justifications: z.record(z.string(), z.string()).default({}),
  testsPassing: z.boolean(),
})
```

### FixResult Extension

Modify `FixResultSchema` in `fixer.port.ts`:

```
FixResultSchema = z.object({
  fixed: z.array(FindingPropsSchema),
  deferred: z.array(FindingPropsSchema),
  justifications: z.record(z.string(), z.string()).default({}),
  testsPassing: z.boolean(),
})
```

Backward compat: `StubFixerAdapter` returns `justifications: {}` (via Zod default). No code change needed in stub.

### Fixer Prompt Template

Location: `src/resources/prompts/fixer.md`

Template receives: `{{findings_json}}` -- serialized array of findings.

Content instructs the agent to:
1. For each finding, follow the R07 protocol:
   - UNDERSTAND: read the finding and referenced code
   - VERIFY: confirm the reviewer's claim is technically correct
   - EVALUATE: decide if implementing the fix improves the code
2. Severity-based priority:
   - Critical/high: MUST fix or push back with evidence
   - Medium/low: MAY defer with justification
3. For accepted fixes: implement the change
4. After all changes: run `npx vitest run` and report pass/fail
5. Output a JSON block with: `fixed` (IDs), `deferred` (IDs), `justifications` (ID -> reason), `testsPassing` (boolean)

### Composition Root Wiring

In `extension.ts`, replace:
```
const stubFixer = new StubFixerAdapter();
```
With:
```
const piFixerAdapter = new PiFixerAdapter(
  new PiAgentDispatchAdapter(),
  templateLoader,    // existing lambda
  modelResolver,     // existing lambda
  logger,
);
```

`StubFixerAdapter` retained for test use -- not deleted.

## Directory Structure

```
src/hexagons/review/
  application/
    fixer-output-parser.ts          -- NEW
    fixer-output-parser.spec.ts     -- NEW
  domain/ports/
    fixer.port.ts                   -- MODIFIED (FixResult schema only)
    fixer.port.spec.ts              -- NEW (schema tests)
  infrastructure/
    pi-fixer.adapter.ts             -- NEW
    pi-fixer.adapter.spec.ts        -- NEW
    stub-fixer.adapter.ts           -- UNCHANGED (backward compat verified)
src/resources/prompts/
  fixer.md                          -- NEW
src/cli/
  extension.ts                      -- MODIFIED (wire PiFixerAdapter)
```

## Error Handling

| Error Case | Handling |
|---|---|
| Agent dispatch fails | Return `Err(FixerError)` with dispatch error message |
| Agent times out | Return `Err(FixerError)` -- ConductReviewUseCase breaks loop gracefully |
| Agent output missing JSON block | Return `Err(FixerError)` with context |
| Agent output has invalid JSON | Return `Err(FixerError)` with raw output snippet (first 200 chars) |
| Finding ID in output doesn't match input | Silently ignored; unmentioned findings = deferred |
| Tests fail (`testsPassing: false`) | Return `Ok(FixResult)` with `testsPassing: false` -- caller decides |

## Testing Strategy

| Layer | Target | Method |
|---|---|---|
| Unit | `FixResultSchema` extension | Zod parse with/without justifications, default `{}` |
| Unit | `FixerOutputParser` | Valid JSON block extraction, malformed input, missing block, ID mapping |
| Unit | `PiFixerAdapter` | With `InMemoryAgentDispatchAdapter`: happy path, dispatch failure, parse failure |
| Integration | Full pipeline | Seeded agent result -> adapter -> parser -> correct FixResult |
| Regression | `ConductReviewUseCase` | 24 existing tests pass unchanged |
| Regression | `StubFixerAdapter` | Still compiles, returns default `justifications: {}` |

## Acceptance Criteria

- **AC1**: `FixResultSchema` includes `justifications: z.record(z.string(), z.string()).default({})`; existing `fixed`/`deferred`/`testsPassing` fields unchanged; `StubFixerAdapter` compiles without providing justifications (Zod default `{}`)
- **AC2**: `PiFixerAdapter.fix()` dispatches fixer agent via `AgentDispatchPort` with agent card from `getAgentCard("fixer")`, resolved model, and all required tools
- **AC3**: `PiFixerAdapter.fix()` builds task prompt containing all findings as priority-ordered JSON (critical -> high -> medium -> low -> info)
- **AC4**: `PiFixerAdapter.fix()` returns `Err(FixerError)` when agent dispatch fails or output parse fails
- **AC5a**: `FixerOutputParser.parse()` extracts structured JSON block from agent output matching `FixerOutputSchema`; maps `findingId` references back to original `FindingProps`
- **AC5b**: `FixerOutputParser.parse()` silently ignores unknown `findingId` values not present in the input findings array
- **AC5c**: `FixerOutputParser.parse()` auto-defers findings not mentioned in the output's `fixed` or `deferred` arrays (no justification for auto-deferred)
- **AC6**: `FixerOutputParser.parse()` returns `Err(FixerError)` for malformed/missing JSON block in agent output
- **AC7**: Fixer prompt template at `src/resources/prompts/fixer.md` exists and contains required sections: (a) a `{{findings_json}}` placeholder, (b) severity-priority instruction text containing "critical" and "high", (c) a test-run instruction containing "vitest", (d) a structured-output instruction containing "JSON" -- verified by structural test reading the file
- **AC8**: `PiFixerAdapter` integration test with `InMemoryAgentDispatchAdapter`: seeds agent result with valid fixer output -> adapter returns correct `FixResult` with fixed/deferred/justifications. Tests use the global agent registry (S06 is merged; `test-setup.ts` initializes it)
- **AC9**: `extension.ts` wires `PiFixerAdapter` instead of `StubFixerAdapter`; `StubFixerAdapter` kept for test-only use
- **AC10**: `ConductReviewUseCase` existing tests (24) pass without modification

## Dependencies

- M05-S04 (Review pipeline) -- `ConductReviewUseCase`, `FixerPort`, `FixResult`, `MergedReview`
- M05-S06 (Agent authoring) -- `getAgentCard("fixer")`, `AgentCard.requiredTools`
- `@kernel/agents` -- `AgentDispatchPort`, `AgentDispatchConfig`, `AgentResult`

## Non-Goals

- Changing `ConductReviewUseCase` fixer loop logic
- Per-finding agent dispatch (batch approach chosen)
- TestRunnerPort abstraction
- CLI-exposed fixer command
- Fixer agent card modifications
- Prompt quality tuning (prompt content is a starting point; refined through usage)
- Surfacing justifications in review UI or logs (data captured, display deferred)
