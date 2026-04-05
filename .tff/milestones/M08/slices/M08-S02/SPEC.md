# M08-S02: PI Extension Audit & Entry Point Wiring

## Problem

The CLI entry point (`main.ts`) is a placeholder that can't bootstrap a PI session. A full audit of the extension against PI SDK conventions revealed 10 issues: a latent `z.default()` bug in tool schemas, hardcoded `src/resources/` paths that break when running from `dist/`, incomplete command handler signatures, unreachable use case wiring, a stub budget adapter, fragmented SQLite files, and minor schema/architecture concerns.

## Audit Findings (all addressed in this slice)

### Critical

#### F1: `main.ts` is a placeholder
Wire `DefaultResourceLoader.extensionFactories` bootstrap. Add default export for PI auto-discovery.

#### F2: `z.default()` latent bug in createZodTool
PI's AJV doesn't set `useDefaults: true`. Zod's `.default()` emits the field as `required` with a `default` property — AJV rejects if the LLM omits it. Affects `tff_write_plan` (`blockedBy: z.array().default([])`) and `tff_map_codebase` (`mode: z.enum().default("full")`).

**Fix:** Replace `.default(x)` with `.optional()` in tool parameter schemas. Apply defaults inside `execute()` callbacks.

#### F3: Hardcoded `src/resources/` paths
Lines 201, 247, 327 of `extension.ts` reference `src/resources/` — breaks when running from `dist/`. 

**Fix:** Add a `copy-resources` build step. Resolve resource root relative to `import.meta.url` with fallback to `src/resources/` for dev mode.

### Medium

#### F4: 8 command handlers missing `ctx` parameter
Commands: rollback, audit-milestone, add-slice, remove-slice, health, help, map-codebase, progress, settings. Missing `ctx: ExtensionCommandContext` — prevents future access to `ctx.newSession()`, `ctx.ui`.

**Fix:** Add `(_args: string, ctx: ExtensionCommandContext)` to all 8 handlers.

#### F5: 3 void-suppressed use cases
`verifyUseCase` (L470), `shipSliceUseCase` (L537), `completeMilestoneUseCase` (L573) are fully wired then discarded with `void`. They're unreachable — the TFF skill system invokes them through `/tff:verify` etc., not through PI commands.

**Fix:** Register them as PI commands (`tff:verify`, `tff:ship`, `tff:complete-milestone`) so they're accessible from both the skill system and direct invocation.

#### F6: `AlwaysUnderBudgetAdapter`
Budget display always shows 0%, model downshift is inert.

**Fix:** Replace with `LoggingBudgetAdapter` that returns 0% but logs a warning on first call: "Budget tracking not configured — using unlimited budget".

#### F7: No default export for PI auto-discovery
`main.ts` only exports `createTffExtension` as a named export. PI auto-discovery requires a default export.

**Fix:** Add `export default function(pi: ExtensionAPI) { createTffExtension(pi, { projectRoot: process.cwd() }); }`.

### Low

#### F8: 4 separate SQLite files
`state.db`, `ship-records.db`, `completion-records.db`, `audit-records.db` — each with own WAL/lock files.

**Fix:** Consolidate all tables into `state.db`. Remove the 3 extra `new Database()` calls. Each repository already does `CREATE TABLE IF NOT EXISTS`.

#### F9: `additionalProperties: false` in Zod JSON Schema
Zod emits this, TypeBox doesn't. If an LLM hallucinates extra properties, AJV rejects before execute() runs.

**Fix:** Strip `additionalProperties` from the JSON Schema output in `createZodTool` after `toJSONSchema()`.

#### F10: `slice ↔ workflow` bidirectional type imports
Architectural boundary violation — `slice` imports from `workflow` domain and vice versa. All are `import type` so no runtime issue.

**Fix:** Document as known tech debt. Not fixing in this slice — would require moving shared types to kernel, which is a larger refactor.

## Solution

### 1. Wire main.ts

