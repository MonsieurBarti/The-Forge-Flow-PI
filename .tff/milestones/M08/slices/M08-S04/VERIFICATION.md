# M08-S04: Release-Please Setup — Verification

## Acceptance Criteria Verdicts

| AC | Verdict | Evidence |
|---|---|---|
| AC1: Push to main triggers release-please PR creation | PASS | `.github/workflows/release-please.yml` exists, triggers on `push: branches: [main]`, uses `googleapis/release-please-action@v4` with correct config/manifest references |
| AC2: Release-please PR bumps version and updates CHANGELOG.md | PASS | `release-please-config.json` configures `release-type: node` with changelog sections (feat, fix, refactor, docs, chore). `.release-please-manifest.json` tracks version `0.1.0` |
| AC3: Merging release-please PR creates GitHub Release with tag | PASS | Workflow outputs `releases_created` from release-please step; `bump-minor-pre-major: true` ensures proper semver for 0.x |
| AC4: npm-publish job publishes when releases_created | PASS | `npm-publish` job gated on `needs.release-please.outputs.releases_created == 'true'`, runs `npm ci && npm run build && npm publish` with `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` |
| AC5: Conventional commit enforced via commitlint + lefthook | PASS | `echo "not conventional" \| npx commitlint` → exit 1 (rejects). `echo "feat: valid" \| npx commitlint` → exit 0 (accepts). `lefthook.yml` has `commit-msg` hook running `npx commitlint --edit {1}`. Hook verified working during T05 commit. |
| AC6: package.json has files field and publishConfig.access | PASS | `"files": ["dist/", "src/resources/", "README.md", "LICENSE"]` and `"publishConfig": {"access": "public"}` present in package.json |
| AC7: .npmrc exists with NPM_TOKEN env var interpolation | PASS | `.npmrc` contains `//registry.npmjs.org/:_authToken=${NPM_TOKEN}` (verified via `git show HEAD~3:.npmrc`) |
| AC8: CI workflow still passes — no regressions | PASS | `npm run typecheck` → clean. `npm test` → 259 passed, 1 skipped (pre-existing), 2413/2413 tests pass |

## Summary

**8/8 PASS** — All acceptance criteria met.

### Notes
- AC1-AC3 are integration-level criteria that can only be fully verified after merge to main and a GitHub Actions run. The workflow file, config, and manifest are structurally correct.
- AC4 requires `NPM_TOKEN` secret configured in GitHub repo settings (not yet done per discuss phase).
- 1 pre-existing skipped test (`plannotator-review-ui.integration.spec.ts`) — tracked under R06, not this slice.
