# M03-S04: Context Staging Area

## Problem

Agent dispatches currently receive raw, unstructured prompts. There is no systematic way to:
- Inject phase-relevant skills (not all 18) into agent context
- Enforce the max-3 skill cap with rigid-first priority
- Assemble a structured context package per invocation
- Resolve the correct model profile for the phase + complexity tier

Without context staging, every dispatch caller must manually assemble prompts, leading to inconsistent skill injection and no single source of truth for context assembly.

## Solution

A **ContextStagingPort** in the workflow hexagon that assembles a structured `ContextPackage` for each agent dispatch. The port abstracts context assembly behind a clean contract, allowing the adapter to evolve (memory tiers, compressor, guardrails) without touching domain logic.

## Architecture

### Placement

Context staging lives in the **workflow hexagon** — it's an orchestration concern. The workflow knows the current phase and drives dispatches.

### Data Flow

Context staging is **decoupled from phase transition**. The `OrchestratePhaseTransitionUseCase` handles transitions only. The extension/command calls `ContextStagingPort.stage()` independently after a successful transition, using task/slice data it already has.

```
Extension / Command (caller):
  1. OrchestratePhaseTransitionUseCase.execute(input) -> PhaseTransitionResult
  2. IF transition succeeded AND phase is active:
     ContextStagingPort.stage(request)  [built from task/slice data the caller has]
       -> selectSkillsForPhase(phase)          [pure, uses ACTIVE_PHASES]
       -> resolveAgentType(phase)              [pure, phase-to-agent mapping]
       -> ModelProfileResolverPort.resolveForPhase(phase, complexity)  [cross-hexagon]
       -> buildTaskPrompt(description, ac)     [pure]
     <- Result<ContextPackage, ContextStagingError>
  3. Use ContextPackage for agent dispatch
```

This separation means `PhaseTransitionInput` and `PhaseTransitionResult` remain unchanged. The extension/command owns the orchestration of transition + staging + dispatch.

## Design

### ContextPackage Value Object

```typescript
// workflow/domain/context-package.schemas.ts

export const SKILL_NAMES = {
  BRAINSTORMING: 'brainstorming',
  WRITING_PLANS: 'writing-plans',
  STRESS_TESTING_SPECS: 'stress-testing-specs',
  TEST_DRIVEN_DEVELOPMENT: 'test-driven-development',
  HEXAGONAL_ARCHITECTURE: 'hexagonal-architecture',
  COMMIT_CONVENTIONS: 'commit-conventions',
  SYSTEMATIC_DEBUGGING: 'systematic-debugging',
  RESEARCH_METHODOLOGY: 'research-methodology',
  ACCEPTANCE_CRITERIA_VALIDATION: 'acceptance-criteria-validation',
  VERIFICATION_BEFORE_COMPLETION: 'verification-before-completion',
  CODE_REVIEW_PROTOCOL: 'code-review-protocol',
  ARCHITECTURE_REVIEW: 'architecture-review',
  FINISHING_WORK: 'finishing-work',
} as const;

export const SkillNameSchema = z.enum([...Object.values(SKILL_NAMES)]);
export type SkillName = z.infer<typeof SkillNameSchema>;

export const SkillTypeSchema = z.enum(['rigid', 'flexible']);
export type SkillType = z.infer<typeof SkillTypeSchema>;

export const SkillReferenceSchema = z.object({
  name: SkillNameSchema,
  type: SkillTypeSchema,
});
export type SkillReference = z.infer<typeof SkillReferenceSchema>;

export const ContextPackagePropsSchema = z.object({
  phase: WorkflowPhaseSchema,
  sliceId: IdSchema,
  taskId: IdSchema.optional(),
  skills: z.array(SkillReferenceSchema).max(3),
  agentType: AgentTypeSchema,
  modelProfile: ModelProfileNameSchema,
  filePaths: z.array(z.string()),
  taskPrompt: z.string(),
});
export type ContextPackageProps = z.infer<typeof ContextPackagePropsSchema>;
```

**ContextPackage class:**

```typescript
// workflow/domain/context-package.value-object.ts

export class ContextPackage extends ValueObject<ContextPackageProps> {
  static create(props: ContextPackageProps): ContextPackage {
    return new ContextPackage(ContextPackagePropsSchema.parse(props));
  }

  get phase(): WorkflowPhase { return this.props.phase; }
  get sliceId(): string { return this.props.sliceId; }
  get taskId(): string | undefined { return this.props.taskId; }
  get skills(): SkillReference[] { return this.props.skills; }
  get agentType(): AgentType { return this.props.agentType; }
  get modelProfile(): ModelProfileName { return this.props.modelProfile; }
  get filePaths(): string[] { return this.props.filePaths; }
  get taskPrompt(): string { return this.props.taskPrompt; }
}
```

