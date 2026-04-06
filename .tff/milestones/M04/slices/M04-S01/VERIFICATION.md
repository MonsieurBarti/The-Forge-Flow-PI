# M04-S01: Checkpoint Entity + Repository -- Verification Report

**Date:** 2026-03-30
**Slice:** M04-S01
**Status:** verifying
**Branch:** slice/M04-S01

## Fresh Verification Evidence

| Check | Result |
|-------|--------|
| Tests | 57 PASS, 0 FAIL |
| Typecheck (`tsc --noEmit`) | Clean |
| Lint (`biome check`) | Clean (1 info-level suggestion) |

## Acceptance Criteria Verdicts

| AC | Criterion | Verdict | Evidence |
|----|-----------|---------|----------|
| AC1 | `createNew()` produces valid aggregate with wave 0, empty completedTasks/completedWaves | **PASS** | Test: `"creates checkpoint with wave 0, empty completedTasks/completedWaves (AC1)"` in `checkpoint.aggregate.spec.ts`. Asserts `currentWaveIndex === 0`, `completedWaves === []`, `completedTasks === []`. |
| AC2 | `recordTaskStart()` idempotent; different agentIdentity overwrites | **PASS** | Tests: `"is idempotent -- second call for same taskId is no-op (AC2)"` and `"overwrites agentIdentity when called with different identity (AC2)"` in `checkpoint.aggregate.spec.ts`. |
| AC3 | `recordTaskComplete()` fails with `InvalidCheckpointStateError` if task not started | **PASS** | Test: `"fails with InvalidCheckpointStateError if task not started (AC3)"` in `checkpoint.aggregate.spec.ts`. Asserts `isErr(result)` and `result.error.code === "CHECKPOINT.INVALID_STATE"`. |
| AC4 | `advanceWave()` increments currentWaveIndex, appends to completedWaves, guards duplicate | **PASS** | Tests: `"increments currentWaveIndex and appends previous to completedWaves (AC4)"` and `"guards against duplicate advance (AC4)"` in `checkpoint.aggregate.spec.ts`. |
| AC5 | `isTaskCompleted()` / `isWaveCompleted()` / `isTaskStarted()` return correct state | **PASS** | Tests: `"isTaskCompleted returns correct state (AC5)"`, `"isWaveCompleted returns correct state (AC5)"`, `"isTaskStarted returns correct state (AC5)"` in `checkpoint.aggregate.spec.ts`. |
| AC6 | `save()` after `recordTaskComplete()` produces CHECKPOINT.md with task in completedTasks | **PASS** | Contract test: `"save after recordTaskComplete persists completedTasks (AC6)"` in `checkpoint-repository.contract.spec.ts`. Passes for both InMemory and Markdown adapters. |
| AC7 | `save()` after `advanceWave()` produces CHECKPOINT.md with wave in completedWaves | **PASS** | Contract test: `"save after advanceWave persists completedWaves (AC7)"` in `checkpoint-repository.contract.spec.ts`. Passes for both adapters. |
| AC8 | CHECKPOINT.md roundtrip -- write and read back identical CheckpointProps including non-empty executorLog | **PASS** | Contract test: `"save with non-empty executorLog -- roundtrip preserves entries"` + `"JSON in HTML comment recoverable via single JSON.parse (AC9)"` in markdown spec. |
| AC9 | CHECKPOINT.md JSON recoverable from HTML comment via single `JSON.parse` | **PASS** | Test: `"JSON in HTML comment recoverable via single JSON.parse (AC9)"` in `markdown-checkpoint.repository.spec.ts`. Implementation uses exactly one `JSON.parse(jsonMatch[1])` after regex extraction. |
| AC10 | Contract tests pass for both InMemory and Markdown adapters | **PASS** | `runContractTests()` invoked in both `in-memory-checkpoint.repository.spec.ts` and `markdown-checkpoint.repository.spec.ts`. All 21 repository tests pass. |
| AC11 | `CheckpointSavedEvent` emitted on `recordTaskComplete()` and `advanceWave()` | **PASS** | Tests: `"emits CheckpointSavedEvent (AC11)"` under both `recordTaskComplete` and `advanceWave` in `checkpoint.aggregate.spec.ts`. Both assert `events[0].eventName === EVENT_NAMES.CHECKPOINT_SAVED`. |
| AC12 | Builder produces valid Checkpoint instances with sensible faker defaults | **PASS** | `CheckpointBuilder` uses `faker.string.uuid()` for id/sliceId, `faker.git.commitSha({length: 7})` for baseCommit, `faker.date.recent()` for now. Exercised in all contract tests (`new CheckpointBuilder().build()` succeeds without arguments). |
| AC13 | `CHECKPOINT_SAVED` added to kernel `EVENT_NAMES` and `EventNameSchema`; spec updated | **PASS** | `event-names.ts`: `CHECKPOINT_SAVED: "execution.checkpoint-saved"` added to object and enum. `event-names.spec.ts`: count updated from 13 to 14. All 7 event-names tests pass. |
| AC14 | All business methods update `updatedAt` timestamp | **PASS** | Tests: `"updates updatedAt (AC14)"` under `recordTaskStart`, `recordTaskComplete`, and `advanceWave` in `checkpoint.aggregate.spec.ts`. Source confirms `this.props.updatedAt = now` in all three methods. |

## Summary

**14/14 PASS -- 0 FAIL**

All acceptance criteria are fully met with evidence from fresh test runs. No deviations from the spec were found.

### Implementation Artifacts

| Artifact | Files |
|----------|-------|
| Domain schemas | `checkpoint.schemas.ts`, `checkpoint.schemas.spec.ts` |
| Aggregate | `checkpoint.aggregate.ts`, `checkpoint.aggregate.spec.ts` |
| Builder | `checkpoint.builder.ts` |
| Errors | `checkpoint-not-found.error.ts`, `invalid-checkpoint-state.error.ts` |
| Events | `checkpoint-saved.event.ts` |
| Port | `checkpoint-repository.port.ts` |
| InMemory adapter | `in-memory-checkpoint.repository.ts`, `in-memory-checkpoint.repository.spec.ts` |
| Markdown adapter | `markdown-checkpoint.repository.ts`, `markdown-checkpoint.repository.spec.ts` |
| Contract tests | `checkpoint-repository.contract.spec.ts` |
| Barrel | `index.ts` |
| Kernel change | `event-names.ts`, `event-names.spec.ts` (CHECKPOINT_SAVED added) |
