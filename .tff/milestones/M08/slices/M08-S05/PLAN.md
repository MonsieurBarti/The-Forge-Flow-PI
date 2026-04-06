# M08-S05: Production Adapter Completeness — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Eliminate three production-readiness gaps — silent budget bypass, unexplained skipped test, lint violation.
**Architecture:** Hexagonal (port/adapter). Changes touch settings + review hexagons + CLI wiring.
**Tech Stack:** TypeScript, Vitest, Biome

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/hexagons/settings/infrastructure/no-budget-tracking.adapter.ts` | Budget adapter with warn-once |
| Create | `src/hexagons/settings/infrastructure/no-budget-tracking.adapter.spec.ts` | Unit test for warn-once behavior |
| Delete | `src/hexagons/settings/infrastructure/always-under-budget.adapter.ts` | Old stub (replaced) |
| Edit | `src/cli/extension.ts` | Update import + class name at line 71, 829 |
| Edit | `src/hexagons/settings/use-cases/resolve-model.use-case.spec.ts` | Replace AlwaysUnderBudgetAdapter with FixedBudgetAdapter(0), suppress console.warn |
| Delete | `src/hexagons/review/infrastructure/adapters/review-ui/plannotator-review-ui.integration.spec.ts` | Old integration test |
| Create | `src/hexagons/review/infrastructure/adapters/review-ui/plannotator-review-ui.adapter.spec.ts` | Unit test for all 3 adapter methods |
| Edit | `src/hexagons/workflow/infrastructure/pi/settings.command.spec.ts` | Remove unused `fns` destructuring |

---

## Wave 0 (parallel — no dependencies)

### T01: Write unit test for NoBudgetTrackingAdapter
**Files:** Create `src/hexagons/settings/infrastructure/no-budget-tracking.adapter.spec.ts`
**Traces to:** AC1

- [ ] Step 1: Write failing test
```typescript
// src/hexagons/settings/infrastructure/no-budget-tracking.adapter.spec.ts
import { isOk } from "@kernel";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoBudgetTrackingAdapter } from "./no-budget-tracking.adapter";

describe("NoBudgetTrackingAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok(0)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = new NoBudgetTrackingAdapter();
    const result = await adapter.getUsagePercent();
    expect(isOk(result)).toBe(true);
    if (result.ok) expect(result.data).toBe(0);
  });

  it("warns on first call", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = new NoBudgetTrackingAdapter();
    await adapter.getUsagePercent();
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(
      "[tff] Budget tracking not configured — model selection uses defaults",
    );
  });

  it("warns only once across multiple calls", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = new NoBudgetTrackingAdapter();
    await adapter.getUsagePercent();
    await adapter.getUsagePercent();
    await adapter.getUsagePercent();
    expect(spy).toHaveBeenCalledOnce();
  });
});
```
- [ ] Step 2: Run `npx vitest run src/hexagons/settings/infrastructure/no-budget-tracking.adapter.spec.ts`, verify FAIL (module not found)

### T02: Write unit test for PlannotatorReviewUIAdapter
**Files:** Create `src/hexagons/review/infrastructure/adapters/review-ui/plannotator-review-ui.adapter.spec.ts`
**Traces to:** AC2

- [ ] Step 1: Write failing test
```typescript
// src/hexagons/review/infrastructure/adapters/review-ui/plannotator-review-ui.adapter.spec.ts
import { isOk } from "@kernel";
import { type Mock, afterEach, describe, expect, it, vi } from "vitest";
import { PlannotatorReviewUIAdapter } from "./plannotator-review-ui.adapter";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn().mockResolvedValue("/tmp/tff-review-ui-mock"),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

import { execFile } from "node:child_process";

function mockExecFile(stdout: string) {
  (execFile as unknown as Mock).mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
      cb(null, stdout);
    },
  );
}

function mockExecFileError(message: string) {
  (execFile as unknown as Mock).mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
      cb(new Error(message));
    },
  );
}

