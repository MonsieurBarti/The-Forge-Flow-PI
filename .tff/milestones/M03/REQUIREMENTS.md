# M08: Release Readiness & GitHub Releases

## Goal

Make TFF-PI releasable — fix packaging/build issues, wire the CLI entry point correctly per PI SDK conventions, set up release-please for automated GitHub releases, and add missing project metadata and documentation.

## Requirements

### R01: Build Hygiene

- Create `tsconfig.build.json` extending `tsconfig.json` that excludes `**/*.spec.ts`, `**/*.builder.ts`, and `src/test-setup.ts`
- Update `"build"` script in package.json to use `tsc -p tsconfig.build.json`
- Move `better-sqlite3` from devDependencies to dependencies (runtime import in `extension.ts:145`)
- `@types/better-sqlite3` stays in devDependencies

**AC:**
- `npm run build` produces dist/ without any spec or test-setup files
- `better-sqlite3` is a production dependency
- Existing `npm run typecheck` still uses base tsconfig (includes tests)
- All tests still pass

### R02: CLI Entry Point Wiring

- Fix `src/cli/main.ts` to correctly bootstrap a PI agent session with TFF extensions
- Extensions must be loaded BEFORE session creation via `DefaultResourceLoader.extensionFactories` (not after)
- Correct pattern (from PI SDK research):
  ```typescript
  const resourceLoader = new DefaultResourceLoader({
    extensionFactories: [(pi) => createTffExtension(pi, { projectRoot: process.cwd() })],
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({ resourceLoader });
  ```
- Add default export wrapper so TFF can also be discovered as a PI extension package:
  ```typescript
  export default function (pi: ExtensionAPI) {
    createTffExtension(pi, { projectRoot: process.cwd() });
  }
  ```
- Verify the extension registers tools, commands, and event handlers correctly with the PI SDK

**AC:**
- `main.ts` is no longer a placeholder — it bootstraps a working PI session
- Extension loads before session start (session_start event received)
- Default export allows PI auto-discovery from `.pi/extensions/`
- TypeScript compiles cleanly

### R03: PI Extension Audit

- Research `https://github.com/badlogic/pi-mono` extension examples and API
- Audit `extension.ts` against PI SDK conventions:
  - Tool registration uses TypeBox schemas (PI requirement) — verify `createZodTool` bridge works correctly
  - No action methods called during factory execution (only registration methods)
  - Event handlers receive correct `ExtensionContext` types
  - Commands use `ExtensionCommandContext` correctly
  - Overlay/TUI components follow PI's `ctx.ui` patterns
- Fix any deviations found

**AC:**
- Extension passes a manual audit against PI SDK patterns
- No action methods called during load phase
- Tool schemas compatible with PI's TypeBox expectation
- All registered event handlers use correct signatures

### R04: Package Metadata & Documentation

- Add to package.json: `license`, `repository`, `homepage`, `author` fields
- Create `LICENSE` file (MIT)
- Create root `README.md`:
  - Project overview (what TFF-PI is)
  - Prerequisites (Node >= 22, PI SDK)
  - Installation / extension setup
  - Architecture overview (hexagonal, 8 bounded contexts)
  - Link to docs/superpowers/specs/ for detailed design
- Seed `CHANGELOG.md` with summary of M01-M07 work (release-please will manage it going forward)

**AC:**
- `package.json` has license, repository, homepage, author
- LICENSE file exists at root
- README.md exists with install instructions and architecture overview
- CHANGELOG.md exists with historical summary

### R05: Release-Please Setup

- Add `.github/workflows/release-please.yml` using `googleapis/release-please-action@v4`
- Configure for `node` release type, targeting `main` branch
- Add `release-please-config.json` with changelog sections, bump strategy
- Add `.release-please-manifest.json` tracking current version (0.1.0)
- Ensure conventional commits are enforced — add `commitlint` with `@commitlint/config-conventional` + lefthook `commit-msg` hook

**AC:**
- Push to main triggers release-please PR creation
- Release-please PR bumps version in package.json and updates CHANGELOG.md
- Merging release-please PR creates a GitHub Release with tag
- Conventional commit format enforced on commit-msg hook
- CI passes with new workflow

### R06: Production Adapter Completeness

- Replace `AlwaysUnderBudgetAdapter` in `extension.ts:829` with a real budget tracking adapter or a configurable one that logs a warning
- Investigate and fix skipped plannotator integration test (`plannotator-review-ui.integration.spec.ts`) — either fix it or add clear skip reason with TODO
- Fix unused `fns` variable in `settings.command.spec.ts:78`

**AC:**
- Budget tracking is not silently bypassed (either real tracking or logged warning)
- No unexplained skipped tests
- Zero lint warnings (`npm run lint` clean)
