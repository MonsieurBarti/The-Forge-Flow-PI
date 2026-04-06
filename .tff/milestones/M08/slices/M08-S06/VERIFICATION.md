# Verification — M08-S06: Standalone CLI Packaging

## Acceptance Criteria Verdicts

| AC | Criterion | Verdict | Evidence |
|----|-----------|---------|----------|
| AC1 | `npx @the-forge-flow/pi` launches PI session with TFF extensions | **PASS** | `loader.js:28` calls `main(["--extension", extensionPath, ...])` — delegates to PI SDK's `main()` with `--extension` pointing to `dist/cli/main.js` which has TFF extension default export. PI SDK discovers and loads it via `jiti`. |
| AC2 | `--version` prints version without loading PI SDK | **PASS** | `node dist/cli/loader.js --version` outputs `0.1.0` and exits. Lines 10-13 of compiled loader: checks `firstArg`, writes version from `getVersion()` (reads package.json with `fs.readFileSync`), calls `process.exit(0)`. No `@mariozechner/pi-coding-agent` import reached. |
| AC3 | `--help` prints usage without loading PI SDK | **PASS** | `node dist/cli/loader.js --help` outputs full usage text (15 lines). Lines 15-18: dynamically imports only `./help-text.js` (no SDK deps), calls `printHelp(version)`, exits. SDK import on line 27 never reached. |
| AC4 | Package installs globally and `tff` command works | **PASS** | `package.json` has `"bin": { "tff": "dist/cli/loader.js" }`. `npm pack --dry-run` confirms `dist/cli/loader.js` is in the tarball. npm creates the `tff` symlink on global install pointing to `loader.js` which has `#!/usr/bin/env node` shebang. |
| AC5 | Node < 22 shows clear error message | **PASS** | `checkNodeVersion(999)` test verifies: calls `process.exit(1)`, stderr contains `"Node.js >= 999"` and `"nvm install"`. Implementation at `loader-utils.ts:13-29` uses raw ANSI codes for colored output with install suggestions for nvm/fnm/brew. |
| AC6 | All existing tests pass | **PASS** | `npx vitest run` — 2427 tests pass, 0 failures. New tests (10) included: `getVersion` (4), `checkNodeVersion` (2), `printHelp` (4). |
| AC7 | `npm run build` succeeds and `dist/cli/loader.js` has shebang | **PASS** | Build succeeds. `dist/cli/loader.js` line 1: `#!/usr/bin/env node`. File is executable (`chmod +x` in build script). `tsc` preserves shebangs natively. |

## Additional Verifications

| Check | Result |
|-------|--------|
| `npm run lint` | Clean (0 errors, 0 warnings) |
| `npm run typecheck` | Clean |
| Lefthook pre-commit | Passed (lint + typecheck) |
| Lefthook commit-msg | Passed (commitlint) |
| `-v` short flag | Works — outputs `0.1.0` |
| `-h` short flag | Works — outputs full help text |
| `piConfig` branding | Present: `{ "name": "tff", "configDir": ".tff" }` |
| `PI_PACKAGE_DIR` env | Set to package root before SDK import |

## Final Verdict

**ALL 7 ACCEPTANCE CRITERIA PASS.** Slice is verified and ready for ship.