describe("PlannotatorReviewUIAdapter", () => {
  const adapter = new PlannotatorReviewUIAdapter("/usr/bin/plannotator");

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("presentFindings", () => {
    it("returns acknowledged with formatted output", async () => {
      mockExecFile("Reviewed: 0 findings");
      const result = await adapter.presentFindings({
        sliceId: "M08-S05",
        sliceLabel: "TEST-S05",
        verdict: "approved",
        findings: [],
        conflicts: [],
        fixCyclesUsed: 0,
        timedOutReviewers: [],
      });
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.data.acknowledged).toBe(true);
        expect(result.data.formattedOutput).toBe("Reviewed: 0 findings");
      }
    });

    it("returns fallback on error", async () => {
      mockExecFileError("plannotator crashed");
      const result = await adapter.presentFindings({
        sliceId: "M08-S05",
        sliceLabel: "TEST-S05",
        verdict: "approved",
        findings: [],
        conflicts: [],
        fixCyclesUsed: 0,
        timedOutReviewers: [],
      });
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.data.acknowledged).toBe(true);
        expect(result.data.formattedOutput).toContain("plannotator error");
      }
    });
  });

  describe("presentVerification", () => {
    it("returns accepted with formatted output", async () => {
      mockExecFile("Verification complete");
      const result = await adapter.presentVerification({
        sliceId: "M08-S05",
        sliceLabel: "TEST-S05",
        criteria: [{ criterion: "AC1", verdict: "PASS", evidence: "test passed" }],
        overallVerdict: "PASS",
      });
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.data.accepted).toBe(true);
        expect(result.data.formattedOutput).toBe("Verification complete");
      }
    });
  });

  describe("presentForApproval", () => {
    it("returns approved when no change markers in output", async () => {
      mockExecFile("LGTM — no changes needed");
      const result = await adapter.presentForApproval({
        sliceId: "M08-S05",
        sliceLabel: "TEST-S05",
        artifactType: "plan",
        artifactPath: "/tmp/PLAN.md",
        summary: "Test plan",
      });
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.data.decision).toBe("approved");
        expect(result.data.feedback).toBeUndefined();
      }
    });

    it("returns changes_requested when output contains [DELETION]", async () => {
      mockExecFile("Found issue [DELETION] remove this section");
      const result = await adapter.presentForApproval({
        sliceId: "M08-S05",
        sliceLabel: "TEST-S05",
        artifactType: "plan",
        artifactPath: "/tmp/PLAN.md",
        summary: "Test plan",
      });
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.data.decision).toBe("changes_requested");
        expect(result.data.feedback).toBeDefined();
      }
    });

    it("returns changes_requested on error for safety", async () => {
      mockExecFileError("timeout");
      const result = await adapter.presentForApproval({
        sliceId: "M08-S05",
        sliceLabel: "TEST-S05",
        artifactType: "plan",
        artifactPath: "/tmp/PLAN.md",
        summary: "Test plan",
      });
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.data.decision).toBe("changes_requested");
        expect(result.data.formattedOutput).toContain("plannotator error");
      }
    });
  });
});
```
- [ ] Step 2: Run `npx vitest run src/hexagons/review/infrastructure/adapters/review-ui/plannotator-review-ui.adapter.spec.ts`, verify FAIL (adapter methods exist but assertions may fail depending on mock wiring)

### T03: Fix unused `fns` in settings.command.spec.ts
**Files:** Edit `src/hexagons/workflow/infrastructure/pi/settings.command.spec.ts`
**Traces to:** AC3

- [ ] Step 1: Change line 78 from `const { fns } = await invokeHandler(deps);` to `await invokeHandler(deps);`
- [ ] Step 2: Run `npx vitest run src/hexagons/workflow/infrastructure/pi/settings.command.spec.ts`, verify PASS
- [ ] Step 3: Commit `fix(S05/T03): remove unused fns destructuring in settings command spec`

---

## Wave 1 (depends on T01, T02)

### T04: Implement NoBudgetTrackingAdapter
**Files:** Create `src/hexagons/settings/infrastructure/no-budget-tracking.adapter.ts`, Delete `src/hexagons/settings/infrastructure/always-under-budget.adapter.ts`
**Traces to:** AC1
**Depends on:** T01

- [ ] Step 1: Create adapter
```typescript
// src/hexagons/settings/infrastructure/no-budget-tracking.adapter.ts
import { ok, type Result } from "@kernel";
import { BudgetTrackingPort } from "../domain/ports/budget-tracking.port";

