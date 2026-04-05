# Verification: M08-S02 — PI Extension Audit & Entry Point Wiring

**Date:** 2026-04-05
**Verifier:** Product-lead (automated)

---

## AC1: main.ts bootstraps a PI session via DefaultResourceLoader.extensionFactories

**PASS**

Revised per spec note: bootstrap deferred to loader.ts (S06). `src/cli/main.ts` is an export-only module with:
- Named export: `createTffExtension` (line 14)
- Type re-export: `TffExtensionOptions` (line 13)
- Default export function that calls `createTffExtension(pi, { projectRoot: process.cwd() })` (line 17)

The file header comment explicitly documents the deferral: "Bootstrap (createAgentSession) lives in loader.ts (M08-S06)."

**Evidence:** `src/cli/main.ts` lines 1-19

---

## AC2: Default export present for PI auto-discovery

**PASS**

`export default function (pi: ExtensionAPI)` at line 17 of `src/cli/main.ts`. Comment on line 16 documents the PI SDK requirement.

**Evidence:** `src/cli/main.ts:17`

---

## AC3: No z.default() in any tool parameter schema

**PASS**

`grep` for `.default(` across all `*.tool.ts` files in `src/hexagons/` returns zero matches. Confirmed no `z.*.default()` calls in any tool parameter schema.

**Evidence:** `Grep pattern "\.default\(" glob "*.tool.ts"` — no matches found

---

## AC4: Resources resolve correctly from both src/ (dev) and dist/ (production)

**PASS**

`resolveResourceRoot()` function at `src/cli/extension.ts:184-188`:
```typescript
function resolveResourceRoot(projectRoot: string): string {
  const distResources = join(projectRoot, "dist", "resources");
  if (existsSync(distResources)) return distResources;
  return join(projectRoot, "src", "resources");
}
```

Checks `dist/resources/` first (production), falls back to `src/resources/` (dev).

**Evidence:** `src/cli/extension.ts:184-188`

---

## AC5: All command handlers have (args: string, ctx: ExtensionCommandContext) signature

**PASS**

All 14 command handler files verified. Each has `handler: async (args: string, ctx)` or `handler: async (_args: string, _ctx: ExtensionCommandContext)` signature:

- `help.command.ts` — `(_args: string, _ctx: ExtensionCommandContext)`
- `research.command.ts` — `(args: string, ctx)`
- `plan.command.ts` — `(args: string, ctx)`
- `progress.command.ts` — `(_args: string, _ctx: ExtensionCommandContext)`
- `debug.command.ts` — `(args: string, ctx)`
- `map-codebase.command.ts` — `(args: string, _ctx: ExtensionCommandContext)`
- `quick.command.ts` — `(args: string, ctx)`
- `settings.command.ts` — `(_args: string, _ctx: ExtensionCommandContext)`
- `discuss.command.ts` — `(args: string, ctx)`
- `health.command.ts` — `(_args: string, _ctx: ExtensionCommandContext)`
- `rollback.command.ts` — `(args: string, _ctx: ExtensionCommandContext)`
- `audit-milestone.command.ts` — `(_args: string, _ctx: ExtensionCommandContext)`
- `remove-slice.command.ts` — `(args: string, _ctx: ExtensionCommandContext)`
- `add-slice.command.ts` — `(args: string, _ctx: ExtensionCommandContext)`

Inline handlers in `extension.ts` (verify, ship, complete-milestone) also use correct signatures:
- `tff:verify` — `(args: string, _ctx: ExtensionCommandContext)` (line 474)
- `tff:ship` — `(args: string, _ctx: ExtensionCommandContext)` (line 566)
- `tff:complete-milestone` — `(_args: string, _ctx: ExtensionCommandContext)` (line 628)

**Evidence:** `grep "handler: async" src/hexagons/*/infrastructure/pi/*.command.ts` + manual read of extension.ts

---

## AC6: verifyUseCase, shipSliceUseCase, completeMilestoneUseCase registered as PI commands

**PASS**

All three registered in `src/cli/extension.ts`:
- `api.registerCommand("tff:verify", ...)` at line 472
- `api.registerCommand("tff:ship", ...)` at line 564
- `api.registerCommand("tff:complete-milestone", ...)` at line 626

Each handler looks up the slice/milestone, invokes the use case, and reports results via `api.sendUserMessage()`.

**Evidence:** `src/cli/extension.ts:472, 564, 626`

---

## AC7: AlwaysUnderBudgetAdapter replaced with logging adapter

**PASS**

- `LoggingBudgetAdapter` imported at `extension.ts:72` and instantiated at line 915: `new LoggingBudgetAdapter(logger)`
- `AlwaysUnderBudgetAdapter` is NOT imported or used anywhere in `src/cli/`
- `LoggingBudgetAdapter` (`src/hexagons/settings/infrastructure/logging-budget.adapter.ts`) returns `ok(0)` and logs a one-time warning: "Budget tracking not configured -- using unlimited budget"
- `AlwaysUnderBudgetAdapter` still exists in its own file and is used only in test code (`resolve-model.use-case.spec.ts`)

