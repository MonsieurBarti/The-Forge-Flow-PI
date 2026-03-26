# M02-S06: Agent Artifact Schemas — Verification Report

**Slice:** M02-S06
**Date:** 2026-03-26
**Verdict:** PASS

## Acceptance Criteria

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| AC1 | `AgentDispatchConfigSchema.parse()` validates all dispatch configs at boundary | PASS | Schema in `agent-dispatch.schema.ts` validates taskId (uuid), sliceId, agentType, workingDirectory, systemPrompt, taskPrompt, model, tools (min 1), filePaths (default []). 5 tests cover valid parse, empty tools rejection, invalid agentType rejection. |
| AC2 | `AgentResultSchema.parse()` validates all agent results at boundary | PASS | Schema in `agent-result.schema.ts` validates taskId, agentType, success, output, filesChanged (default []), cost (int nonneg tokens), durationMs (int nonneg), error (optional). 6 tests cover valid parse, failure parse, negative/non-integer rejection. |
| AC3 | Every `AgentType` enum value has a corresponding `AgentCard` in the registry | PASS | `AGENT_REGISTRY: ReadonlyMap<AgentType, AgentCard>` has entries for all 4 types (spec-reviewer, code-reviewer, security-auditor, fixer). Registry spec iterates `AgentTypeSchema.options` and asserts presence. |
| AC4 | `findAgentsByCapability()` returns correct agents for each capability | PASS | Spec tests `findAgentsByCapability("review")` returns 3 agents, `findAgentsByCapability("fix")` returns 1 agent, each verified to contain the queried capability. |
| AC5 | `getAgentCard()` returns `AgentCard` directly with runtime assertion | PASS | Returns `AgentCard` (not `Result`), throws `Error` with `[BUG]` message if missing. Spec tests every agent type via iteration. |
| AC6 | `ModelProfileNameSchema` promoted to `kernel/schemas.ts` | PASS | Defined in `kernel/schemas.ts`. Imported by `agent-card.schema.ts` from `@kernel/schemas`. Settings hexagon imports from `@kernel/schemas` and re-exports (no local definition). |
| AC7 | All schemas, types, and registry exported from `kernel/agents/index.ts` | PASS | Barrel exports all 7 schemas, 7 types, 3 registry exports, 2 builders. Kernel index re-exports all from `./agents`. |
| AC8 | Builders produce valid schema output with sensible faker defaults | PASS | Both builder specs test `new Builder().build()` validates against schema. Implementations use `faker.string.uuid()`, `faker.lorem.paragraph()`, `faker.number.int()`, `faker.finance.amount()`. |

## Test Results

- **Agent module tests:** 36 passed, 0 failed
- **Full suite:** 336 passed, 0 failed
- **Regressions:** None (Settings hexagon tests pass with re-exported schema)

## Files Delivered

| File | Action |
|---|---|
| `src/kernel/schemas.ts` | Modified — added `ModelProfileNameSchema` |
| `src/kernel/schemas.spec.ts` | Modified — added `ModelProfileNameSchema` tests |
| `src/kernel/index.ts` | Modified — re-exports `ModelProfileNameSchema` + agent barrel |
| `src/hexagons/settings/domain/project-settings.schemas.ts` | Modified — imports `ModelProfileNameSchema` from kernel |
| `src/kernel/agents/agent-card.schema.ts` | Created |
| `src/kernel/agents/agent-card.schema.spec.ts` | Created |
| `src/kernel/agents/agent-dispatch.schema.ts` | Created |
| `src/kernel/agents/agent-dispatch.schema.spec.ts` | Created |
| `src/kernel/agents/agent-result.schema.ts` | Created |
| `src/kernel/agents/agent-result.schema.spec.ts` | Created |
| `src/kernel/agents/agent-registry.ts` | Created |
| `src/kernel/agents/agent-registry.spec.ts` | Created |
| `src/kernel/agents/agent-dispatch.builder.ts` | Created |
| `src/kernel/agents/agent-dispatch.builder.spec.ts` | Created |
| `src/kernel/agents/agent-result.builder.ts` | Created |
| `src/kernel/agents/agent-result.builder.spec.ts` | Created |
| `src/kernel/agents/index.ts` | Created |
