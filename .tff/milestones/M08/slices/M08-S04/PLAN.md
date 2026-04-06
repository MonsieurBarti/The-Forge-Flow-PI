# M08-S04: Release-Please Setup — Implementation Plan

> For agentic workers: execute task-by-task. Config-only slice — no TDD (no source code).

**Goal:** Automate release lifecycle with release-please, enforce conventional commits, configure npm publishing.
**Tech Stack:** GitHub Actions, release-please v4, commitlint, lefthook, npm
**Tier:** F-lite

## File Structure

### Create
| File | Responsibility |
|---|---|
| `.github/workflows/release-please.yml` | Two-job workflow: release-please PR + npm publish |
| `release-please-config.json` | Package config (release type, changelog sections) |
| `.release-please-manifest.json` | Version tracking (starts at 0.1.0) |
| `commitlint.config.mjs` | Conventional commit rules |
| `.npmrc` | npm registry auth token interpolation |

### Modify
| File | Change |
|---|---|
| `package.json` | Add `files`, `publishConfig`, commitlint devDeps |
| `lefthook.yml` | Add `commit-msg` hook for commitlint |

---

## Wave 0 (parallel — no dependencies)

### T01: Create release-please config files
**Files:**
- Create: `release-please-config.json`
- Create: `.release-please-manifest.json`
**Traces to:** AC1, AC2, AC3

**Steps:**
- [ ] Create `release-please-config.json` with content:
```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
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
  }
}
```
- [ ] Create `.release-please-manifest.json` with content:
```json
{
  ".": "0.1.0"
}
```
- [ ] Commit: `chore(S04/T01): add release-please config and manifest`

---

### T02: Create commitlint config
**Files:**
- Create: `commitlint.config.mjs`
**Traces to:** AC5

**Steps:**
- [ ] Create `commitlint.config.mjs` with content:
```javascript
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'refactor', 'test', 'docs', 'chore', 'revert'],
    ],
  },
};
```
- [ ] Commit: `chore(S04/T02): add commitlint conventional config`

---

### T03: Create .npmrc
**Files:**
- Create: `.npmrc`
**Traces to:** AC7

**Steps:**
- [ ] Create `.npmrc` with content:
```
//registry.npmjs.org/:_authToken=${NPM_TOKEN}
```
- [ ] Commit: `chore(S04/T03): add .npmrc for CI npm publishing`

---

## Wave 1 (depends on Wave 0)

### T04: Update package.json — add files, publishConfig, commitlint deps
**Files:**
- Modify: `package.json`
**Depends on:** T02 (commitlint config must exist before deps make sense)
**Traces to:** AC5, AC6

**Steps:**
- [ ] Run: `npm install --save-dev @commitlint/cli @commitlint/config-conventional`
- [ ] Add to `package.json`:
```json
"files": [
  "dist/",
  "src/resources/",
  "README.md",
  "LICENSE"
],
"publishConfig": {
  "access": "public"
}
```
- [ ] Run: `npm run lint` — verify PASS (no regressions)
- [ ] Run: `npm run typecheck` — verify PASS
- [ ] Run: `npm test` — verify PASS (no dep regressions)
- [ ] Commit: `chore(S04/T04): add files, publishConfig, commitlint deps`

---

### T05: Update lefthook.yml — add commit-msg hook
**Files:**
- Modify: `lefthook.yml`
**Depends on:** T02, T04 (commitlint config + deps must exist)
**Traces to:** AC5

**Steps:**
- [ ] Add `commit-msg` section to `lefthook.yml`:
```yaml
commit-msg:
  commands:
    commitlint:
      run: npx commitlint --edit {1}
```
- [ ] Run: `npx lefthook install` — reinstall hooks to pick up new config
- [ ] Verify commitlint rejects bad messages: `echo "bad message" | npx commitlint` — expect exit code 1
- [ ] Verify commitlint accepts good messages: `echo "feat: valid message" | npx commitlint` — expect exit code 0
- [ ] Commit: `chore(S04/T05): add commit-msg hook for commitlint`

---

## Wave 2 (depends on Wave 1)

### T06: Create release-please GitHub Actions workflow
**Files:**
- Create: `.github/workflows/release-please.yml`
**Depends on:** T01, T03, T04 (config, .npmrc, and package.json must be ready)
**Traces to:** AC1, AC2, AC3, AC4, AC8

**Steps:**
- [ ] Create `.github/workflows/release-please.yml` with content:
```yaml
name: Release

on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    outputs:
      releases_created: ${{ steps.release.outputs.releases_created }}
    steps:
      - uses: googleapis/release-please-action@v4
        id: release
        with:
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json

  npm-publish:
    needs: release-please
    if: ${{ needs.release-please.outputs.releases_created == 'true' }}
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: https://registry.npmjs.org

      - run: npm ci
      - run: npm run build
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```
- [ ] Verify: `cat .github/workflows/release-please.yml` — valid YAML
- [ ] Run: `npm run lint` — verify PASS (no regressions)
- [ ] Run: `npm test` — verify PASS (no regressions)
- [ ] Commit: `feat(S04/T06): add release-please workflow with npm publish`

---

## Verification (post-execution)

- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] All 5 new files exist with correct content
- [ ] `lefthook.yml` has commit-msg section
- [ ] `package.json` has `files`, `publishConfig`, commitlint devDeps
- [ ] Test commitlint hook: bad commit message is rejected
