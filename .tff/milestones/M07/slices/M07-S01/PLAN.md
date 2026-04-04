# M07-S01: Infrastructure Reorg + State Branch Ops Spike — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Reorganize crowded infrastructure directories into port/adapter-paired subfolders, then validate state branch operations via a new `StateBranchOpsPort` with full round-trip testing.

**Architecture:** New `StateBranchOpsPort` in kernel (separate from `GitPort`). Implementation in `kernel/infrastructure/state-branch/`. JSON-based entity-ID merge utility.

**Tech Stack:** TypeScript, Vitest, Git CLI (execFile), Zod

## File Structure

### Part A — Moves (no new files)

```
src/hexagons/execution/infrastructure/
  repositories/
    checkpoint/    ← markdown-checkpoint.*, in-memory-checkpoint.*, contract
    journal/       ← jsonl-journal.*, in-memory-journal.*, contract
    metrics/       ← jsonl-metrics.*, in-memory-metrics.*, contract
  adapters/
    execution-session/  ← markdown-execution-session.*, in-memory-execution-session.*
    agent-dispatch/     ← pi-agent-dispatch.*, in-memory-agent-dispatch.*, contract
    worktree/           ← git-worktree.*, in-memory-worktree.*, contract
    overseer/           ← composable-overseer.*, in-memory-overseer.*
    guardrails/         ← composable-guardrail.*, in-memory-guardrail.*, rules/ (keep)
    pause-signal/       ← process-signal-pause.*, in-memory-pause-signal.*
  policies/             ← default-retry-policy.*, timeout-strategy.*
  pi/                   ← (keep existing)

src/hexagons/review/infrastructure/
  repositories/
    review/             ← sqlite-review.*, in-memory-review.*
    ship-record/        ← sqlite-ship-record.*, in-memory-ship-record.*
    completion-record/  ← sqlite-completion-record.*, in-memory-completion-record.*
    verification/       ← sqlite-verification.*, in-memory-verification.*
  adapters/
    review-ui/          ← terminal-*, plannotator-*, in-memory-*, contract, integration
    slice-spec/         ← bead-slice-spec.*
    executor-query/     ← cached-executor-query.*
    changed-files/      ← git-changed-files.*
    audit/              ← pi-audit.*
    fixer/              ← pi-fixer.*, stub-fixer.*
    merge-gate/         ← pi-merge-gate.*
    milestone/          ← milestone-query.*, milestone-transition.*

src/kernel/agents/
  schemas/     ← agent-card.*, agent-dispatch.schema.*, agent-event.*, agent-result.schema.*, agent-status.schema.*, turn-metrics.*
  builders/    ← agent-dispatch.builder.*, agent-result.builder.*
  errors/      ← agent-errors.*, agent-dispatch.error.*, agent-status-parse.error.*
  services/    ← agent-status-parser.*, agent-status-cross-checker.*, agent-status-prompt.*, agent-registry.*, agent-resource-loader.*, agent-validation.*, agent-template.*
  ports/       ← agent-dispatch.port.ts
  prompts/     ← guardrail-prompt.ts
  __tests__/   ← agent-boundary.spec.ts

src/hexagons/review/domain/
  aggregates/  ← review.aggregate.*, ship-record.aggregate.*, completion-record.aggregate.*, verification.aggregate.*
  schemas/     ← completion.*, conduct-review.*, critique-reflection.schemas.*, merged-review.schemas.*, review.schemas.*, review-ui.*, ship.*, verification.*
  builders/    ← review.builder.*, critique-reflection.builder.*, finding.builder.*, builders.spec.*
  value-objects/ ← merged-review.vo.*
  strategies/  ← review-strategy.*
  (existing: ports/, errors/, events/, services/)
```

### Part B — New Files

```
src/kernel/ports/state-branch-ops.port.ts                                       ← Port interface
src/kernel/infrastructure/state-branch/git-state-branch-ops.adapter.ts          ← Git CLI implementation
src/kernel/infrastructure/state-branch/git-state-branch-ops.adapter.spec.ts     ← Unit tests
src/kernel/infrastructure/state-branch/git-state-branch-ops.integration.spec.ts ← Integration tests
src/kernel/infrastructure/state-branch/json-snapshot-merger.ts                  ← Entity-ID merge utility
src/kernel/infrastructure/state-branch/json-snapshot-merger.spec.ts             ← Merge tests
```

---

### Task 1: Reorganize kernel/agents/ (39 files)
**Files:** Move files within `src/kernel/agents/` into subfolders
**Traces to:** AC1, AC2

