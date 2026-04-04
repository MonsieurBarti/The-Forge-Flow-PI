# PLAN — M06-S01: pi-ai Direct Dependency + Type Cleanup

## Summary

Promote pi-ai to direct dep ⇒ rewrite `pi.types.ts` as re-export barrel ⇒ adapt `createZodTool` bridge ∧ `textResult` helper ⇒ update barrel ⇒ delete dead spec file ⇒ verify all tests pass. Single wave — all tasks sequential (each builds on prior).

## Tasks

| # | Title | Files | Deps | Wave |
|---|-------|-------|------|------|
| T01 | Add pi-ai direct dependency | `package.json` | — | 1 |
| T02 | Rewrite pi.types.ts as re-export barrel | `src/infrastructure/pi/pi.types.ts` | T01 | 1 |
| T03 | Adapt createZodTool for real ToolDefinition | `src/infrastructure/pi/create-zod-tool.ts` | T02 | 1 |
| T04 | Update textResult for real AgentToolResult | `src/infrastructure/pi/tool-result.helper.ts` | T02 | 1 |
| T05 | Update index.ts barrel exports | `src/infrastructure/pi/index.ts` | T02 | 1 |
| T06 | Delete pi.types.spec.ts | `src/infrastructure/pi/pi.types.spec.ts` | T02 | 1 |
| T07 | Verify compilation ∧ all tests pass | — | T03, T04, T05, T06 | 1 |

## Task Details

### T01: Add pi-ai direct dependency

**Description:** Promote `@mariozechner/pi-ai` from transitive to direct dependency.
**AC:** AC1
**Files:** modify `package.json`

**Steps:**
1. Add `"@mariozechner/pi-ai": "^0.64.0"` to `dependencies` in `package.json`
2. Run `npm install` to update lockfile
3. Verify `node_modules/@mariozechner/pi-ai` resolves

### T02: Rewrite pi.types.ts as re-export barrel

**Description:** Replace all hand-written interfaces with re-exports from `@mariozechner/pi-coding-agent` ∧ `@mariozechner/pi-ai`.
**AC:** AC2
**Files:** modify `src/infrastructure/pi/pi.types.ts`

**TDD:**
- RED: Write test that asserts `ExtensionAPI` re-exported from `pi.types.ts` is the same type as from `@mariozechner/pi-coding-agent` (import both, assign one to the other — compilation = pass)
- GREEN: Rewrite `pi.types.ts` as re-export barrel:
  - `AgentToolResult`, `ExtensionAPI`, `ExtensionCommandContext`, `ExtensionContext`, `RegisteredCommand`, `ToolDefinition` from `@mariozechner/pi-coding-agent`
  - `Api`, `KnownProvider`, `Model`, `Provider`, `Usage` from `@mariozechner/pi-ai`
  - `RegisterCommandOptions` as `Omit<RegisteredCommand, "name" | "sourceInfo">`
- REFACTOR: Remove any dead code, verify no hand-written interfaces remain

### T03: Adapt createZodTool for real ToolDefinition

**Description:** Update imports ⇒ real SDK types. Bridge `parameters` via `as unknown as TSchema` cast. Add `details: undefined` to error path. Narrow return types to `AgentToolResult<undefined>`.
**AC:** AC3, AC4
**Files:** modify `src/infrastructure/pi/create-zod-tool.ts`

**TDD:**
- RED: Existing `createZodTool` tests should still compile ∧ pass after type changes (if they break, that's the red)
- GREEN:
  - Import `TSchema` from `@mariozechner/pi-ai`
  - Import `AgentToolResult`, `ExtensionContext`, `ToolDefinition` from `@mariozechner/pi-coding-agent`
  - `parameters: jsonSchema as unknown as TSchema`
  - Error return: add `details: undefined`
  - `ZodToolConfig.execute` return type: `AgentToolResult<undefined>`
- REFACTOR: Verify all downstream tool files still compile (barrel preserves path)

### T04: Update textResult for real AgentToolResult

**Description:** Swap import source ⇒ real type. Add `details: undefined`. Narrow return type.
**AC:** AC5
**Files:** modify `src/infrastructure/pi/tool-result.helper.ts`

**TDD:**
- RED: Compilation will fail if `textResult` return doesn't satisfy `AgentToolResult<undefined>` (missing `details`)
- GREEN:
  - Import `AgentToolResult` from `@mariozechner/pi-coding-agent`
  - Return type: `AgentToolResult<undefined>`
  - Add `details: undefined` to return object
- REFACTOR: None needed — single-line helper

### T05: Update index.ts barrel exports

**Description:** Update re-export list: drop `ContentBlock`, keep `RegisterCommandOptions`, add AI types.
**AC:** AC8
**Files:** modify `src/infrastructure/pi/index.ts`

**Steps:**
1. Remove `ContentBlock` from type re-exports
2. Add `RegisterCommandOptions` (already present — verify retained)
3. Add AI type re-exports: `Api`, `KnownProvider`, `Model`, `Provider`, `Usage`
4. Verify `createZodTool`, `ZodToolConfig`, `textResult` still exported

### T06: Delete pi.types.spec.ts

**Description:** Remove dead spec file — tested hand-written types that no longer exist.
**AC:** AC6
**Files:** delete `src/infrastructure/pi/pi.types.spec.ts`

**Steps:**
1. Delete file
2. Verify no imports reference it

### T07: Verify compilation ∧ all tests pass

**Description:** Full verification — typecheck ∧ test suite.
**AC:** AC7
**Steps:**
1. `npm run typecheck` — zero errors
2. `npm test` — all pass
3. Verify no downstream `*.tool.ts` ∨ `*.extension.ts` files needed changes