export class NoBudgetTrackingAdapter extends BudgetTrackingPort {
  private warned = false;

  async getUsagePercent(): Promise<Result<number, never>> {
    if (!this.warned) {
      this.warned = true;
      console.warn("[tff] Budget tracking not configured — model selection uses defaults");
    }
    return ok(0);
  }
}
```
- [ ] Step 2: Delete `src/hexagons/settings/infrastructure/always-under-budget.adapter.ts`
- [ ] Step 3: Run `npx vitest run src/hexagons/settings/infrastructure/no-budget-tracking.adapter.spec.ts`, verify PASS (3/3)
- [ ] Step 4: Commit `feat(S05/T04): replace AlwaysUnderBudgetAdapter with NoBudgetTrackingAdapter`

### T07: Delete integration test, verify unit test passes
**Files:** Delete `src/hexagons/review/infrastructure/adapters/review-ui/plannotator-review-ui.integration.spec.ts`
**Traces to:** AC2
**Depends on:** T02

- [ ] Step 1: Delete `plannotator-review-ui.integration.spec.ts`
- [ ] Step 2: Run `npx vitest run src/hexagons/review/infrastructure/adapters/review-ui/plannotator-review-ui.adapter.spec.ts`, verify PASS (6/6)
- [ ] Step 3: Commit `test(S05/T07): replace plannotator integration test with unit test`

---

## Wave 2 (depends on T04)

### T05: Update extension.ts imports
**Files:** Edit `src/cli/extension.ts`
**Traces to:** AC1, AC4
**Depends on:** T04

- [ ] Step 1: Update import on line 71: `AlwaysUnderBudgetAdapter` → `NoBudgetTrackingAdapter`, path `always-under-budget.adapter` → `no-budget-tracking.adapter`
- [ ] Step 2: Update usage on line 829: `new AlwaysUnderBudgetAdapter()` → `new NoBudgetTrackingAdapter()`
- [ ] Step 3: Run `npx tsc --noEmit`, verify compiles cleanly
- [ ] Step 4: Commit `refactor(S05/T05): wire NoBudgetTrackingAdapter in extension`

### T06: Update resolve-model.use-case.spec.ts
**Files:** Edit `src/hexagons/settings/use-cases/resolve-model.use-case.spec.ts`
**Traces to:** AC4
**Depends on:** T04

- [ ] Step 1: Remove `AlwaysUnderBudgetAdapter` import (line 5). Replace usages on lines 22, 91, 127 with `new FixedBudgetAdapter(0)` (already defined in file).
```diff
-import { AlwaysUnderBudgetAdapter } from "../infrastructure/always-under-budget.adapter";
```
Replace three `new AlwaysUnderBudgetAdapter()` with `new FixedBudgetAdapter(0)`.
Note: No `console.warn` suppression needed — `FixedBudgetAdapter` does not emit warnings.
- [ ] Step 2: Run `npx vitest run src/hexagons/settings/use-cases/resolve-model.use-case.spec.ts`, verify PASS (all tests green, no console warnings)
- [ ] Step 3: Commit `refactor(S05/T06): remove AlwaysUnderBudgetAdapter from resolve-model tests`

---

## Wave 3 (depends on all previous)

### T08: Full verification
**Traces to:** AC3, AC4, AC5

- [ ] Step 1: Run `npm run lint` — expect 0 errors, 0 warnings
- [ ] Step 2: Run `npm run test` — expect all tests pass
- [ ] Step 3: Run `npx tsc --noEmit` — expect clean compilation
- [ ] Step 4: Grep for `AlwaysUnderBudget` in `src/` — expect 0 matches (docs/ references are historical and acceptable)