- [ ] Step 1: Create subdirectories: `schemas/`, `builders/`, `errors/`, `services/`, `ports/`, `prompts/`, `__tests__/`
- [ ] Step 2: Move schema files (12): `agent-card.schema.*`, `agent-dispatch.schema.*`, `agent-event.schema.*`, `agent-result.schema.*`, `agent-status.schema.*`, `turn-metrics.schema.*` → `schemas/`
- [ ] Step 3: Move builder files (4): `agent-dispatch.builder.*`, `agent-result.builder.*` → `builders/`
- [ ] Step 4: Move error files (4): `agent-errors.*`, `agent-dispatch.error.*`, `agent-status-parse.error.*` → `errors/`
- [ ] Step 5: Move service files (10): `agent-status-parser.*`, `agent-status-cross-checker.*`, `agent-status-prompt.*`, `agent-registry.*`, `agent-resource-loader.*`, `agent-validation.*`, `agent-template.*` → `services/`
- [ ] Step 6: Move port file: `agent-dispatch.port.ts` → `ports/`
- [ ] Step 7: Move prompt file: `guardrail-prompt.ts` → `prompts/`
- [ ] Step 8: Move E2E test: `agent-boundary.spec.ts` → `__tests__/`
- [ ] Step 9: Update `kernel/agents/index.ts` barrel — all export paths
- [ ] Step 10: Update 13 external deep imports that bypass the barrel:
  - `@kernel/agents/agent-event.schema` (7 files: kernel/ports, kernel/infrastructure, cli/components, execution/domain)
  - `@kernel/agents/turn-metrics.schema` (1 file: execution/domain)
  - `@kernel/agents/agent-status.schema` (1 file: execution/infrastructure)
  - `@kernel/agents/agent-status-cross-checker` (1 file)
  - `@kernel/agents/agent-status-parser` (1 file)
  - `@kernel/agents/agent-status-prompt` (1 file)
  - `@kernel/agents/guardrail-prompt` (1 file)
  - Strategy: update to new subfolder paths (e.g., `@kernel/agents/schemas/agent-event.schema`)
- [ ] Step 11: Run `npx vitest run` — verify all tests pass
- [ ] Step 12: Commit `refactor(S01/T01): reorganize kernel/agents into subfolders`

---

### Task 2: Reorganize review/domain/ flat files (34 files)
**Files:** Move flat files within `src/hexagons/review/domain/` into subfolders
**Traces to:** AC1, AC2

- [ ] Step 1: Create subdirectories: `aggregates/`, `schemas/`, `builders/`, `value-objects/`, `strategies/`
- [ ] Step 2: Move aggregate files (8) → `aggregates/`
- [ ] Step 3: Move schema files (13) → `schemas/`
- [ ] Step 4: Move builder files (5) → `builders/`
- [ ] Step 5: Move VO files (2): `merged-review.vo.*` → `value-objects/`
- [ ] Step 6: Move strategy files (2): `review-strategy.*` → `strategies/`
- [ ] Step 7: Update imports in `review/domain/` (internal cross-references)
- [ ] Step 8: Update `review/index.ts` barrel — domain export paths
- [ ] Step 9: Run `npx vitest run` — verify all tests pass
- [ ] Step 10: Commit `refactor(S01/T02): reorganize review/domain into subfolders`

---

### Task 3: Reorganize review/infrastructure/ (39 files)
**Files:** Move files within `src/hexagons/review/infrastructure/` into subfolders
**Traces to:** AC1, AC2

- [ ] Step 1: Create subdirectories under `repositories/`: `review/`, `ship-record/`, `completion-record/`, `verification/`; under `adapters/`: `review-ui/`, `slice-spec/`, `executor-query/`, `changed-files/`, `audit/`, `fixer/`, `merge-gate/`, `milestone/`
- [ ] Step 2: Move repository files (12) into respective `repositories/` subfolders
- [ ] Step 3: Move adapter files (27) into respective `adapters/` subfolders
- [ ] Step 4: Update `review/index.ts` barrel — infrastructure export paths
- [ ] Step 5: Update `src/cli/extension.ts` — 15 direct imports from `@hexagons/review/infrastructure/`:
  - All `in-memory-*`, `sqlite-*`, `terminal-*`, `plannotator-*`, `cached-*`, `git-*`, `bead-*`, `pi-*`, `stub-*`, `milestone-*` adapters
  - Update paths to new `repositories/` and `adapters/` subfolders
