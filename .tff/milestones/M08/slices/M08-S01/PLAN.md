# M08-S01: Build Hygiene & Dependency Fix — Implementation Plan

> For agentic workers: execute task-by-task. No TDD (S-tier config changes).

**Goal:** Exclude test files from production build, fix dependency classification, eliminate lint warning.
**Tech Stack:** TypeScript, Biome

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `tsconfig.build.json` | Create | Production build config excluding test artifacts |
| `package.json` | Modify | Build script + dependency reclassification |
| `src/hexagons/workflow/infrastructure/pi/settings.command.spec.ts` | Modify | Remove unused variable |

---

### Task 1: Create tsconfig.build.json
**Files:** Create `tsconfig.build.json`
**Traces to:** AC1, AC2

- [ ] Step 1: Create `tsconfig.build.json` at project root:
```jsonc
{
  "extends": "./tsconfig.json",
  "exclude": [
    "node_modules",
    "dist",
    "**/*.spec.ts",
    "**/*.builder.ts",
    "src/test-setup.ts"
  ]
}
```
- [ ] Step 2: Verify `npx tsc -p tsconfig.build.json --noEmit` passes
- [ ] Step 3: Commit `chore(S01/T01): add tsconfig.build.json excluding test files`

### Task 2: Update build script and move better-sqlite3
**Files:** Modify `package.json`
**Traces to:** AC1, AC3, AC4
**Depends on:** T01

- [ ] Step 1: In `package.json`, change build script:
```diff
- "build": "tsc",
+ "build": "tsc -p tsconfig.build.json",
```
- [ ] Step 2: Move `better-sqlite3` from `devDependencies` to `dependencies` (keep `@types/better-sqlite3` in devDeps)
- [ ] Step 3: Run `npm run build` — verify dist/ has no `.spec.ts` or `.builder.ts` output
- [ ] Step 4: Run `npm run typecheck` — verify it still uses base tsconfig and passes
- [ ] Step 5: Commit `chore(S01/T02): update build script and move better-sqlite3 to deps`

### Task 3: Fix unused variable lint warning
**Files:** Modify `src/hexagons/workflow/infrastructure/pi/settings.command.spec.ts`
**Traces to:** AC5

- [ ] Step 1: At line 78, change:
```diff
- const { fns } = await invokeHandler(deps);
+ await invokeHandler(deps);
```
- [ ] Step 2: Run `npm run lint` — verify zero warnings
- [ ] Step 3: Commit `fix(S01/T03): remove unused fns variable in settings command spec`

### Task 4: Verify all acceptance criteria
**Traces to:** AC1-AC6

- [ ] Step 1: `npm run build` — passes, no spec files in dist/
- [ ] Step 2: `npm run typecheck` — passes (test files type-checked)
- [ ] Step 3: `npm run lint` — zero warnings
- [ ] Step 4: `npm test` — all tests pass
