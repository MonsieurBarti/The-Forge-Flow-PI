# M04-S09: Async Overseer / Watchdog — Verification

## Overall Verdict: PASS

All 6 acceptance criteria verified against implementation. 1120/1120 tests passing.

## Acceptance Criteria

### AC1: Stuck agents killed after configurable timeout (per tier) — PASS

**Evidence:**
- `TimeoutStrategy` reads per-tier timeouts from `OverseerConfig.timeouts[complexityTier]` (timeout-strategy.ts:12)
- Defaults: S=5min, F-lite=15min, F-full=30min (overseer.schemas.ts:20-26)
- `ComposableOverseerAdapter.monitor()` races strategies via `Promise.race` (composable-overseer.adapter.ts:17)
- `executeTaskWithOverseer` races dispatch vs monitor; aborts agent on intervention (execute-slice.use-case.ts:89-114)

**Tests:** timeout-strategy.spec.ts (4 tests), composable-overseer.adapter.spec.ts (3 tests), execute-slice.use-case.spec.ts (overseer integration: 3 tests)

### AC2: Infinite retry loops detected via error signature matching — PASS

**Evidence:**
- `DefaultRetryPolicy.shouldRetry` checks last N signatures for identical errors (default-retry-policy.ts:19-29)
- When N identical errors detected, returns `{ retry: false }` immediately — does NOT burn remaining retries
- Test proves: 3 identical signatures at attempt=1 with maxRetries=5 → early termination (default-retry-policy.spec.ts:18-28)

**Tests:** default-retry-policy.spec.ts (6 tests covering: under-max allow, at-max reject, identical loop detection, mixed signatures allow, reset, per-task isolation)

### AC3: Structured journal entry (`overseer-intervention`) per intervention — PASS

**Evidence:**
- `OverseerInterventionEntrySchema` extends `JournalEntryBaseSchema` with: taskId, strategy, reason, action (aborted|retrying|escalated), retryCount (journal-entry.schemas.ts:84-92)
- Added to `JournalEntrySchema` discriminated union (journal-entry.schemas.ts:106)
- `JournalEntryBuilder.buildOverseerIntervention()` method exists (journal-entry.builder.ts:160-181)
- Use case writes journal entries for all three actions: aborted (line 118), escalated (line 139), retrying (line 154)

**Tests:** journal-entry.schemas.spec.ts (3 tests: valid entry, all action variants, discriminated union routing)

### AC4: Configurable retries w/ error context injection before escalation — PASS

**Evidence:**
- Retry loop: `for (let attempt = 0; attempt <= maxRetries; attempt++)` (execute-slice.use-case.ts:88)
- maxRetries derived from config: `Math.min(2, this.deps.overseerConfig.retryLoop.threshold)` (line 83-85)
- Prompt enriched on retry: `[OVERSEER] Previous attempt failed: ${reason}` (line 166-170)
- Worktree cleaned before retry: `gitPort.restoreWorktree(input.workingDirectory)` (line 172)
- Escalation when retries exhausted or loop detected (line 138-150)

**Tests:** default-retry-policy.spec.ts (retry semantics), execute-slice.use-case.spec.ts (integration)

### AC5: Overseer opt-out via `overseer.enabled: false` — PASS

**Evidence:**
- `OverseerConfigSchema.enabled` defaults to `true` (overseer.schemas.ts:19)
- `SettingsSchema` includes `overseer` with defaults and `.catch()` resilience (project-settings.schemas.ts:213)
- `executeTaskWithOverseer` bypasses monitoring when disabled: `if (!this.deps.overseerConfig.enabled) return dispatch(config)` (execute-slice.use-case.ts:79-81)

**Tests:** project-settings.schemas.spec.ts (3 tests: defaults, custom, fallback), execute-slice.use-case.spec.ts "does not monitor when overseer disabled" (asserts 0 monitor calls)

### AC6: Stale-claim detection not regressed — PASS

**Evidence:**
- Stale-claim logic unchanged at execute-slice.use-case.ts:277-285 (same check: status=in_progress AND age > 30min)
- Stale tasks skipped BEFORE dispatch — overseer never invoked for stale tasks
- Threshold unchanged: `STALE_CLAIM_THRESHOLD_MS = 30 * 60 * 1000` (line 50)

**Tests:** execute-slice.use-case.spec.ts "detects stale claims" (existing test) + "stale-claim detection still works with overseer enabled" (new test asserting overseerAdapter.monitorCalls.length === 0)

## Observations — RESOLVED

Initial verification identified 2 gaps. Both addressed:

1. **E2E intervention lifecycle test** — Added: "full intervention lifecycle: timeout → abort → journal → retry → success (AC1,AC3,AC4)". Verifies 2 dispatch calls, aborted + retrying journal entries with correct fields.
2. **Prompt enrichment test** — Added: "enriches prompt with error context on retry (AC4)". Verifies second dispatch config contains `[OVERSEER]` prefix with failure reason.
3. **Escalation test** — Added: "escalates immediately when retry policy denies retry (AC2)". Verifies maxRetries=0 → immediate escalation with journal entry.

## Test Results

```
PASS (1123) FAIL (0)
```