### PhaseSkillMap + Selection Logic

```typescript
// workflow/domain/phase-skill-map.ts

export const SKILL_REGISTRY: Record<SkillName, SkillType> = {
  brainstorming: 'flexible',
  'writing-plans': 'rigid',
  'stress-testing-specs': 'flexible',
  'test-driven-development': 'rigid',
  'hexagonal-architecture': 'flexible',
  'commit-conventions': 'rigid',
  'systematic-debugging': 'rigid',
  'research-methodology': 'flexible',
  'acceptance-criteria-validation': 'rigid',
  'verification-before-completion': 'rigid',
  'code-review-protocol': 'rigid',
  'architecture-review': 'flexible',
  'finishing-work': 'flexible',
};

export const PHASE_SKILL_MAP: Record<WorkflowPhase, SkillName[]> = {
  idle: [],
  discussing: ['brainstorming'],
  researching: ['research-methodology'],
  planning: ['writing-plans', 'stress-testing-specs'],
  executing: ['test-driven-development', 'hexagonal-architecture', 'commit-conventions'],
  verifying: ['acceptance-criteria-validation', 'verification-before-completion'],
  reviewing: ['code-review-protocol'],
  shipping: ['finishing-work', 'commit-conventions'],
  'completing-milestone': [],
  paused: [],
  blocked: [],
};

const MAX_SKILLS_PER_DISPATCH = 3;

export function selectSkillsForPhase(phase: WorkflowPhase): SkillReference[] {
  const names = PHASE_SKILL_MAP[phase];
  const refs = names.map((name) => ({ name, type: SKILL_REGISTRY[name] }));
  const sorted = refs.sort((a, b) => {
    if (a.type === 'rigid' && b.type !== 'rigid') return -1;
    if (a.type !== 'rigid' && b.type === 'rigid') return 1;
    return 0;
  });
  return sorted.slice(0, MAX_SKILLS_PER_DISPATCH);
}
```

### ContextStagingPort

```typescript
// workflow/domain/ports/context-staging.port.ts

export const ContextStagingRequestSchema = z.object({
  phase: WorkflowPhaseSchema,
  sliceId: IdSchema,
  taskId: IdSchema.optional(),
  complexity: ComplexityTierSchema,
  filePaths: z.array(z.string()),
  taskDescription: z.string(),
  acceptanceCriteria: z.array(z.string()),
});
export type ContextStagingRequest = z.infer<typeof ContextStagingRequestSchema>;

export abstract class ContextStagingPort {
  abstract stage(request: ContextStagingRequest): Promise<Result<ContextPackage, ContextStagingError>>;
}
```

### ModelProfileResolverPort (Cross-Hexagon to Settings)

```typescript
// workflow/domain/ports/model-profile-resolver.port.ts

export abstract class ModelProfileResolverPort {
  abstract resolveForPhase(phase: WorkflowPhase, complexity: ComplexityTier): Promise<ModelProfileName>;
}
```

### Error Types

```typescript
// workflow/domain/errors/context-staging.error.ts

export abstract class ContextStagingError extends BaseDomainError {}

export class InvalidPhaseForStagingError extends ContextStagingError {
  readonly code = 'CONTEXT_STAGING.INVALID_PHASE';
  constructor(phase: string) {
    super(`Cannot stage context for non-active phase: ${phase}`);
  }
}
```

Note: `NoSkillsForPhaseError` was removed — every active phase maps to at least 1 skill in `PHASE_SKILL_MAP`. An empty skill array is a valid result (returned as `skills: []`), not an error.

### InMemory Adapter

```typescript
// workflow/infrastructure/in-memory-context-staging.adapter.ts

export class InMemoryContextStagingAdapter extends ContextStagingPort {
  constructor(private readonly deps: { modelProfileResolver: ModelProfileResolverPort }) {
    super();
  }

  async stage(request: ContextStagingRequest): Promise<Result<ContextPackage, ContextStagingError>> {
    const { phase, sliceId, taskId, complexity, filePaths, taskDescription, acceptanceCriteria } = request;

    if (!isActivePhase(phase)) {
      return { ok: false, error: new InvalidPhaseForStagingError(phase) };
    }

    const skills = selectSkillsForPhase(phase);
    const agentType = resolveAgentType(phase);
    const modelProfile = await this.deps.modelProfileResolver.resolveForPhase(phase, complexity);
    const taskPrompt = buildTaskPrompt(taskDescription, acceptanceCriteria);

    return {
      ok: true,
      data: ContextPackage.create({
        phase, sliceId, taskId, skills, agentType, modelProfile, filePaths, taskPrompt,
      }),
    };
  }
}
```

