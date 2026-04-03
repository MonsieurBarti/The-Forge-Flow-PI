# M03-S08 Research: Next-Step Suggestions

## 1. Domain Foundations

### ValueObject Base
- `src/kernel/value-object.base.ts`
- Constructor: `protected constructor(props: TProps, schema: ZodType<TProps>)` -- Zod-validates on creation
- `equals()` via `stableStringify()` -- deterministic key-sorted JSON comparison
- `NextStepSuggestion` extends this with `NextStepSuggestionPropsSchema`

### WorkflowPhaseSchema
- `src/hexagons/workflow/domain/workflow-session.schemas.ts`
- 11 values: `idle | discussing | researching | planning | executing | verifying | reviewing | shipping | completing-milestone | paused | blocked`
- Used by `WorkflowSession.currentPhase` and `previousPhase`

### ComplexityTierSchema
- `src/kernel/schemas.ts`
- 3 values: `S | F-lite | F-full`
- Re-exported from `src/hexagons/slice/domain/slice.schemas.ts`

### AutonomyMode
- Defined in `@hexagons/settings` -- `'guided' | 'plan-to-pr'`
- Used by `WorkflowSession.autonomyMode` and `autonomy-policy.ts`

## 2. Autonomy Policy (Gate Alignment)

**File**: `src/hexagons/workflow/domain/autonomy-policy.ts`

```
PLAN_TO_PR_GATES = Set(["planning", "reviewing", "shipping"])
ACTIVE_PHASES imported from transition-table
```

- `shouldAutoTransition(phase, mode)` returns `{ autoTransition: boolean, isHumanGate: boolean }`
- Guided mode: ALL active phases are gates (never auto-transition)
- Plan-to-PR: only planning/reviewing/shipping are gates

**Alignment**: NextStepSuggestion's `autoInvoke` semantics mirror this exactly -- `autoInvoke=true` iff `shouldAutoTransition().autoTransition === true`.

## 3. WorkflowSession Aggregate

**File**: `src/hexagons/workflow/domain/workflow-session.aggregate.ts`

Key props for NextStepContext construction:
- `currentPhase: WorkflowPhase` -- maps to `ctx.phase`
- `sliceId: string | undefined` -- determines whether to load slice
- `previousPhase: WorkflowPhase | undefined` -- maps to `ctx.previousPhase` (for paused state)
- `autonomyMode: AutonomyMode` -- maps to `ctx.autonomyMode`
- `milestoneId: string` -- used to query all slices for allSlicesClosed

## 4. Ports & Repositories

### WorkflowSessionRepositoryPort
- `src/hexagons/workflow/domain/ports/workflow-session.repository.port.ts`
- `findByMilestoneId(milestoneId: Id): Promise<Result<WorkflowSession | null, PersistenceError>>`
- SuggestNextStepUseCase uses this to load the active session

### SliceRepositoryPort
- `src/hexagons/slice/domain/ports/slice-repository.port.ts`
- `findById(id: Id): Promise<Result<Slice | null, PersistenceError>>`
- `findByMilestoneId(milestoneId: Id): Promise<Result<Slice[], PersistenceError>>`
- SuggestNextStepUseCase uses `findById()` for current slice + `findByMilestoneId()` for allSlicesClosed check

### Slice Aggregate Props
- `label: string` (format "M##-S##") -- maps to `ctx.sliceLabel`
- `title: string` -- human-readable name (displayText uses label, not title)
- `status: SliceStatus` -- "discussing" | ... | "completing" | "closed"
- `complexity: ComplexityTier | null` -- maps to `ctx.tier` (null -> undefined)

**Important**: SliceStatus has "completing" (not "completing-milestone"). The allSlicesClosed check uses `status === 'closed'`.

## 5. Error Classes

### WorkflowSessionNotFoundError
- Defined in `src/hexagons/workflow/use-cases/orchestrate-phase-transition.use-case.ts`
- Extends `WorkflowBaseError`, code = `"WORKFLOW.SESSION_NOT_FOUND"`
- Already exported from `src/hexagons/workflow/index.ts`
- Can be imported and reused by SuggestNextStepUseCase

### SliceNotFoundError
- Defined in `src/hexagons/slice/domain/errors/slice-not-found.error.ts`
- Extends `BaseDomainError`, code = `"SLICE.NOT_FOUND"`
- Cross-hexagon import: workflow hexagon importing from slice hexagon
- Already used in other workflow use-cases (e.g., start-discuss) -- precedent exists

## 6. Existing Protocol Builders (To Replace)

