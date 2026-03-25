# M02-S01: Task Hexagon — Research

## Key Findings

### Kernel EVENT_NAMES already has task events
`TASK_COMPLETED` and `TASK_BLOCKED` already exist in `src/kernel/event-names.ts`. Only `TASK_CREATED` needs to be added. Update SPEC accordingly.

### Established hexagon pattern (Slice as reference)
Domain subfolder convention: `events/`, `errors/`, `ports/` subfolders. Colocated specs. Builder at domain root. Contract tests in infrastructure/.

### Import pattern
All hexagons import from `@kernel` barrel. Internal imports use relative paths with subfolders.

### Repository uniqueness
Label uniqueness is scoped per-parent (Slice scopes labels per milestone). Task should scope labels per slice.

## Unknowns Resolved
- No unknowns. Pattern is well-established from S05/S06/S07.

## Spec Adjustments Needed
- AC21 should say "add TASK_CREATED to EVENT_NAMES" (TASK_COMPLETED and TASK_BLOCKED already exist)
