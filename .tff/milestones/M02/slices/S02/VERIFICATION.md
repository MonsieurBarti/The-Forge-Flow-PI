# M02-S02: Wave Detection — Verification

## Test Evidence

- `npx vitest run src/hexagons/task/` -> **64 pass, 0 fail**
- `npx tsc --noEmit` -> **clean**
- `biome check` (6 files) -> **clean, no fixes applied**

## Acceptance Criteria

| AC | Verdict | Evidence |
|---|---|---|
| AC1: Empty input returns `ok([])` | PASS | Test `detect-waves.use-case.spec.ts:14-22` asserts `isOk(result)` and `result.data` equals `[]`. Implementation has explicit early return `ok([])`. |
| AC2: All independent tasks land in wave 0 with sorted taskIds | PASS | Test sends `["ccc","aaa","bbb"]`, asserts `result.data[0].taskIds` equals `["aaa","bbb","ccc"]`. Implementation sorts via `.sort()`. |
| AC3: Sequential A->B->C produces waves 0, 1, 2 | PASS | Test asserts `[{index:0,taskIds:["A"]},{index:1,taskIds:["B"]},{index:2,taskIds:["C"]}]`. Kahn's algorithm produces contiguous waves by construction. |
| AC4: Diamond produces `[{0,[A]},{1,[B,C]},{2,[D]}]` | PASS | Test constructs diamond A->B,C->D and asserts exact wave structure with B and C sharing wave 1. |
| AC5: Cyclic input returns `err(CyclicDependencyError)` with valid `cyclePath` | PASS | Two tests: (1) A->B->C->A cycle, (2) self-reference A->A. Both assert `isErr`, `instanceof CyclicDependencyError`, `cyclePath.length >= 2`. |
| AC6: Deterministic — same input in any order produces identical output | PASS | Test runs two orderings of same tasks, asserts deep equality. Implementation sorts taskIds per wave and sorts nextQueue. |
| AC7: Unknown IDs in `blockedBy` are ignored | PASS | Test gives `A` blockedBy `["nonexistent"]`, asserts both A and B land in wave 0. Implementation filters to known IDs only. |
| AC8: `WaveDetectionPort` exported via barrel | PASS | `grep` confirms `export { WaveDetectionPort }` in `index.ts` line 7. |
| AC9: Schemas accept valid data and reject invalid data | PASS | 6 schema tests: accepts valid input, defaults blockedBy, rejects malformed id, accepts valid wave, rejects negative index, rejects empty taskIds. |
| AC10: `DetectWavesUseCase` NOT exported from barrel | PASS | `grep "DetectWavesUseCase" index.ts` returns 0 matches. |
| AC11: All tests pass | PASS | `npx vitest run src/hexagons/task/` -> 64 pass, 0 fail. |
| AC12: `biome check` passes on all new files | PASS | `biome check` on 6 files: clean, no violations. |

## Verdict

**PASS** — 12/12 acceptance criteria met with evidence.
