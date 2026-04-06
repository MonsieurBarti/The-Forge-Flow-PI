# Plan: M08-S03 — Package Metadata & Documentation

## Summary

S-tier docs slice: 4 independent tasks => single wave. Add package.json metadata, create LICENSE, README.md, CHANGELOG.md, and flatten docs/superpowers/specs/ to docs/. No TDD (no production code). All tasks are parallelizable (Wave 1).

## Task Table

| # | Title | Files | Deps | Wave |
|---|-------|-------|------|------|
| T01 | Package metadata fields | `package.json` (modify) | — | 1 |
| T02 | MIT LICENSE file | `LICENSE` (create) | — | 1 |
| T03 | README.md | `README.md` (create) | — | 1 |
| T04 | CHANGELOG.md seed | `CHANGELOG.md` (create) | — | 1 |

## Tasks

### T01: Package metadata fields

Add `author`, `license`, `repository`, `homepage` to `package.json`.

**AC refs:** AC1

### T02: MIT LICENSE file

Create standard MIT license at project root. Copyright `Copyright (c) 2026 MonsieurBarti`.

**AC refs:** AC2

### T03: README.md

Create open-source README with all sections from spec. Flatten docs/superpowers/specs/ to docs/ and update links.

**AC refs:** AC3

### T04: CHANGELOG.md seed

Create minimal changelog for release-please.

**AC refs:** AC4