### Helper Functions

```typescript
// workflow/domain/context-package.helpers.ts
import { ACTIVE_PHASES } from './transition-table';

/** Reuses ACTIVE_PHASES from transition-table.ts — single source of truth */
export function isActivePhase(phase: WorkflowPhase): boolean {
  return ACTIVE_PHASES.has(phase);
}

/**
 * Maps phase to the PRIMARY agent type for single-agent dispatch.
 * Default is 'fixer' — the general-purpose execution agent.
 *
 * Note: the reviewing phase actually needs 3 agents (code-reviewer,
 * security-auditor, spec-reviewer) dispatched in parallel per
 * Improvement D (M04). This map returns the primary agent only.
 * Multi-agent dispatch is handled by ConductReviewUseCase in M04.
 */
export const PHASE_AGENT_MAP: Partial<Record<WorkflowPhase, AgentType>> = {
  reviewing: 'code-reviewer',
  verifying: 'spec-reviewer',
};

export function resolveAgentType(phase: WorkflowPhase): AgentType {
  return PHASE_AGENT_MAP[phase] ?? 'fixer';
}

/**
 * Assembles task prompt from description + acceptance criteria.
 * Empty description or empty AC array are valid — returns minimal prompt.
 */
export function buildTaskPrompt(description: string, acceptanceCriteria: string[]): string {
  const acSection = acceptanceCriteria.length > 0
    ? `\n\n## Acceptance Criteria\n${acceptanceCriteria.map((ac, i) => `${i + 1}. ${ac}`).join('\n')}`
    : '';
  return `${description}${acSection}`;
}
```

### Integration Pattern

Context staging is **decoupled** from `OrchestratePhaseTransitionUseCase`. The use case's `PhaseTransitionInput` and `PhaseTransitionResult` remain unchanged.

The extension/command (caller) orchestrates the sequence:

```typescript
// In the PI extension or command handler:
// 1. Transition phase (existing use case, unchanged)
const transitionResult = await orchestratePhaseTransition.execute({
  milestoneId, trigger, guardContext,
});
if (!transitionResult.ok) return transitionResult;

// 2. Stage context (new — only for active phases that need dispatch)
if (isActivePhase(transitionResult.data.toPhase) && taskInfo) {
  const contextResult = await contextStaging.stage({
    phase: transitionResult.data.toPhase,
    sliceId: session.sliceId,
    taskId: taskInfo.id,
    complexity: slice.complexity,
    filePaths: taskInfo.filePaths,
    taskDescription: taskInfo.description,
    acceptanceCriteria: taskInfo.acceptanceCriteria,
  });
  // 3. Use contextResult.data for agent dispatch
}
```

**Why decoupled:** The use case handles phase transitions with domain events and slice status sync. Context staging needs task-level data (filePaths, description, AC) that the transition use case shouldn't know about. The caller (extension/command) has this data naturally.

`WorkflowExtensionDeps` gains `contextStaging: ContextStagingPort` for the extension to wire at startup.

## File Layout

```
src/hexagons/workflow/
  domain/
    context-package.schemas.ts
    context-package.value-object.ts
    context-package.value-object.spec.ts
    context-package.builder.ts
    context-package.helpers.ts
    context-package.helpers.spec.ts
    phase-skill-map.ts
    phase-skill-map.spec.ts
    errors/
      context-staging.error.ts
    ports/
      context-staging.port.ts
      model-profile-resolver.port.ts
  infrastructure/
    in-memory-context-staging.adapter.ts
    in-memory-context-staging.adapter.spec.ts
