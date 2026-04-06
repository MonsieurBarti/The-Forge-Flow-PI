# M08-S04: Release-Please Setup

## Problem

TFF-PI has no automated release pipeline. Version bumps, changelog generation, GitHub Releases, and npm publishing are all manual. This blocks repeatable, trustworthy releases.

## Approach

Use `googleapis/release-please-action@v4` with config files to automate the full release lifecycle: conventional commit analysis, version bumping, changelog generation, GitHub Release creation, and npm publish. Add commitlint to enforce conventional commit format locally via lefthook.

## Design

### 1. Release-Please Workflow (`.github/workflows/release-please.yml`)

Two-job workflow triggered on push to `main`:

**Job 1 — `release-please`:**
- Uses `googleapis/release-please-action@v4`
- Reads config from `release-please-config.json` and `.release-please-manifest.json`
- Outputs: `releases_created`, `tag_name`

**Job 2 — `npm-publish`:**
- Runs only when `releases_created == 'true'`
- Steps: checkout, setup-node (22), `npm ci`, `npm run build`, `npm publish`
- Uses `NPM_TOKEN` from GitHub secrets
- Registry URL: `https://registry.npmjs.org`

### 2. Release-Please Config (`release-please-config.json`)

```json
{
  "packages": {
    ".": {
      "release-type": "node",
      "changelog-sections": [
        { "type": "feat", "section": "Features" },
        { "type": "fix", "section": "Bug Fixes" },
        { "type": "refactor", "section": "Refactoring" },
        { "type": "docs", "section": "Documentation" },
        { "type": "chore", "section": "Miscellaneous" }
      ],
      "bump-minor-pre-major": true,
      "bump-patch-for-minor-pre-major": true
    }
  },
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json"
}
```

### 3. Release-Please Manifest (`.release-please-manifest.json`)

```json
{
  ".": "0.1.0"
}
```

Tracks current version. Release-please updates this on each release.

### 4. Commitlint

**Dependencies (devDependencies):**
- `@commitlint/cli`
- `@commitlint/config-conventional`

**Config (`commitlint.config.mjs`):**
- Extends `@commitlint/config-conventional`
- Type enum: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `revert`
- Note: `.mjs` extension — commitlint does not natively load `.ts` configs without a loader

### 5. Lefthook commit-msg Hook

Add to `lefthook.yml`:

```yaml
commit-msg:
  commands:
    commitlint:
      run: npx commitlint --edit {1}
```

Existing pre-commit and pre-push hooks unchanged.

### 6. Package.json Changes

Add `files` field and `publishConfig`:

```json
"files": ["dist/", "src/resources/", "README.md", "LICENSE"],
"publishConfig": { "access": "public" }
```

- `publishConfig.access: "public"` required for scoped packages — without it, `npm publish` fails with 402/403
- S06 (Standalone CLI Packaging) may extend the `files` list later (e.g., add `bin` entry point). This slice sets the initial list.

### 7. .npmrc

```
//registry.npmjs.org/:_authToken=${NPM_TOKEN}
```

Env var interpolation — no secrets committed. NPM_TOKEN must be configured as a GitHub repo secret before publish will work.

## Non-Goals

- Monorepo / workspace release-please config (single package)
- GitHub Packages publishing (npm registry only)
- Automated changelog backfill for M01-M07 (handled separately in S03)
- npm provenance attestations (can be added later)
- Package entry points (`main`, `exports`, `types`) — handled in S06 (Standalone CLI Packaging)

## Dependencies

- S03 (Package Metadata & Documentation) must be completed first — LICENSE and README.md must exist for `files` field to be meaningful
- Note: S03 was reverted on main (commit `18358631`). This slice should work regardless — `files` field simply lists what to include; missing files won't break the build.

## Acceptance Criteria

1. Push to `main` triggers release-please PR creation via GitHub Actions
2. Release-please PR bumps version in `package.json` and updates `CHANGELOG.md`
3. Merging a release-please PR creates a GitHub Release with a version tag
4. Release-please workflow's npm-publish job publishes `@the-forge-flow/pi` when `releases_created` (requires NPM_TOKEN secret)
5. Conventional commit format enforced on `commit-msg` hook via commitlint + lefthook
6. `package.json` has `files` field listing shipped artifacts and `publishConfig.access` set to `"public"`
7. `.npmrc` exists with `NPM_TOKEN` env var interpolation for CI
8. CI workflow (`ci.yml`) still passes — no regressions
