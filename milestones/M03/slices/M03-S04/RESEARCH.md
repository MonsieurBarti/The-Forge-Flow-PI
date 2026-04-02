# M03-S04 Research: Context Staging Area

## Scope

F-lite slice. 12 new files (6 domain, 2 infrastructure, 4 test specs). No existing files modified except barrel exports and `WorkflowExtensionDeps`.

## Dependency Verification

### Kernel Types (all confirmed)

| Type | Location | Notes |
|---|---|---|
| `ValueObject<TProps>` | `src/kernel/value-object.base.ts` | Protected ctor, Zod parse, `equals()` via stable stringify |
| `Result<T, E>` | `src/kernel/result.ts` | `{ ok: true; data: T } \| { ok: false; error: E }` + helpers `ok()`, `err()`, `isOk()`, `isErr()`, `match()` |
| `BaseDomainError` | `src/kernel/errors/base-domain.error.ts` | Abstract `code`, optional `metadata` |
| `IdSchema` / `Id` | `src/kernel/schemas.ts:3-4` | `z.uuid()` |
| `ComplexityTierSchema` | `src/kernel/schemas.ts:9-10` | `z.enum(["S", "F-lite", "F-full"])` |
| `ModelProfileNameSchema` | `src/kernel/schemas.ts:12-13` | `z.enum(["quality", "balanced", "budget"])` |
| `AgentTypeSchema` | `src/kernel/agents/agent-card.schema.ts:4-9` | `z.enum(["spec-reviewer", "code-reviewer", "security-auditor", "fixer"])` |

All re-exported from `src/kernel/index.ts`.

### Workflow Hexagon (all confirmed)

| Item | Location | Notes |
|---|---|---|
| `ACTIVE_PHASES` | `src/hexagons/workflow/domain/transition-table.ts:9-17` | ReadonlySet: discussing, researching, planning, executing, verifying, reviewing, shipping |
| `WorkflowPhaseSchema` | `src/hexagons/workflow/domain/workflow-session.schemas.ts:5-18` | 11 phases |
| `WorkflowExtensionDeps` | `src/hexagons/workflow/infrastructure/pi/workflow.extension.ts:12-20` | 7 fields currently; S04 adds `contextStaging: ContextStagingPort` |
| `OrchestratePhaseTransitionUseCase` | `src/hexagons/workflow/use-cases/orchestrate-phase-transition.use-case.ts` | Input: `{ milestoneId, trigger, guardContext }`, Result: `{ fromPhase, toPhase, sliceTransitioned }` |
| Barrel | `src/hexagons/workflow/index.ts` | Exports all domain types, ports, errors, events, use cases |

### Settings Hexagon (cross-hexagon dependency)

| Item | Location | Notes |
|---|---|---|
| `ResolveModelUseCase` | `src/hexagons/settings/use-cases/resolve-model.use-case.ts` | Takes `{ phase, complexity, settings, unavailableModels? }` returns `Result<ModelName, never>` |
| Barrel | `src/hexagons/settings/index.ts` | Exports use case, all schemas, ports |

## Integration Analysis

### ModelProfileResolverPort Abstraction

The SPEC's `ModelProfileResolverPort.resolveForPhase(phase, complexity)` returns `Promise<ModelProfileName>`.
The settings hexagon's `ResolveModelUseCase.execute()` takes `{ phase, complexity, settings, unavailableModels? }` and returns `Result<ModelName, never>`.

The port abstracts away:
- `settings` — the production adapter will hold a reference to loaded settings
- `unavailableModels` — not needed for M03
- Return type mapping: `ModelName` (actual model) vs `ModelProfileName` (profile tier)

For M03-S04, only the port + in-memory stub are needed. Production adapter wiring is M04+ scope.

### WorkflowExtensionDeps Change

Current fields (7): projectRepo, milestoneRepo, sliceRepo, taskRepo, sliceTransitionPort, eventBus, dateProvider.
S04 adds: `contextStaging: ContextStagingPort` (8th field).

### ACTIVE_PHASES Reuse

`isActivePhase()` can directly import `ACTIVE_PHASES` from `transition-table.ts`. No duplication needed — confirmed the set exists as a `ReadonlySet<WorkflowPhase>`.

## Risks and Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| `ModelProfileName` vs `ModelName` confusion | Low | Port returns `ModelProfileName` (the tier), not `ModelName` (the concrete model). Clear naming in SPEC. |
| SKILL_NAMES drift from TFF-CC methodology | Low | SPEC lists 13 phase-bound skills. Remaining 5 non-phase-bound skills deferred to M05 Intelligence hexagon. |

## Conclusion

No blockers. All dependencies exist and are accessible via barrel exports. The SPEC's design aligns with existing patterns (ValueObject, port/adapter, error hierarchy). Ready to plan.
