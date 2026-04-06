# M03-S06: Research Command — Verification

## Test Evidence

- **Full suite:** 639 tests PASS, 0 FAIL
- **Typecheck:** `npx tsc --noEmit` clean
- **Lint:** `npx biome check` clean

## Acceptance Criteria

| AC | Verdict | Evidence |
|---|---|---|
| AC1 | PASS | `research.command.ts`: registers via `api.registerCommand("tff:research", ...)`, dual-resolution (findByLabel then findById), phase validation, SPEC.md read via ArtifactFilePort, sends protocol via `ctx.sendUserMessage`. 9/9 command tests pass. |
| AC2 | PASS | `research.command.ts` line 72-74: returns "not researching, run /tff:discuss first" when phase mismatch. Test asserts exact string. |
| AC3 | PASS | `research.command.ts` lines 65-67: returns "No workflow session found, run /tff:discuss first" when no session. Test asserts exact string. |
| AC4 | PASS | Two branches: `isErr(specResult)` returns "Failed to read SPEC.md", `!specResult.data` returns "No SPEC.md found, run /tff:discuss first". Both tested. |
| AC5 | PASS | `WriteResearchUseCase` writes via `artifactFilePort.write(..., "research", ...)` then calls `slice.setResearchPath(path, now)`. Test verifies file written and researchPath updated. 4/4 tests pass. |
| AC6 | PASS | FileIOError, SliceNotFoundError, and PersistenceError all tested. `PersistenceError` test added during verification — uses failing repo stub. |
| AC7 | PASS | `write-research.tool.ts`: schema uses `IdSchema` for sliceId, `MilestoneLabelSchema` for milestoneLabel, `SliceLabelSchema` for sliceLabel. Invalid UUID test confirms validation. 3/3 tool tests pass. |
| AC8 | PASS | `slice.aggregate.ts`: `setResearchPath(path, now)` sets `props.researchPath` and `props.updatedAt`. `researchPath` getter already existed. Test verifies both properties. 21/21 aggregate tests pass. |
| AC9 | PASS | `research-protocol.ts`: Phase 1 dispatches Explore agent with research questions, Phase 2 synthesizes into RESEARCH.md structure, Phase 3 user gate with max 2 rounds. 8/8 protocol tests pass. |
| AC10 | PASS | Protocol contains all required sections: Questions Investigated, Codebase Findings (Existing Patterns, Relevant Files, Dependencies), Technical Risks, Recommendations for Planning. Tests assert each section. |
| AC11 | PASS | Protocol checks `autonomyMode`: `plan-to-pr` auto-invokes `/tff:plan`, `guided` suggests next step. Both branches tested. |
| AC12 | PASS | `workflow.extension.ts` registers `tff_write_research` tool and `tff:research` command. Extension spec asserts both registrations. 6/6 extension tests pass. |
| AC13 | PASS | `write-spec.tool.ts`: `sliceId` uses `IdSchema.describe("Slice UUID")` — identical to `write-research.tool.ts`. |
| AC14 | PASS | `research.command.ts`: exports `ResearchCommandDeps` interface with `{ sliceRepo, milestoneRepo, sessionRepo, artifactFile }`. Used as typed parameter. |
| AC15 | PASS | `write-research.use-case.ts`: all error paths return `Result<T, E>` via `err()/ok()`. Zero `throw` statements in use case code. |

## Verdict: PASS (15/15)

## Commits

| Commit | Description |
|---|---|
| `e2f1771` | feat(S06/T01): add Slice.setResearchPath() method |
| `88a4a10` | refactor(S06/T02): retrofit tff_write_spec to use IdSchema for sliceId |
| `0b09929` | feat(S06/T03): add WriteResearchUseCase |
| `f154d50` | feat(S06/T04): add research protocol message builder |
| `33acf14` | feat(S06/T05): add tff_write_research tool |
| `22798a5` | feat(S06/T06): add research command handler |
| `3548599` | feat(S06/T07): wire research command and tool into workflow extension |
| `bba1f0d` | test(S06): add PersistenceError and extension registration coverage |
