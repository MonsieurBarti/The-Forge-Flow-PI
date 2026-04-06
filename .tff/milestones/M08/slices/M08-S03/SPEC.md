# M08-S03: Package Metadata & Documentation

## Problem

The project has no `LICENSE`, `README.md`, or `CHANGELOG.md`, and `package.json` is missing standard metadata fields (`author`, `license`, `repository`, `homepage`). This blocks open-source publishing and makes the project hard to discover and evaluate for potential consumers.

## Solution

### 1. Add metadata to `package.json`

Add the following fields (no other changes):

```json
"author": "MonsieurBarti",
"license": "MIT",
"repository": {
  "type": "git",
  "url": "https://github.com/MonsieurBarti/The-Forge-Flow-PI.git"
},
"homepage": "https://github.com/MonsieurBarti/The-Forge-Flow-PI#readme"
```

### 2. Create `LICENSE`

Standard MIT license at project root. Copyright line: `Copyright (c) 2026 MonsieurBarti`.

### 3. Create `README.md`

Structured for open-source consumers:

| Section | Content |
|---------|---------|
| Banner | Image from `the-forge-flow-cc` assets |
| Title + overview | One-paragraph description of TFF-PI |
| Prerequisites | Node >= 22, PI coding agent SDK |
| Installation | npm install + extension setup |
| Architecture | Condensed hexagonal layers diagram, 8 bounded contexts table, link to specs |
| Usage | Key TFF commands overview |
| Contributing | Fork/branch workflow, conventional commits, test/lint commands, architecture rules |
| License | MIT with link to LICENSE |

### 4. Create `CHANGELOG.md`

Minimal seed for release-please:

```markdown
# Changelog

## 0.1.0 (unreleased)

Initial development release -- milestones M01 through M07.
```

### 5. Flatten docs directory

Move `docs/superpowers/specs/*` to `docs/` and remove empty `superpowers/` directory.

## Files Affected

| File | Action |
|------|--------|
| `package.json` | Edit (add author, license, repository, homepage) |
| `LICENSE` | Create (MIT) |
| `README.md` | Create (full open-source README) |
| `CHANGELOG.md` | Create (minimal seed) |
| `docs/superpowers/specs/*` | Move to `docs/` |

## Acceptance Criteria

- [ ] `package.json` has `author`, `license`, `repository`, `homepage` fields
- [ ] `LICENSE` file exists at project root with MIT text and correct copyright
- [ ] `README.md` exists with banner, overview, prerequisites, installation, architecture overview, usage, contributing, and license sections
- [ ] `CHANGELOG.md` exists with a `0.1.0` entry
- [ ] No existing tests broken (`npm test` passes)
- [ ] No lint regressions (`npm run lint` clean)

## Risks

None. All changes are documentation and metadata -- no behavioral impact on the codebase.