- [ ] Step 6: Update `src/hexagons/workflow/infrastructure/pi/workflow.extension.spec.ts` — direct import of `in-memory-review-ui.adapter`
- [ ] Step 7: Run `npx vitest run` — verify all tests pass
- [ ] Step 8: Commit `refactor(S01/T03): reorganize review/infrastructure into subfolders`

---

### Task 4: Reorganize execution/infrastructure/ (52 files)
**Files:** Move files within `src/hexagons/execution/infrastructure/` into subfolders
**Traces to:** AC1, AC2
**Deps:** T01, T02, T03 (do last — most coupling, most risk)

- [ ] Step 1: Create subdirectories under `repositories/`: `checkpoint/`, `journal/`, `metrics/`; under `adapters/`: `execution-session/`, `agent-dispatch/`, `worktree/`, `overseer/`, `guardrails/`, `pause-signal/`; `policies/`
- [ ] Step 2: Move repository files (15) into respective `repositories/` subfolders
- [ ] Step 3: Move adapter files (19) into respective `adapters/` subfolders
- [ ] Step 4: Move `rules/` into `adapters/guardrails/rules/` (nest existing subfolder)
- [ ] Step 5: Move policy files (4): `default-retry-policy.*`, `timeout-strategy.*` → `policies/`
- [ ] Step 6: Update `execution/index.ts` barrel — ~46 infrastructure export paths
- [ ] Step 7: Update `src/cli/extension.ts` — 7 direct imports from execution/infrastructure:
  - `GitWorktreeAdapter` → `adapters/worktree/`
  - `InMemoryCheckpointRepository` → `repositories/checkpoint/`
  - `InMemoryJournalRepository` → `repositories/journal/`
  - `MarkdownExecutionSessionAdapter` → `adapters/execution-session/`
  - `PiAgentDispatchAdapter` → `adapters/agent-dispatch/`
  - `ProcessSignalPauseAdapter` → `adapters/pause-signal/`
  - `registerExecutionExtension` → `pi/` (unchanged)
- [ ] Step 8: Verify no .ts files remain at flat level of `execution/infrastructure/` (excluding `pi/` subdirectory and `index.ts`)
  - Note: internal imports within moved files (e.g., `pi-agent-dispatch.adapter.ts` referencing `@kernel/agents/*`) should already be correct after T01. T04 only updates barrel exports and `extension.ts`.
- [ ] Step 9: Run `npx vitest run` — verify all tests pass
- [ ] Step 10: Commit `refactor(S01/T04): reorganize execution/infrastructure into subfolders`

---

### Task 5: StateBranchOpsPort + GitStateBranchOpsAdapter
**Files:**
- Create `src/kernel/ports/state-branch-ops.port.ts`
- Create `src/kernel/infrastructure/state-branch/git-state-branch-ops.adapter.ts`
- Create `src/kernel/infrastructure/state-branch/git-state-branch-ops.adapter.spec.ts`
- Modify `src/kernel/index.ts` (export new port)
**Traces to:** AC3, AC4, AC6, AC7, AC8
**Deps:** None (new files land in `kernel/ports/` and `kernel/infrastructure/state-branch/` — unaffected by reorg)

- [ ] Step 1: Write port interface `StateBranchOpsPort` with 8 abstract methods:
  ```typescript
  abstract createOrphan(branchName: string): Promise<Result<void, GitError>>;
  abstract forkBranch(source: string, target: string): Promise<Result<void, GitError>>;
  abstract deleteBranch(branchName: string): Promise<Result<void, GitError>>;
  abstract branchExists(branchName: string): Promise<Result<boolean, GitError>>;
  abstract renameBranch(oldName: string, newName: string): Promise<Result<void, GitError>>;
  abstract syncToStateBranch(stateBranch: string, files: Map<string, Buffer>): Promise<Result<string, GitError>>; // returns commit SHA
  abstract readFromStateBranch(stateBranch: string, path: string): Promise<Result<Buffer | null, GitError>>;
  abstract readAllFromStateBranch(stateBranch: string): Promise<Result<Map<string, Buffer>, GitError>>;
  ```
- [ ] Step 2: Write failing unit tests for `GitStateBranchOpsAdapter`:
  - `createOrphan`: calls git worktree add --detach, checkout --orphan, rm -rf --cached, commit, worktree remove
  - `forkBranch`: calls git branch target source
  - `syncToStateBranch`: creates temp worktree, writes files, commits, removes worktree (try-finally)
  - `readFromStateBranch`: calls git show ref:path with encoding:'buffer'
  - `readAllFromStateBranch`: calls git ls-tree then extractFile per entry
  - `branchExists`: calls git rev-parse --verify refs/heads/name
  - `deleteBranch`: calls git branch -D
  - `renameBranch`: calls git branch -m old new