**Evidence:** `src/cli/extension.ts:72,915`, `src/hexagons/settings/infrastructure/logging-budget.adapter.ts`

---

## AC8: Single state.db file (no ship-records.db, completion-records.db, audit-records.db references)

**PASS**

- Exactly one `new Database()` call in `extension.ts` at line 230: `new Database(join(rootTffDir, "state.db"))`
- Grep for `ship-records.db`, `completion-records.db`, `audit-records.db` in `src/` returns zero matches
- All repositories (`SqliteShipRecordRepository`, `SqliteCompletionRecordRepository`, `SqliteMilestoneAuditRecordRepository`) receive `stateDb` as constructor argument

**Evidence:** `src/cli/extension.ts:230`, grep confirms zero references to fragmented DB files

---

## AC9: createZodTool strips additionalProperties from JSON Schema output

**PASS**

`src/infrastructure/pi/create-zod-tool.ts` lines 33-36:
```typescript
if ("additionalProperties" in jsonSchema) {
  delete (jsonSchema as Record<string, unknown>).additionalProperties;
}
```

Comment explains rationale: PI SDK uses TypeBox (no `additionalProperties`), Zod emits it, stripping prevents AJV from rejecting hallucinated extra properties.

**Evidence:** `src/infrastructure/pi/create-zod-tool.ts:31-36`

---

## AC10: npm run build copies src/resources/ to dist/resources/

**PASS**

`package.json` scripts:
- `"build": "tsc -p tsconfig.build.json && npm run copy-resources"`
- `"copy-resources": "cp -r src/resources/agents src/resources/prompts src/resources/protocols dist/resources/"`

Verified by running `npm run build` -- completed successfully. `dist/resources/prompts/` exists and contains expected files (audit-milestone-intent.md, critique-then-reflection.md, fixer.md, etc.).

**Evidence:** `package.json:9-10`, `npm run build` exit 0, `ls dist/resources/prompts/` shows files

---

## AC11: F10 documented as tech debt (not fixed)

**FAIL**

F10 (cross-hexagon type imports between `slice <-> workflow`) is documented in the slice artifacts:
- `SPEC.md` lines 58-61 describe the finding and deferral decision
- `RESEARCH.md` lines 109-111 document the analysis
- `PLAN.md` lines 187-198 planned to add documentation to ARCHITECTURE.md

However, neither `ARCHITECTURE.md` nor `CONCERNS.md` contains any mention of F10 or cross-hexagon type import tech debt. The PLAN.md Task 9 Step 1 explicitly required adding a "Known Tech Debt" section to ARCHITECTURE.md, but this was not executed.

The `AlwaysUnderBudgetAdapter` file still exists (acceptable -- used in tests), but the CONCERNS.md tech debt table is stale (still lists the old main.ts placeholder TODO and other items that have been resolved by this slice).

**Evidence:**
- `grep "F10\|Known Tech Debt\|cross.hexagon.*type" .tff/docs/ARCHITECTURE.md` — no matches
- `grep "F10\|cross-hexagon.*type" .tff/docs/CONCERNS.md` — no matches
- `PLAN.md:187-198` — Task 9 planned this but was not completed

---

## AC12: All tests pass, typecheck clean, lint clean

**PASS**

- `npm run typecheck` — clean (exit 0, no errors)
- `npm run lint` — "Checked 715 files in 159ms. No fixes applied." (exit 0)
- `npm test` — 260 passed, 1 skipped (plannotator integration, expected), 2416 tests passed, 0 failures

**Evidence:** All three commands executed with exit code 0

---

## Summary

| AC | Criterion | Verdict |
|----|-----------|---------|
| 1 | main.ts proper exports (bootstrap deferred to S06) | PASS |
| 2 | Default export for PI auto-discovery | PASS |
| 3 | No z.default() in tool schemas | PASS |
| 4 | Resource resolution (src/ and dist/) | PASS |
| 5 | Command handler signatures | PASS |
| 6 | verify/ship/complete-milestone as PI commands | PASS |
| 7 | LoggingBudgetAdapter replaces AlwaysUnderBudget | PASS |
| 8 | Single state.db | PASS |
| 9 | createZodTool strips additionalProperties | PASS |
| 10 | Build copies resources to dist/ | PASS |
| 11 | F10 documented as tech debt | FAIL |
| 12 | Tests, typecheck, lint all clean | PASS |

**Overall: 11/12 PASS, 1 FAIL**

**AC11 remediation:** Add a "Known Tech Debt" section to `.tff/docs/ARCHITECTURE.md` documenting the `slice <-> workflow` bidirectional type import issue (F10), per PLAN.md Task 9.
