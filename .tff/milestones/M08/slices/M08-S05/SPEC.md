# M08-S05: Production Adapter Completeness

## Problem

Three production-readiness gaps remain in the codebase:

1. **Silent budget bypass** — `AlwaysUnderBudgetAdapter` returns `ok(0)` with no indication that budget tracking is unconfigured. `ResolveModelUseCase` silently uses default model profiles without warning.
2. **Unexplained skipped test** — `plannotator-review-ui.integration.spec.ts` is conditionally skipped via env gate with no unit-level coverage of the adapter.
3. **Lint violation** — unused `fns` destructuring in `settings.command.spec.ts:78` produces a biome warning.

## Approach

Rename + warn for budget adapter, replace integration test with unit test, fix lint.

## Design

### 1. Budget Adapter: Rename + Warn

**Rename** `AlwaysUnderBudgetAdapter` to `NoBudgetTrackingAdapter`.
- File: `always-under-budget.adapter.ts` → `no-budget-tracking.adapter.ts`
- Class: `AlwaysUnderBudgetAdapter` → `NoBudgetTrackingAdapter`
- Add `console.warn` with `[tff]` prefix on first `getUsagePercent()` call (warn-once pattern)
- Still returns `ok(0)` — behavior unchanged
- No constructor dependencies (uses `console.warn` directly)

**Import updates:**
- `src/cli/extension.ts:829` — update import path + class name
- `src/hexagons/settings/use-cases/resolve-model.use-case.spec.ts` — update imports
- Delete `src/hexagons/settings/infrastructure/always-under-budget.adapter.ts`

### 2. Plannotator Test: Integration → Unit

**Delete** `plannotator-review-ui.integration.spec.ts`.
**Create** `plannotator-review-ui.adapter.spec.ts` (unit test).

Strategy:
- `vi.mock("node:child_process")` to stub `execFile`
- Mock returns plannotator-style stdout
- Test all 3 public methods:
  1. `presentFindings()` → `acknowledged: true` + formatted output
  2. `presentVerification()` → `accepted: true` + formatted output
  3. `presentForApproval()` → `decision: "approved"` (no change markers)
  4. `presentForApproval()` → `decision: "changes_requested"` (with `[DELETION]` marker)
  5. Error path → graceful fallback responses
- No env var gate — runs in all environments
- Verifies markdown formatting passed to CLI args

### 3. Lint Fix

Change `const { fns } = await invokeHandler(deps)` to `await invokeHandler(deps)` in `settings.command.spec.ts:78`.

### 4. Full Lint Verification

Run `npm run lint` (biome check) — expect zero errors, zero warnings.

## Acceptance Criteria

- [ ] **AC1:** Budget tracking is not silently bypassed — `NoBudgetTrackingAdapter` logs `[tff] Budget tracking not configured` warning on first use
- [ ] **AC2:** No unexplained skipped tests — integration spec replaced with unit spec covering all 3 adapter methods + error paths
- [ ] **AC3:** Zero lint warnings — `npm run lint` exits clean (0 errors, 0 warnings)
- [ ] **AC4:** All existing tests pass — `npm run test` green
- [ ] **AC5:** No other stub adapters silently bypass behavior in production code (audit confirmed: only `AlwaysUnderBudgetAdapter` existed)

## Non-Goals

- Implementing real budget tracking (external API integration) — future work
- Adding budget configuration to `settings.yaml` — future work
- CI pipeline changes for plannotator integration tests

## Files Affected

| Action | File |
|--------|------|
| Delete | `src/hexagons/settings/infrastructure/always-under-budget.adapter.ts` |
| Create | `src/hexagons/settings/infrastructure/no-budget-tracking.adapter.ts` |
| Edit | `src/cli/extension.ts` (import path + class name) |
| Edit | `src/hexagons/settings/use-cases/resolve-model.use-case.spec.ts` (imports) |
| Delete | `src/hexagons/review/infrastructure/adapters/review-ui/plannotator-review-ui.integration.spec.ts` |
| Create | `src/hexagons/review/infrastructure/adapters/review-ui/plannotator-review-ui.adapter.spec.ts` |
| Edit | `src/hexagons/workflow/infrastructure/pi/settings.command.spec.ts` (line 78) |
