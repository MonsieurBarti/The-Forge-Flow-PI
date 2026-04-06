# M08-S02: PI Extension Audit & Entry Point Wiring — Implementation Plan

> For agentic workers: execute task-by-task with TDD where applicable.

**Goal:** Fix 10 audit findings — wire main.ts, fix z.default() bug, resolve resource paths, fix command signatures, register void use cases, replace budget adapter, consolidate SQLite, strip additionalProperties.
**Architecture:** Hexagonal (cli/, infrastructure/pi/, hexagons/settings/)
**Tech Stack:** TypeScript, PI SDK, Zod, better-sqlite3

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/cli/main.ts` | Rewrite | PI bootstrap + default export |
| `src/cli/extension.ts` | Edit | Resource resolution, SQLite consolidation, register 3 commands |
| `src/infrastructure/pi/create-zod-tool.ts` | Edit | Strip additionalProperties |
| `src/hexagons/workflow/infrastructure/pi/write-plan.tool.ts` | Edit | z.default → z.optional |
| `src/hexagons/workflow/infrastructure/pi/map-codebase.tool.ts` | Edit | z.default → z.optional |
| `src/hexagons/settings/infrastructure/logging-budget.adapter.ts` | Create | Logging budget adapter |
| `src/hexagons/settings/infrastructure/logging-budget.adapter.spec.ts` | Create | Tests |
| 8 command files | Edit | Add ctx parameter to handler |
| `package.json` | Edit | Add copy-resources to build |

---

### Task 1: Fix z.default() bug in tool schemas
**Files:** Modify `src/hexagons/workflow/infrastructure/pi/write-plan.tool.ts`, `src/hexagons/workflow/infrastructure/pi/map-codebase.tool.ts`
**Traces to:** AC3

- [ ] Step 1: Write failing test — create test that validates tool schema has no `required` fields with `default` values (simulate AJV behavior)
- [ ] Step 2: In `write-plan.tool.ts` line 22, change:
  ```diff
  - blockedBy: z.array(z.string()).default([]).describe("Labels of blocking tasks"),
  + blockedBy: z.array(z.string()).optional().describe("Labels of blocking tasks"),
  ```
  In the execute callback, add: `const blockedBy = params.blockedBy ?? [];`
- [ ] Step 3: In `map-codebase.tool.ts` line 17, change:
  ```diff
  - mode: z.enum(["full", "incremental"]).default("full").describe("Generation mode"),
  + mode: z.enum(["full", "incremental"]).optional().describe("Generation mode"),
  ```
  In the execute callback, add: `const mode = params.mode ?? "full";`
- [ ] Step 4: Run tests, verify PASS
- [ ] Step 5: Commit `fix(S02/T01): replace z.default() with z.optional() in tool schemas`

### Task 2: Strip additionalProperties from createZodTool
**Files:** Modify `src/infrastructure/pi/create-zod-tool.ts`, `src/infrastructure/pi/create-zod-tool.spec.ts`
**Traces to:** AC9

- [ ] Step 1: Write failing test — assert that `createZodTool` output parameters do NOT contain `additionalProperties`
- [ ] Step 2: In `create-zod-tool.ts`, after `toJSONSchema()` on line 27-30, add:
  ```typescript
  if ("additionalProperties" in jsonSchema) {
    delete (jsonSchema as Record<string, unknown>).additionalProperties;
  }
  ```
- [ ] Step 3: Run tests, verify PASS
- [ ] Step 4: Commit `fix(S02/T02): strip additionalProperties from createZodTool JSON Schema`

### Task 3: Fix command handler signatures (8 files)
**Files:** Modify 8 command files
**Traces to:** AC5

- [ ] Step 1: Add `ExtensionCommandContext` import to each file that lacks it
- [ ] Step 2: Update signatures:
  - `rollback.command.ts:15` — `handler: async (args: string, _ctx: ExtensionCommandContext) => {`
  - `audit-milestone.command.ts:62` — `handler: async (_args: string, _ctx: ExtensionCommandContext) => {`
  - `add-slice.command.ts:12` — `handler: async (args: string, _ctx: ExtensionCommandContext) => {`
  - `remove-slice.command.ts:11` — `handler: async (args: string, _ctx: ExtensionCommandContext) => {`
  - `health.command.ts:56` — `handler: async (_args: string, _ctx: ExtensionCommandContext) => {`
  - `help.command.ts:6` — `handler: async (_args: string, _ctx: ExtensionCommandContext) => {`
  - `map-codebase.command.ts:13` — `handler: async (args: string, _ctx: ExtensionCommandContext) => {`
  - `progress.command.ts:35` — `handler: async (_args: string, _ctx: ExtensionCommandContext) => {`
  - `settings.command.ts:17` — `handler: async (_args: string, _ctx: ExtensionCommandContext) => {`
- [ ] Step 3: Run typecheck + lint, verify clean
- [ ] Step 4: Commit `fix(S02/T03): add ExtensionCommandContext to all command handlers`

### Task 4: Create LoggingBudgetAdapter
**Files:** Create `src/hexagons/settings/infrastructure/logging-budget.adapter.ts`, `src/hexagons/settings/infrastructure/logging-budget.adapter.spec.ts`
**Traces to:** AC7

- [ ] Step 1: Write failing test:
  ```typescript
  it("returns ok(0) and logs warning on first call", async () => {
    const logger = { warn: vi.fn() };
    const adapter = new LoggingBudgetAdapter(logger);
    const result = await adapter.getUsagePercent();
    expect(result).toEqual(ok(0));
    expect(logger.warn).toHaveBeenCalledOnce();
  });
  it("logs warning only once", async () => {
    const logger = { warn: vi.fn() };
    const adapter = new LoggingBudgetAdapter(logger);
    await adapter.getUsagePercent();
    await adapter.getUsagePercent();
    expect(logger.warn).toHaveBeenCalledOnce();
  });
  ```
- [ ] Step 2: Implement `LoggingBudgetAdapter` extending `BudgetTrackingPort`
- [ ] Step 3: Run tests, verify PASS
- [ ] Step 4: Commit `feat(S02/T04): add LoggingBudgetAdapter replacing AlwaysUnderBudget`

### Task 5: Consolidate SQLite files + wire LoggingBudgetAdapter
**Files:** Modify `src/cli/extension.ts`
**Traces to:** AC7, AC8
**Depends on:** T04

- [ ] Step 1: In `extension.ts`, remove lines creating `shipRecordDb`, `completionRecordDb`, `auditRecordDb` (L475-477, L546)
- [ ] Step 2: Pass `stateDb` to `SqliteShipRecordRepository`, `SqliteCompletionRecordRepository`, `SqliteMilestoneAuditRecordRepository`
- [ ] Step 3: Replace `AlwaysUnderBudgetAdapter` at L829 with `new LoggingBudgetAdapter(logger)`
- [ ] Step 4: Run tests, verify PASS
- [ ] Step 5: Commit `refactor(S02/T05): consolidate SQLite files and wire LoggingBudgetAdapter`

### Task 6: Register void use cases as PI commands
**Files:** Modify `src/cli/extension.ts`
**Traces to:** AC6
**Depends on:** T05

- [ ] Step 1: Remove `void verifyUseCase` (L470), `void shipSliceUseCase` (L537), `void completeMilestoneUseCase` (L573)
- [ ] Step 2: Register as commands:
  ```typescript
  api.registerCommand("tff:verify", {
    description: "Verify acceptance criteria for the current slice",
    handler: async (_args: string, _ctx: ExtensionCommandContext) => {
      // Delegate to verifyUseCase — detailed wiring TBD during execution
    },
  });
  ```
  Same pattern for `tff:ship` and `tff:complete-milestone`.
- [ ] Step 3: Typecheck + lint clean
- [ ] Step 4: Commit `feat(S02/T06): register verify, ship, complete-milestone as PI commands`

### Task 7: Resource path resolution + build copy step
**Files:** Modify `src/cli/extension.ts`, `package.json`
**Traces to:** AC4, AC10

- [ ] Step 1: Add to `package.json`:
  ```diff
  + "copy-resources": "cp -r src/resources dist/resources",
  - "build": "tsc -p tsconfig.build.json",
  + "build": "tsc -p tsconfig.build.json && npm run copy-resources",
  ```
- [ ] Step 2: In `extension.ts`, create `resolveResourceRoot()` helper:
  ```typescript
  function resolveResourceRoot(projectRoot: string): string {
    const distResources = join(projectRoot, "dist", "resources");
    if (existsSync(distResources)) return distResources;
    return join(projectRoot, "src", "resources");
  }
  ```
- [ ] Step 3: Replace all 3 hardcoded `src/resources` references (L201, L247, L327) with `resolveResourceRoot(options.projectRoot)`
- [ ] Step 4: Run `npm run build`, verify `dist/resources/` exists with prompts and agents
- [ ] Step 5: Commit `fix(S02/T07): resolve resources from dist/ with src/ fallback`

### Task 8: Rewrite main.ts as export-only module
**Files:** Rewrite `src/cli/main.ts`
**Traces to:** AC1, AC2
**Depends on:** T07

NOTE: main.ts becomes export-only. Bootstrap logic deferred to S06's `loader.ts`.
The `export default` is a required PI SDK exception to the named-export convention.

- [ ] Step 1: Rewrite `main.ts`:
  ```typescript
  /**
   * TFF-PI extension entry point.
   *
   * - Named export: for programmatic usage
   * - Default export: required by PI SDK for auto-discovery from .pi/extensions/
   *   (exception to project's named-export convention — PI SDK mandates default export)
   *
   * Bootstrap (createAgentSession) lives in loader.ts (M08-S06).
   */
  import type { ExtensionAPI } from "@infrastructure/pi";
  import { createTffExtension } from "./extension.js";
  export type { TffExtensionOptions } from "./extension.js";

  export { createTffExtension };

  // PI auto-discovery requires a default export — see pi-mono/packages/coding-agent/src/core/extensions/
  export default function(pi: ExtensionAPI) {
    createTffExtension(pi, { projectRoot: process.cwd() });
  }
  ```
- [ ] Step 2: Verify typecheck passes
- [ ] Step 3: Commit `feat(S02/T08): rewrite main.ts as PI extension entry point with default export`

### Task 9: Document F10 tech debt + final verification
**Traces to:** AC11, AC12

- [ ] Step 1: Document cross-hexagon type imports in ARCHITECTURE.md (not extension.ts — composition root is allowed to cross hexagons):
  ```markdown
  ## Known Tech Debt
  ### Cross-Hexagon Type Imports (M08-S02 F10)
  `slice ↔ workflow` and `review → workflow` have bidirectional `import type` statements
  at the domain layer. No runtime coupling. Fix requires extracting shared types to kernel.
  ```
- [ ] Step 2: Run full verification: `npm run build && npm run typecheck && npm run lint && npm test`
- [ ] Step 3: Commit `docs(S02/T09): document cross-hexagon type import tech debt`
