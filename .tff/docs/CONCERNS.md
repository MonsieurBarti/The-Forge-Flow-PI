# CONCERNS.md

Cross-cutting concerns, tech debt, and risk areas for TFF-PI.

---

## Tech Debt

| Location | Kind | Description |
|---|---|---|
| `src/cli/main.ts:12` | TODO | Entry point is a placeholder; `createAgentSession` not wired |
| `src/cli/extension.ts:163` | TODO | `ExecuteSliceUseCase` replaced by stub in composition root |
| `src/cli/extension.ts:272` | TODO | `InMemoryReviewUIAdapter` hardcoded; adapter selection not wired |
| `src/cli/extension.ts:86` | Stub | `ContextStagingPort` throws "not yet implemented" |
| `src/hexagons/*/infrastructure/sqlite-*.repository.ts` (x5) | Stub | All SQLite repositories (`project`, `milestone`, `slice`, `task`, `review`, `verification`) throw "Not implemented" on every method |
| `src/hexagons/review/application/verify-acceptance-criteria.use-case.ts:98` | Lint suppression | `eslint-disable-next-line no-constant-condition` for `while(true)` loop |

**SQLite stubs** are the biggest outstanding debt. The entire persistence layer for production use (non-in-memory) is unimplemented across 5+ hexagons.

---

## Type Safety

**Overall: Strong.** `noExplicitAny: "error"` is enforced in `biome.json`. Zero `any` usage in production code.

| Pattern | Production | Test | Notes |
|---|---|---|---|
| `as unknown as` | 1 | 46 | Production instance is in `create-zod-tool.ts` (JSON schema bridge). Test usage is expected for mock construction |
| `as Type` (non-unknown) | ~5 | ~40 | Mostly enum/literal narrowing in tests; ~5 in production for PI SDK interop and aggregate casting |

Low risk. The one production `as unknown as` in `create-zod-tool.ts` is a necessary bridge between Zod JSON schema output and the PI SDK's type parameter.

---

## Test Coverage

**333 source files, 203 spec files (61% by file count)**

Coverage is strong in domain/application layers. Gaps are concentrated in infrastructure adapters and PI SDK integration:

| Area | Untested Files | Notes |
|---|---|---|
| SQLite repositories | 5 files | Stub-only, nothing to test yet |
| PI tool files (`*.tool.ts`) | 4 files | `execute-slice`, `pause-execution`, `resume-execution`, `classify-complexity`, `workflow-transition`, `write-plan`, `write-spec` |
| PI extension/protocol files | 3 files | `execution.extension.ts`, `discuss-protocol.ts`, `plan-protocol.ts` |
| In-memory adapters | ~8 files | `in-memory-execution-session`, `in-memory-overseer`, `in-memory-pause-signal`, etc. Most are trivial |
| `pi-agent-dispatch.adapter.ts` | 1 file (379 lines) | Largest untested production file; handles agent lifecycle |
| `git-cli.adapter.ts` | 0 (has spec) | Has unit + integration + guardrail specs |

**Contract tests exist** for 12 port interfaces. **Integration tests** exist for 4 areas (git, plannotator, conduct-review, fresh-reviewer).

---

## Security

| Concern | Status |
|---|---|
| `.env` files | None present; `.gitignore` excludes `.tff/` |
| Hardcoded credentials | None found in production code |
| Credential guardrail | `credential-exposure.rule.ts` actively scans agent output for leaked secrets (passwords, API keys, tokens) |
| Auth pattern | Delegates to `gh` CLI; maps auth errors to typed `GitHubError` |
| Guardrail prompt | `kernel/agents/guardrail-prompt.ts` explicitly blocks credential exposure in agent output |

No security concerns identified. The credential-exposure guardrail rule is well-tested.

---

## Error Handling

| Pattern | Usage | Notes |
|---|---|---|
| `Result<T, E>` (monadic) | 464 occurrences across 68 files | Primary error-handling mechanism; strongly typed |
| `try/catch` | 61 occurrences across 30 files | Used at infrastructure boundaries (file I/O, CLI exec, JSON parse) |
| `throw new Error(...)` | ~30 prod occurrences | Mix of domain invariant violations and "Not implemented" stubs |
| Typed domain errors | Per-hexagon error hierarchies | Each hexagon defines its own error types extending `BaseDomainError` |

**Consistency: Good.** Domain/application layers use `Result`. Infrastructure layers wrap exceptions into `Result` via `try/catch`. The pattern is applied consistently.

**Gap:** Some `throw new Error(...)` calls in domain aggregates (e.g., `ship-record.aggregate.ts`, `completion-record.aggregate.ts`) bypass the `Result` pattern for invariant violations. This is acceptable for true programmer errors but creates inconsistency.

---

## Missing Infrastructure

| Item | Status |
|---|---|
| CI/CD pipeline | **Missing** -- no `.github/workflows/` directory |
| Pre-commit hooks | **Missing** -- no `.husky/` or git hooks configured |
| Lint in CI | N/A (no CI), but `biome check` script exists in `package.json` |
| Coverage threshold | **Not enforced** -- `vitest.config.ts` configures v8 provider but sets no thresholds |
| Build verification | `tsc --noEmit` script exists but not enforced anywhere |
| Dependency audit | **Not configured** -- no `npm audit` step |
| Lock file | Not checked (npm/pnpm lockfile presence not verified) |

---

## Fragile Areas

| Area | Risk | Detail |
|---|---|---|
| `execute-slice.use-case.ts` (532 lines, 17 deps) | High coupling | Largest use case; orchestrates waves, guardrails, overseer, checkpoints, journals, metrics. Constructor takes 17 dependencies |
| `conduct-review.use-case.ts` (466 lines, 12 deps) | Moderate coupling | Manages 3 parallel reviewer roles, retry, fixer, critique reflection |
| `execution-coordinator.use-case.ts` (348 lines) | Moderate | Coordinates session lifecycle on top of `execute-slice` |
| `pi-agent-dispatch.adapter.ts` (379 lines) | High risk | PI SDK integration bridge; no unit tests. Handles agent spawn, event streaming, result parsing |
| `cli/extension.ts` (361 lines) | Composition root | Wires all dependencies; contains stubs and TODOs; changes here affect everything |
| Cross-hexagon imports | Low risk | `workflow` depends on `slice`, `task`, `milestone`, `project`, `settings`; `review` depends on `slice`, `execution`. Import boundaries are enforced by biome lint rule, but only via barrel imports |

---

## Recommendations

**Priority 1 -- Ship blockers:**
1. Wire `cli/main.ts` entry point (currently placeholder)
2. Replace `ExecuteSliceUseCase` stub in composition root
3. Implement at least one SQLite repository to validate the persistence pattern

**Priority 2 -- Risk reduction:**
4. Add CI pipeline (GitHub Actions) with `typecheck`, `lint`, `test` steps
5. Add unit tests for `pi-agent-dispatch.adapter.ts` (largest untested file)
6. Set coverage thresholds in `vitest.config.ts`

**Priority 3 -- Hygiene:**
7. Add pre-commit hooks (`biome check`, `tsc --noEmit`)
8. Consider extracting `execute-slice.use-case.ts` (17 deps) into smaller collaborators
9. Enforce coverage reporting in CI once pipeline exists
10. Remove stale `eslint-disable` comment (project uses Biome, not ESLint)

---

*Last generated: 2026-04-04*
