# M03-S02: Research Notes

## ValueObject Base Class

- **Location:** `src/kernel/value-object.base.ts`
- **Constructor:** `protected constructor(props: TProps, schema: ZodType<TProps>)` — auto-parses via schema
- **Pattern:** Private constructor, static factory, getters for props
- **Example:** `SliceStatusVO` wraps a single Zod schema, uses `ValueObject<SliceStatusVOProps>`
- **Equality:** Stable value comparison via stringified props (`equals()`)

## Kernel Schemas

- `IdSchema = z.uuid()` — exported from `@kernel`
- `TimestampSchema = z.coerce.date()` — exported from `@kernel` (handles both Date and string)
- Both available via barrel: `import { IdSchema, TimestampSchema } from "@kernel"`

## ACTIVE_PHASES Constant

- **Location:** `src/hexagons/workflow/domain/transition-table.ts`
- **Type:** `ReadonlySet<WorkflowPhase>` containing 7 phases: discussing, researching, planning, executing, verifying, reviewing, shipping
- **Already exported** from workflow barrel index — no new export needed
- Used by `findMatchingRules()` for wildcard rule matching

## Integration Points

- Escalation VO follows SliceStatusVO/TaskStatusVO pattern (private ctor, static factory)
- `EscalationPropsSchema` uses `IdSchema` + `TimestampSchema` from kernel
- `ACTIVE_PHASES` already re-exported from `@hexagons/workflow` — `autonomy-policy.ts` can import directly from sibling
- `GuardContextSchema` extension (adding `lastError`) is backward-compatible via `.default(null)`