```

12 new files: 6 domain, 2 infrastructure, 4 test specs.

## Barrel Exports

From `workflow/index.ts`:
- `ContextPackage`, `ContextPackagePropsSchema`, `SKILL_NAMES`, `SkillNameSchema`, `SkillReferenceSchema`
- `PHASE_SKILL_MAP`, `SKILL_REGISTRY`, `selectSkillsForPhase`
- `ContextStagingPort`, `ContextStagingRequestSchema`
- `ModelProfileResolverPort`
- `ContextStagingError`, `InvalidPhaseForStagingError`
- `InMemoryContextStagingAdapter`
- `isActivePhase`, `resolveAgentType`, `buildTaskPrompt`, `PHASE_AGENT_MAP`

## Acceptance Criteria

1. **AC1 — ContextPackage VO:** `ContextPackage.create()` produces a valid value object with skills, agentType, modelProfile, filePaths, taskPrompt. Structural equality via `equals()`.
2. **AC2 — PhaseSkillMap:** Every active phase maps to 0-3 skills. `selectSkillsForPhase()` returns skills sorted rigid-first, capped at 3. Non-active phases return empty array.
3. **AC3 — Skill Registry:** 13 phase-injected skills registered with correct rigid/flexible classification. `SKILL_NAMES` const provides compile-time safety. The remaining 5 of the 18 TFF-CC methodology skills (not phase-bound) will be added when the Intelligence hexagon is built (M05).
4. **AC4 — ContextStagingPort contract:** `stage()` accepts a `ContextStagingRequest` and returns `Result<ContextPackage, ContextStagingError>`. Non-active phases (idle, paused, blocked, completing-milestone) return `InvalidPhaseForStagingError`.
5. **AC5 — ModelProfileResolverPort:** Cross-hexagon port resolves phase + complexity to `Promise<ModelProfileName>`. An in-memory stub is used for testing; the production adapter lives in `workflow/infrastructure/` and wraps settings hexagon's `ResolveModelUseCase`.
6. **AC6 — InMemory adapter:** Passes all domain logic tests. Uses `selectSkillsForPhase()`, `resolveAgentType()`, `buildTaskPrompt()`. Produces valid `ContextPackage` for every active phase.
7. **AC7 — Decoupled integration:** Context staging is callable independently from phase transition via `ContextStagingPort.stage()`. The extension/command calls it after a successful `OrchestratePhaseTransitionUseCase.execute()`, providing task-level data (filePaths, description, AC, complexity) from its own context. `PhaseTransitionInput` and `PhaseTransitionResult` remain unchanged. `WorkflowExtensionDeps` gains `contextStaging: ContextStagingPort`.
8. **AC8 — Builder:** `ContextPackageBuilder` supports fluent construction with faker defaults for testing.
9. **AC9 — Barrel exports:** All public types, ports, errors, and the in-memory adapter exported from `workflow/index.ts`.
10. **AC10 — isActivePhase consistency:** `isActivePhase()` delegates to the canonical `ACTIVE_PHASES` set from `transition-table.ts`. No duplicate hardcoded list.
11. **AC11 — Phase-to-agent mapping:** `resolveAgentType()` returns `code-reviewer` for reviewing, `spec-reviewer` for verifying, and `fixer` (default) for all other active phases. `PHASE_AGENT_MAP` is exported and testable.
12. **AC12 — buildTaskPrompt edge cases:** Empty description produces valid prompt. Empty acceptanceCriteria array produces prompt without AC section.

## Dependencies

- **Depends on:** Kernel (Result, BaseDomainError, IdSchema, ValueObject, ComplexityTierSchema, ModelProfileNameSchema, AgentTypeSchema), Settings hexagon (production adapter for ModelProfileResolverPort)
- **Depended by:** Execution hexagon (M03 future slices), Review hexagon (M04)

## Design Decisions

1. **Port over pure functions:** ContextStagingPort enables future growth (memory tiers, compressor, guardrails) without domain changes.
2. **Skill identifiers, not content:** Context package carries skill names. Adapter resolves to markdown at dispatch time. Domain stays free of file I/O.
3. **Typed skill registry:** SKILL_NAMES const + SkillNameSchema prevent typo-based mapping failures at compile time.
4. **Decoupled from phase transition:** Context staging is callable independently — the extension/command orchestrates transition + staging + dispatch. This keeps `PhaseTransitionInput` clean and avoids forcing task-level data through the transition pipeline.
5. **Cross-hexagon via port:** ModelProfileResolverPort keeps model routing in settings hexagon while workflow consumes it cleanly.
6. **Research methodology skill:** Added to fill the gap in the researching phase — guides structured exploration and RESEARCH.md output format. The main design spec's Skill Injection Contract table (which shows `researching: none`) should be updated to reflect this addition.
7. **Reuse ACTIVE_PHASES:** `isActivePhase()` delegates to the canonical `ACTIVE_PHASES` set from transition-table.ts — single source of truth, no duplicate lists.
8. **Default agent type is fixer:** Most phases use the general-purpose `fixer` agent. Only `reviewing` (code-reviewer) and `verifying` (spec-reviewer) override. This is intentional — the execution hexagon's dispatch adapter will further specialize based on task metadata.
9. **Single agent type per package:** `agentType` is singular, not an array. Multi-agent dispatch for the reviewing phase (code-reviewer + security-auditor + spec-reviewer in parallel) is Improvement D scope (M04). The review use case will create 3 separate `ContextPackage` instances, one per reviewer role.
10. **No metadata field (YAGNI):** Removed the `metadata: Record<string, unknown>` extensibility field. Future consumers (memory tiers, compressor) will extend the schema when they arrive — adding an optional field is backwards-compatible.
