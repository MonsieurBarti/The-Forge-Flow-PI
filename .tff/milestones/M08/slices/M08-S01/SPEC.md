# M08-S01: Build Hygiene & Dependency Fix

## Problem

The TypeScript build compiles all 260 spec files and test infrastructure into `dist/`, bloating it to ~13MB. `better-sqlite3` is listed as a devDependency despite being imported at runtime in `extension.ts:145`, which would cause crashes for consumers. One lint warning (unused variable) exists.

## Solution

### 1. Create `tsconfig.build.json`

New file at project root:

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

### 2. Update build script

In `package.json`, change:

```diff
- "build": "tsc",
+ "build": "tsc -p tsconfig.build.json",
```

`typecheck` script remains `tsc --noEmit` (uses base tsconfig, includes test files).

### 3. Move `better-sqlite3` to dependencies

In `package.json`:
- Remove `"better-sqlite3": "^11.0.0"` from `devDependencies`
- Add `"better-sqlite3": "^11.0.0"` to `dependencies`
- `@types/better-sqlite3` stays in `devDependencies`

### 4. Fix lint warning

In `src/hexagons/workflow/infrastructure/pi/settings.command.spec.ts:78`:
- Remove the unused `fns` destructured variable

## Files Affected

| File | Action |
|------|--------|
| `tsconfig.build.json` | Create (new) |
| `package.json` | Edit (build script + dependency move) |
| `src/hexagons/workflow/infrastructure/pi/settings.command.spec.ts` | Edit (remove unused variable) |

## Acceptance Criteria

- [ ] `npm run build` produces dist/ without any `.spec.ts`, `.builder.ts`, or `test-setup` files
- [ ] `npm run typecheck` still type-checks test files (uses base tsconfig)
- [ ] `better-sqlite3` appears in `dependencies`, not `devDependencies`
- [ ] `@types/better-sqlite3` remains in `devDependencies`
- [ ] `npm run lint` produces zero warnings
- [ ] All tests pass (`npm test`)

## Risks

None. All changes are configuration-level with no behavioral impact on the codebase.
