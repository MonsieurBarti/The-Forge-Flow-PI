# M08-S06: Standalone CLI Packaging

## Problem

TFF-PI has no standalone CLI entry point. The `src/cli/main.ts` file only re-exports `createTffExtension` and a default export for PI auto-discovery — it doesn't actually bootstrap a PI session. Users cannot run `npx @the-forge-flow/pi` or install a global `tff` command.

## Approach

Follow the gsd-2 pattern: thin loader → heavy bootstrap separation.

- `src/cli/loader.ts` — shebang, fast-path `--version`/`--help`, Node >= 22 check, env var setup, dynamic `import('./main.js')`
- `src/cli/main.ts` — heavy bootstrap: create session services with TFF extension factory, launch `InteractiveMode` or `runPrintMode`
- `package.json` — add `bin` field pointing to `dist/cli/loader.js`

## Design

### 1. Loader (`src/cli/loader.ts`)

Thin entry point (~60 lines). Only Node built-in imports before the dynamic import.

```typescript
#!/usr/bin/env node

// --- Fast-path: --version ---
// Read version from package.json using fs.readFileSync (Node built-in only)
// Print and exit(0) immediately — zero SDK imports

// --- Fast-path: --help ---
// Dynamic import of a lightweight help-text module
// Print usage and exit(0) — zero SDK imports

// --- Node version check ---
// Parse process.versions.node, compare major >= 22
// Print error with nvm/fnm/brew install suggestions, exit(1)
// Use raw ANSI codes (no chalk dependency)

// --- Environment setup ---
// PI_PACKAGE_DIR = resolve(__dirname, '..', '..') — points to project root
//   so PI SDK reads piConfig from our package.json
// Process title: process.title = 'tff'

// --- Heavy bootstrap ---
// await import('./main.js')
```

Key decisions:
- **No CLI framework** (no commander/yargs) — hand-rolled arg parsing for zero dep overhead
- **Raw ANSI codes** for error messages — avoid loading chalk before SDK
- **Block-scoped version check** like gsd-2 to avoid variable leakage

### 2. Help Text (`src/cli/help-text.ts`)

Separate lightweight module (~30 lines) with a single `printHelp(version: string)` export. Contains hardcoded usage text. No SDK imports.

### 3. Main Bootstrap (`src/cli/main.ts` — rewrite)

Replace the current placeholder with actual session bootstrap. Following gsd-2 and PI SDK patterns:

```typescript
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  InteractiveMode,
  runPrintMode,
} from '@mariozechner/pi-coding-agent';
import { createTffExtension } from './extension';

// 1. Parse remaining CLI args (--model, --print, --continue, etc.)
// 2. Create DefaultResourceLoader with extensionFactories
const resourceLoader = new DefaultResourceLoader({
  cwd: process.cwd(),
  extensionFactories: [
    (pi) => createTffExtension(pi, { projectRoot: process.cwd() }),
  ],
});
await resourceLoader.reload();

// 3. Create session
const sessionManager = SessionManager.create(process.cwd());
const { session } = await createAgentSession({
  resourceLoader,
  sessionManager,
});

// 4. Launch appropriate mode
if (isTTY && !printMode) {
  const interactive = new InteractiveMode(session);
  await interactive.run();
} else {
  await runPrintMode(session, { initialMessage, outputMode: 'text' });
}
```

**Extension loading:** Uses `extensionFactories` on `DefaultResourceLoader` — this is the PI SDK-blessed inline pattern. Extensions load during `resourceLoader.reload()`, before session creation. This satisfies the R02 requirement that extensions load BEFORE session creation.

**Default export preserved:** `main.ts` keeps the default export for PI auto-discovery (when TFF is used as a `.pi/extensions/` package rather than standalone).

### 4. Package.json Changes

```json
{
  "bin": {
    "tff": "dist/cli/loader.js"
  }
}
```

Build script update — add `chmod +x` to build pipeline (belt-and-suspenders; npm handles this on install, but ensures `node dist/cli/loader.js` works during development):

```json
{
  "build": "tsc -p tsconfig.build.json && npm run copy-resources && chmod +x dist/cli/loader.js"
}
```

### 5. `piConfig` Branding

Add `piConfig` to `package.json` so PI SDK reads our branding:

```json
{
  "piConfig": {
    "name": "tff",
    "configDir": ".tff"
  }
}
```