```typescript
#!/usr/bin/env node
import { createAgentSession, DefaultResourceLoader } from "@mariozechner/pi-coding-agent";
import { createTffExtension } from "./extension.js";

const resourceLoader = new DefaultResourceLoader({
  extensionFactories: [(pi) => createTffExtension(pi, { projectRoot: process.cwd() })],
});
await resourceLoader.reload();
const { session } = await createAgentSession({ resourceLoader });
```

Plus default export:
```typescript
export default function(pi: ExtensionAPI) {
  createTffExtension(pi, { projectRoot: process.cwd() });
}
```

### 2. Fix z.default() in tool schemas

In `write-plan.tool.ts` and `map-codebase.tool.ts`:
- Replace `z.foo().default(x)` with `z.foo().optional()`
- Apply defaults at the start of `execute()`: `const mode = params.mode ?? "full"`

### 3. Resource path resolution

Add `copy-resources` script to build pipeline:
```json
"copy-resources": "cp -r src/resources dist/resources"
```

Update `extension.ts` to resolve resources relative to module location:
```typescript
const resourceRoot = resolveResourceRoot(options.projectRoot);
// Checks dist/resources/ first, falls back to src/resources/
```

### 4. Fix command signatures (8 files)

Add `(_args: string, _ctx: ExtensionCommandContext)` to: rollback, audit-milestone, add-slice, remove-slice, health, help, map-codebase, progress, settings commands.

### 5. Register void use cases as PI commands

Wire `verifyUseCase`, `shipSliceUseCase`, `completeMilestoneUseCase` as `tff:verify`, `tff:ship`, `tff:complete-milestone` commands.

### 6. Replace AlwaysUnderBudgetAdapter

Create `LoggingBudgetAdapter` that returns `ok(0)` but logs a one-time warning.

### 7. Consolidate SQLite files

Remove `ship-records.db`, `completion-records.db`, `audit-records.db`. Pass `stateDb` to all repositories.

### 8. Strip additionalProperties from createZodTool

After `toJSONSchema()`, delete `jsonSchema.additionalProperties` before casting to TSchema.

## Files Affected

| File | Action |
|------|--------|
| `src/cli/main.ts` | Rewrite (bootstrap + default export) |
| `src/cli/extension.ts` | Edit (resource resolution, SQLite consolidation, register void use cases) |
| `src/infrastructure/pi/create-zod-tool.ts` | Edit (strip additionalProperties) |
| `src/hexagons/workflow/infrastructure/pi/write-plan.tool.ts` | Edit (z.default → z.optional) |
| `src/hexagons/workflow/infrastructure/pi/map-codebase.tool.ts` | Edit (z.default → z.optional) |
| `src/hexagons/settings/infrastructure/logging-budget.adapter.ts` | Create (new) |
| 8 command files | Edit (add ctx parameter) |
| `package.json` | Edit (add copy-resources to build) |

## Acceptance Criteria

- [ ] `main.ts` bootstraps a PI session via `DefaultResourceLoader.extensionFactories`
- [ ] Default export present for PI auto-discovery
- [ ] No `z.default()` in any tool parameter schema (replaced with `.optional()`)
- [ ] Resources resolve correctly from both `src/` (dev) and `dist/` (production)
- [ ] All command handlers have `(args: string, ctx: ExtensionCommandContext)` signature
- [ ] `verifyUseCase`, `shipSliceUseCase`, `completeMilestoneUseCase` registered as PI commands
- [ ] `AlwaysUnderBudgetAdapter` replaced with logging adapter
- [ ] Single `state.db` file (no ship-records.db, completion-records.db, audit-records.db)
- [ ] `createZodTool` strips `additionalProperties` from JSON Schema output
- [ ] `npm run build` copies `src/resources/` to `dist/resources/`
- [ ] F10 documented as tech debt (not fixed)
- [ ] All tests pass, typecheck clean, lint clean

## Risks

- **PI SDK version coupling** — bootstrap API may change across PI versions. Pin `@mariozechner/pi-coding-agent` version.
- **SQLite consolidation** — existing `.tff/` directories will have orphan DB files. Non-breaking (just unused files) but worth noting in CHANGELOG.
