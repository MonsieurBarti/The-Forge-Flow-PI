# M01-S01 Plan: Project scaffolding, Biome & Vitest

## Wave 0 (parallel — no dependencies)

### T01: Create package.json

- **File**: `package.json`
- **Code**:
```json
{
  "name": "@the-forge-flow/pi",
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsc",
    "lint": "biome check .",
    "lint:fix": "biome check --fix .",
    "format": "biome format --fix .",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4.0",
    "@faker-js/faker": "^9.0.0",
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
    "better-sqlite3": "^11.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```
- **Run**: `cat package.json | head -5`
- **Expect**: Shows package name and version
- **AC**: AC1 (foundation for all other config)

### T02: Update .gitignore

- **File**: `.gitignore`
- **Code**:
```gitignore
node_modules/
dist/
coverage/
*.tsbuildinfo

# Beads / Dolt files (added by bd init)
.dolt/
*.db
.beads-credential-key
```
- **Run**: `cat .gitignore`
- **Expect**: Contains node_modules, dist, coverage entries
- **AC**: AC1

### T03: Create directory structure with .gitkeep files

- **Files**:
  - `src/kernel/.gitkeep`
  - `src/hexagons/.gitkeep`
  - `src/infrastructure/.gitkeep`
  - `src/cli/.gitkeep`
- **Run**: `find src -type f | sort`
- **Expect**:
```
src/cli/.gitkeep
src/hexagons/.gitkeep
src/infrastructure/.gitkeep
src/kernel/.gitkeep
```
- **AC**: AC1

## Wave 1 (depends on Wave 0 — needs package.json)

### T04: Install dependencies

- **Run**: `npm install`
- **Expect**: `added X packages` — no errors, node_modules created
- **AC**: AC1

## Wave 2 (parallel — depends on Wave 1, needs node_modules)

### T05: Create tsconfig.json

- **File**: `tsconfig.json`
- **Code**:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "paths": {
      "@kernel/*": ["./src/kernel/*"],
      "@hexagons/*": ["./src/hexagons/*"],
      "@infrastructure/*": ["./src/infrastructure/*"]
    }
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```
- **Run**: `npx tsc --noEmit`
- **Expect**: No errors (empty project compiles)
- **AC**: AC4

### T06: Create biome.json

- **File**: `biome.json`
- **Code**:
```json
{
  "$schema": "https://biomejs.dev/schemas/latest/schema.json",
  "organizeImports": {
    "enabled": true
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": {
        "noRestrictedImports": {
          "level": "error",
          "options": {
            "patterns": [
              {
                "group": [
                  "@hexagons/project/*",
                  "@hexagons/milestone/*",
                  "@hexagons/slice/*",
                  "@hexagons/task/*",
                  "@hexagons/execution/*",
                  "@hexagons/review/*",
                  "@hexagons/intelligence/*",
                  "@hexagons/settings/*",
                  "@hexagons/workflow/*"
                ],
                "message": "Import from the hexagon barrel (@hexagons/<name>) instead of its internals."
              }
            ]
          }
        }
      }
    }
  },
  "files": {
    "ignore": ["node_modules", "dist", "coverage", ".tff", ".beads"]
  }
}
```
- **Run**: `npx biome check .`
- **Expect**: No errors (or "No files to check" — empty src)
- **AC**: AC1, AC3

### T07: Create vitest.config.ts

- **File**: `vitest.config.ts`
- **Code**:
```typescript
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@kernel": resolve(import.meta.dirname, "src/kernel"),
      "@hexagons": resolve(import.meta.dirname, "src/hexagons"),
      "@infrastructure": resolve(import.meta.dirname, "src/infrastructure"),
    },
  },
  test: {
    include: ["src/**/*.spec.ts"],
    globals: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.spec.ts", "src/**/*.builder.ts"],
    },
  },
});
```
- **Run**: `npx vitest run`
- **Expect**: `No test files found` or exits 0 with 0 tests — no crash
- **AC**: AC2, AC4

## Wave 3 (depends on Wave 2 — full verification)

### T08: Verify all acceptance criteria

- **Run**:
```bash
npx biome check . && npx vitest run && npx tsc --noEmit
```
- **Expect**: All three commands pass without errors
- **AC**: AC1, AC2, AC3, AC4

### T09: Commit scaffolding

- **Run**:
```bash
git add package.json package-lock.json tsconfig.json biome.json vitest.config.ts .gitignore src/
git commit -m "feat(m01-s01): project scaffolding with Biome, Vitest, and path aliases"
```
- **Expect**: Clean commit on milestone/M01 branch
- **AC**: All

## AC Traceability

| AC | Tasks |
|----|-------|
| AC1: `biome check` passes | T01, T02, T03, T06, T08 |
| AC2: `vitest run` executes | T07, T08 |
| AC3: Hexagon import boundaries configured | T06 |
| AC4: Path aliases resolve in TS + Vitest | T05, T07, T08 |