- [ ] Step 3: Run `npx vitest run src/kernel/infrastructure/state-branch/` — verify FAIL
- [ ] Step 4: Implement `GitStateBranchOpsAdapter`:
  - Constructor: `(cwd: string)` — project root
  - Use `execFile` with clean git env (strip GIT_* vars — follow existing `GitCliAdapter` pattern)
  - `createOrphan`: 3-step (detach worktree → checkout --orphan → rm -rf --cached → initial empty commit → worktree remove)
  - `syncToStateBranch`: `git worktree add tmpPath branch` → write files to tmpPath → `git add -A && commit` → `git worktree remove` in finally
  - `readFromStateBranch`: raw `execFile('git', ['show', ref:path], { encoding: 'buffer', maxBuffer: 10MB })` — NO stdout.trim()
  - `readAllFromStateBranch`: `git ls-tree -r --name-only ref` → extractFile per entry with path traversal check
  - Temp worktree path: `path.join(os.tmpdir(), 'tff-state-wt-' + randomUUID().slice(0,8))`
  - All temp worktrees cleaned in finally blocks
- [ ] Step 5: Run `npx vitest run src/kernel/infrastructure/state-branch/` — verify PASS
- [ ] Step 6: Export `StateBranchOpsPort` from `src/kernel/index.ts`
- [ ] Step 7: Commit `feat(S01/T05): add StateBranchOpsPort and GitStateBranchOpsAdapter`

---

### Task 6: Integration Tests — Full Round-Trip + JSON Merger
**Files:**
- Create `src/kernel/infrastructure/state-branch/json-snapshot-merger.ts`
- Create `src/kernel/infrastructure/state-branch/json-snapshot-merger.spec.ts`
- Create `src/kernel/infrastructure/state-branch/git-state-branch-ops.integration.spec.ts`
**Traces to:** AC3, AC4, AC5, AC8
**Deps:** T05

- [ ] Step 1: Write `json-snapshot-merger.ts`:
  ```typescript
  interface SnapshotEntity { id: string; [key: string]: unknown; }
  interface Snapshot { project?: unknown; milestones: SnapshotEntity[]; slices: SnapshotEntity[]; tasks: SnapshotEntity[]; }
  function mergeSnapshots(parent: Snapshot, child: Snapshot, sliceId: string): Snapshot
  function mergeById(parentArr, childArr, winnerFn): SnapshotEntity[]
  ```
- [ ] Step 2: Write failing tests for `json-snapshot-merger`:
  - Merge disjoint entities → union
  - Merge overlapping slice → child wins for owned slice
  - Merge overlapping task (same sliceId) → child wins
  - Merge overlapping task (different sliceId) → parent wins
  - Project field → parent always wins
  - Milestones → parent always wins
  - Empty arrays → no crash
- [ ] Step 3: Run `npx vitest run src/kernel/infrastructure/state-branch/json-snapshot-merger.spec.ts` — verify FAIL
- [ ] Step 4: Implement `mergeSnapshots` and `mergeById`
- [ ] Step 5: Run merger tests — verify PASS
- [ ] Step 6: Write integration test `git-state-branch-ops.integration.spec.ts`:
  - `beforeEach`: init temp git repo (`git init`, create initial commit on main)
  - Test: createOrphan → verify no merge-base with main
  - Test: syncToStateBranch → write JSON + artifact files
  - Test: readFromStateBranch → verify identical bytes
  - Test: readAllFromStateBranch → verify all files present
  - Test: forkBranch → verify independent (modify child, parent unchanged)
  - Test: full merge round-trip → write to parent+child, merge, verify result
  - Test: branchExists → true/false
  - Test: renameBranch → old gone, new exists, content preserved
  - Test: deleteBranch → branch gone
  - `afterEach`: rm -rf temp repo
- [ ] Step 7: Run `npx vitest run src/kernel/infrastructure/state-branch/git-state-branch-ops.integration.spec.ts` — verify PASS
- [ ] Step 8: Commit `test(S01/T06): full round-trip integration tests + json-snapshot-merger`

---

## Wave Detection

```
Wave 0: T01, T02, T03, T05  (parallel — 3 independent reorgs + new port/adapter in unaffected dirs)
Wave 1: T04, T06             (T04 depends on T01; T06 depends on T05)
```

Note: T05 creates files in `kernel/ports/` and `kernel/infrastructure/state-branch/` — untouched by reorg tasks. T06 depends only on T05. This cuts the critical path from 4 waves to 2.
