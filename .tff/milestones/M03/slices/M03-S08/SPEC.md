# M03-S08: Next-Step Suggestions

## Problem

R09 requires every command to end with a next-step suggestion based on current state. Currently, 3 commands (discuss, research, plan) embed ad-hoc `{{autonomyInstruction}}` strings in their protocol templates. This is:
- Incomplete: only 3 of 11 phases covered
- Fragile: each command hardcodes its own suggestion logic
- Inconsistent: no central state-to-suggestion map

## Approach

Declarative lookup table as a domain value object (`NextStepSuggestion`) in the workflow hexagon. A const record maps `(phase, autonomyMode, tier)` to suggestion templates. A static factory `build()` resolves the correct suggestion. A `SuggestNextStepUseCase` wraps the VO with port access (session + slice loading).

Existing commands are retrofitted: ad-hoc autonomy instruction builders are removed and replaced with `SuggestNextStepUseCase` calls injected via a single `{{nextStep}}` template placeholder.

## Design

### NextStepContext Schema

```typescript
export const NextStepContextSchema = z.object({
  phase: WorkflowPhaseSchema,
  autonomyMode: z.enum(['guided', 'plan-to-pr']),
  tier: ComplexityTierSchema.optional(),
  sliceLabel: z.string().optional(),
  previousPhase: WorkflowPhaseSchema.optional(),
  allSlicesClosed: z.boolean().default(false),
});
export type NextStepContext = z.infer<typeof NextStepContextSchema>;
```

### NextStepSuggestion Value Object

```typescript
export const NextStepSuggestionPropsSchema = z.object({
  command: z.string(),
  args: z.string().optional(),
  displayText: z.string(),
  autoInvoke: z.boolean(),
});
export type NextStepSuggestionProps = z.infer<typeof NextStepSuggestionPropsSchema>;

export class NextStepSuggestion extends ValueObject<NextStepSuggestionProps> {
  static build(ctx: NextStepContext): NextStepSuggestion | null { ... }
  get command(): string { return this.props.command; }
  get args(): string | undefined { return this.props.args; }
  get displayText(): string { return this.props.displayText; }
  get autoInvoke(): boolean { return this.props.autoInvoke; }
}
```

### Suggestion Map

Gate set for next-step suggestions aligns with existing `PLAN_TO_PR_GATES` in `autonomy-policy.ts`: **planning, reviewing, shipping**. Verifying is NOT a gate (auto-transitions in plan-to-pr mode).

The suggestion map defines its own `autoInvoke` semantics: `autoInvoke=true` only for active, non-gate phases in plan-to-pr mode. Idle, paused, blocked, and completing-milestone always have `autoInvoke=false` (idle is not an active phase; the user must choose the next slice).

| Phase | Guided | Plan-to-PR | autoInvoke (p2pr) | Guard override |
|---|---|---|---|---|
| idle (`allSlicesClosed=false`) | `Next: /tff:discuss` | `Next: /tff:discuss` | false | -- |
| idle (`allSlicesClosed=true`) | `Next: /tff:complete-milestone` | `Next: /tff:complete-milestone` | false | -- |
| discussing | `Next: /tff:research <label>` | auto-invoke research | true | tier=S: suggest /tff:plan |
| researching | `Next: /tff:plan <label>` | auto-invoke plan | true | -- |
| planning | `Awaiting plan approval` | `Awaiting plan approval` | false | gate |
| executing | `Next: /tff:verify <label>` | auto-invoke verify | true | -- |
| verifying | `Next: /tff:review <label>` | auto-invoke review | true | -- |
| reviewing | `Awaiting review approval` | `Awaiting review approval` | false | gate |
| shipping | `Awaiting ship approval` | `Awaiting ship approval` | false | gate |
| completing-milestone | null (terminal) | null (terminal) | n/a | -- |
| paused | `Resume: /tff:resume <label> (was: <previousPhase>)` | same | false | -- |
| blocked | `Blocked -- resolve escalation` | same | false | -- |

Where `<label>` is the interpolated `sliceLabel` from context. When no slice is assigned (idle phase), the label is omitted from the displayText.

### SuggestNextStepUseCase

**Constructor dependencies:**
- `WorkflowSessionRepositoryPort` — load active session
- `SliceRepositoryPort` — load slice for tier/label + check allSlicesClosed

```
Input: { milestoneId: string }
1. Load WorkflowSession from repository
2. If session has sliceId: load Slice for tier + label (convert null complexity to undefined)
3. Query all slices for milestone, compute allSlicesClosed = every(s => s.status === 'closed')
4. Build NextStepContext from session props + slice + allSlicesClosed
5. Call NextStepSuggestion.build(ctx)
6. Return Result<NextStepSuggestion | null, WorkflowBaseError>

Error cases:
- Session not found: return WorkflowSessionNotFoundError (existing error class)
- Slice not found (when sliceId present): return SliceNotFoundError (from slice hexagon)
```

**Tier undefined behavior:** When complexity hasn't been classified yet (tier=undefined during discussing phase), the S-tier guard does NOT fire → default path suggests `/tff:research`. This is correct: classification happens at the end of discuss, so the first invocation always defaults to the research path.