This tells PI SDK to:
- Use `~/.tff/agent/` as the agent directory
- Display "tff" in the TUI header
- Store settings in `.tff/` (aligns with our existing `.tff/` directory)

**Note:** `configDir: ".tff"` will conflict with our existing `.tff/` state directory. The PI SDK stores auth, settings, sessions, and extensions under `~/.tff/agent/`, which is distinct from the project-local `.tff/` directory. No conflict — PI uses `$HOME/.tff/agent/` while TFF state lives in `$PROJECT/.tff/`.

### 6. Testing Strategy

**Unit tests for loader fast-paths** (`src/cli/loader.spec.ts`):
- `--version` prints version and exits
- `--help` prints usage and exits
- Node < 22 prints error and exits

**Unit test for help text** (`src/cli/help-text.spec.ts`):
- `printHelp()` writes to stdout

**Integration verification** (manual, documented in VERIFICATION.md):
- `npm pack` produces installable tarball
- `npx @the-forge-flow/pi --version` prints version
- `npx @the-forge-flow/pi --help` prints usage
- Global install creates working `tff` command

**Note on loader testing:** The loader uses `process.exit()` and `process.stdout.write()` directly. Tests will use `vi.spyOn(process, 'exit')` and `vi.spyOn(process.stdout, 'write')`. The dynamic import of `./main.js` will be mocked to avoid heavy SDK loading in unit tests.

## Acceptance Criteria

- [ ] **AC1:** `npx @the-forge-flow/pi` launches a PI session with TFF extensions loaded
- [ ] **AC2:** `--version` prints version without loading PI SDK
- [ ] **AC3:** `--help` prints usage without loading PI SDK
- [ ] **AC4:** Package installs globally and `tff` command works
- [ ] **AC5:** Node < 22 shows clear error message
- [ ] **AC6:** All existing tests pass — `npm run test` green
- [ ] **AC7:** `npm run build` succeeds and `dist/cli/loader.js` has shebang

## Non-Goals

- npm publish automation (handled by release-please in M08-S04)
- PI SDK auth/onboarding flow (handled by PI SDK itself)
- Proxy setup (PI SDK handles this internally)
- Subcommand routing beyond `--version`/`--help` (future work)
- Extension discovery from `.pi/extensions/` (PI SDK handles this via `DefaultResourceLoader`)
- Workspace package linking (not a monorepo like gsd-2)
- `pkg/` branding shim directory (unnecessary — we use `piConfig` in our own `package.json`)

## Files Affected

| Action | File |
|--------|------|
| Create | `src/cli/loader.ts` |
| Create | `src/cli/help-text.ts` |
| Create | `src/cli/loader.spec.ts` |
| Create | `src/cli/help-text.spec.ts` |
| Rewrite | `src/cli/main.ts` |
| Edit | `package.json` (add `bin`, `piConfig`, update `build` script) |

## Research References

### PI SDK Bootstrap API (`@mariozechner/pi-coding-agent`)
- `createAgentSession(options)` — accepts `resourceLoader`, `sessionManager`, `model`, `tools`, `customTools`
- `DefaultResourceLoader` — accepts `extensionFactories: ExtensionFactory[]` for inline extension loading
- `resourceLoader.reload()` — loads extensions, skills, prompts, themes
- `InteractiveMode` — TUI-based interactive session
- `runPrintMode` — non-interactive mode for piped input
- `SessionManager.create(cwd)` — creates new session in project
- Extensions load during `reload()`, BEFORE session creation

### gsd-2 Loader Pattern
- `src/loader.ts` → `dist/loader.js` — thin entry with shebang
- Fast-path `--version` reads `package.json` with `fs.readFileSync` (zero heavy imports)
- Fast-path `--help` uses dynamic `import('./help-text.js')`
- Node check uses raw ANSI codes in block scope
- Environment variables bridge loader → heavy bootstrap
- `await import('./cli.js')` as last line
- `tsc` preserves shebangs — no special build step needed
- npm handles `chmod +x` on install via bin symlinks

### PI SDK Config (`piConfig`)
- `package.json` `piConfig.name` → app name in TUI
- `package.json` `piConfig.configDir` → `~/.<configDir>/agent/` for settings/auth/sessions
- `PI_PACKAGE_DIR` env var overrides which `package.json` the SDK reads for `piConfig`