### Pattern (all three identical)
```typescript
// discuss-protocol.ts / research-protocol.ts / plan-protocol.ts
const autonomyInstruction =
  params.autonomyMode === "plan-to-pr"
    ? "auto-invoke message..."
    : "suggest message...";
return render(template, { ...params, autonomyInstruction });
```

### Templates
- `src/hexagons/workflow/infrastructure/pi/templates/protocols/discuss.md` -- `{{autonomyInstruction}}`
- `src/hexagons/workflow/infrastructure/pi/templates/protocols/research.md` -- `{{autonomyInstruction}}`
- `src/hexagons/workflow/infrastructure/pi/templates/protocols/plan.md` -- `{{autonomyInstruction}}`

### Render function (local to each file)
```typescript
function render(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}
```

## 7. Command Handlers (Deps to Extend)

### DiscussCommandDeps
- `src/hexagons/workflow/infrastructure/pi/discuss.command.ts:8-12`
- Current: `{ startDiscuss, sliceRepo, milestoneRepo }`
- Add: `suggestNextStep: SuggestNextStepUseCase`

### ResearchCommandDeps
- `src/hexagons/workflow/infrastructure/pi/research.command.ts:9-14`
- Current: `{ sliceRepo, milestoneRepo, sessionRepo, artifactFile }`
- Add: `suggestNextStep: SuggestNextStepUseCase`

### PlanCommandDeps
- `src/hexagons/workflow/infrastructure/pi/plan.command.ts:9-14`
- Current: `{ sliceRepo, milestoneRepo, sessionRepo, artifactFile }`
- Add: `suggestNextStep: SuggestNextStepUseCase`

### Status Handler
- Inline in `workflow.extension.ts:94-120`
- Does NOT have a separate command file -- status is registered directly
- Add SuggestNextStepUseCase call after `statusUseCase.execute()` in the `tff_status` tool handler

## 8. Extension Wiring

**File**: `src/hexagons/workflow/infrastructure/pi/workflow.extension.ts`

### WorkflowExtensionDeps
```typescript
// Line 30-44 -- no changes needed, already has all required ports
{
  workflowSessionRepo: WorkflowSessionRepositoryPort,
  sliceRepo: SliceRepositoryPort,
  // ... other deps
}
```

### Wiring approach
1. Create `SuggestNextStepUseCase` instance from existing deps (sessionRepo + sliceRepo)
2. Pass to discuss/research/plan command registrations
3. Call in tff_status tool handler, merge into status output

## 9. Barrel Exports

**File**: `src/hexagons/workflow/index.ts`

Add exports:
- `NextStepSuggestion` VO class + `NextStepSuggestionProps` type + `NextStepContextSchema`/`NextStepContext` type
- `SuggestNextStepUseCase` class

## 10. Integration Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| WorkflowSessionNotFoundError defined inside use-case file, not standalone | Import coupling | Import from orchestrate-phase-transition.use-case.ts -- already exported from index.ts |
| SliceNotFoundError is cross-hexagon | Architecture purity | Precedent exists (start-discuss already imports from slice hexagon) |
| Protocol builder breaking change (new `nextStep` param) | All 3 command specs need update | Bounded change -- only 3 files, test pattern is clear |
| Status handler is inline (no separate file) | Mixing concerns in extension | Keep inline -- adding one use-case call is minimal; extracting to separate file would be overengineering |
| allSlicesClosed query on every suggestion | Performance (N+1 potential) | findByMilestoneId returns all slices in one call -- no N+1 |

## 11. Test Infrastructure

### Existing patterns
- In-memory adapters for all ports (colocated in `infrastructure/` dirs)
- `SliceBuilder` at `src/hexagons/slice/domain/slice.builder.ts` -- fluent builder for test slices
- Protocol spec pattern: build message with params, assert `toContain()` on output strings
- Extension spec: mock `ExtensionAPI`, verify `registerTool`/`registerCommand` calls

### Required test doubles for SuggestNextStepUseCase
- `InMemoryWorkflowSessionRepository` (existing)
- `InMemorySliceRepository` (existing)
- Both accept pre-seeded data for test setup

## 12. Summary

Spec is well-aligned with codebase. All referenced types, ports, and patterns exist. No architectural conflicts found. Key implementation decisions are validated:
- `PLAN_TO_PR_GATES` alignment confirmed
- Cross-hexagon imports have precedent
- WorkflowSessionNotFoundError is already exported and reusable
- findByMilestoneId() exists on SliceRepositoryPort for allSlicesClosed computation
- Protocol builder replacement is a clean 1:1 swap (autonomyInstruction -> nextStep)