**Suggestions are advisory:** displayText and autoInvoke are hints to the agent. They do not directly trigger workflow transitions. The agent still needs to perform the appropriate action (e.g., call `tff_workflow_transition` with trigger `approve`).

### Retrofit Plan

**Remove:**
- `buildAutonomyInstruction()` from discuss-protocol.ts, research-protocol.ts, plan-protocol.ts

**Replace in protocol templates:**
- `{{autonomyInstruction}}` -> `{{nextStep}}`

**Wire in commands:**
- discuss.command.ts, research.command.ts, plan.command.ts call SuggestNextStepUseCase after main logic
- Inject suggestion displayText + autoInvoke flag into protocol template via `{{nextStep}}` placeholder
- This adds SuggestNextStepUseCase as a new dependency to each command's deps interface (breaking change to `DiscussCommandDeps`, `ResearchCommandDeps`, `PlanCommandDeps` public types)

**Wire in status:**
- SuggestNextStepUseCase is called externally in the status command handler (NOT composed into GetStatusUseCase — keeps GetStatusUseCase focused on reporting)
- Status command handler merges `nextStep: NextStepSuggestionProps | null` into the status output

**Forward-looking suggestions:** The map includes suggestions for commands not yet implemented (/tff:execute, /tff:verify, /tff:resume, /tff:complete-milestone). These are intentional placeholders — they will become functional when those commands are built in future slices.

### File Plan

**New files:**
- `src/hexagons/workflow/domain/next-step-suggestion.vo.ts`
- `src/hexagons/workflow/domain/next-step-suggestion.vo.spec.ts`
- `src/hexagons/workflow/use-cases/suggest-next-step.use-case.ts`
- `src/hexagons/workflow/use-cases/suggest-next-step.use-case.spec.ts`

**Modified files:**
- `src/hexagons/workflow/infrastructure/pi/discuss-protocol.ts`
- `src/hexagons/workflow/infrastructure/pi/research-protocol.ts`
- `src/hexagons/workflow/infrastructure/pi/research-protocol.spec.ts`
- `src/hexagons/workflow/infrastructure/pi/plan-protocol.ts`
- `src/hexagons/workflow/infrastructure/pi/discuss.command.ts`
- `src/hexagons/workflow/infrastructure/pi/research.command.ts`
- `src/hexagons/workflow/infrastructure/pi/research.command.spec.ts`
- `src/hexagons/workflow/infrastructure/pi/plan.command.ts`
- `src/hexagons/workflow/infrastructure/pi/plan.command.spec.ts`
- `src/hexagons/workflow/infrastructure/pi/templates/protocols/discuss.md`
- `src/hexagons/workflow/infrastructure/pi/templates/protocols/research.md`
- `src/hexagons/workflow/infrastructure/pi/templates/protocols/plan.md`
- `src/hexagons/workflow/infrastructure/pi/workflow.extension.ts`
- `src/hexagons/workflow/infrastructure/pi/workflow.extension.spec.ts`
- `src/hexagons/workflow/index.ts`

## Acceptance Criteria

1. `NextStepSuggestion.build()` returns correct suggestion for all entries in `WorkflowPhaseSchema` (11 phases including paused and blocked), matching the Suggestion Map table above
2. Guided mode: displayText matches Suggestion Map table values, autoInvoke=false for all phases
3. Plan-to-PR mode: autoInvoke=true only for active non-gate phases (discussing, researching, executing, verifying), autoInvoke=false for gate phases (planning, reviewing, shipping) and non-active phases (idle, paused, blocked, completing-milestone) -- gate set aligned with existing `PLAN_TO_PR_GATES`
4. S-tier guard: discussing phase suggests `/tff:plan <label>` instead of `/tff:research <label>` when `tier='S'`
5. Paused state: displayText includes previousPhase name in format `Resume: /tff:resume <label> (was: <previousPhase>)`; autoInvoke=false regardless of autonomy mode
6. Idle phase: when `allSlicesClosed=false` suggests `/tff:discuss` (no slice label); when `allSlicesClosed=true` suggests `/tff:complete-milestone`; autoInvoke=false in both modes
7. `build()` returns null for completing-milestone phase (terminal state)
8. Blocked and paused phases return the same suggestion regardless of autonomy mode
9. displayText strings interpolate actual sliceLabel (not literal `<label>` placeholder)
10. Existing discuss/research/plan commands use SuggestNextStepUseCase; `buildAutonomyInstruction()` removed from all protocol builders
11. Protocol templates use `{{nextStep}}` placeholder populated by use case output
12. `/tff:status` output includes `nextStep: NextStepSuggestionProps | null` field
13. Unit tests cover every phase/mode combination in the Suggestion Map, plus error cases (session not found, slice not found)

## Non-Goals

- Implementing commands that don't exist yet (execute, verify, ship, etc.)
- Auto-invoking next commands (command's responsibility based on autoInvoke flag)
- Notification/event integration (suggestions are pull-based)
