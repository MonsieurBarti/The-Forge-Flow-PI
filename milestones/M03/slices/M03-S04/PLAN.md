# M03-S04: Context Staging Area — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Build a ContextStagingPort in the workflow hexagon that assembles structured ContextPackage value objects for agent dispatch, with phase-aware skill injection, model profile resolution, and agent type mapping.

**Architecture:** Workflow hexagon domain layer — ports, value objects, helpers, and in-memory adapter. Decoupled from phase transition use case.

**Tech Stack:** TypeScript, Zod, Vitest, @faker-js/faker

## File Structure

### Create (13 files)

| File | Responsibility |
|---|---|
| `src/hexagons/workflow/domain/context-package.schemas.ts` | Zod schemas: SkillName, SkillType, SkillReference, ContextPackageProps |
| `src/hexagons/workflow/domain/errors/context-staging.error.ts` | ContextStagingError base + InvalidPhaseForStagingError |
| `src/hexagons/workflow/domain/ports/model-profile-resolver.port.ts` | Abstract port for cross-hexagon model resolution |
| `src/hexagons/workflow/domain/phase-skill-map.ts` | SKILL_REGISTRY, PHASE_SKILL_MAP, selectSkillsForPhase() |
| `src/hexagons/workflow/domain/phase-skill-map.spec.ts` | Tests for PhaseSkillMap |
| `src/hexagons/workflow/domain/context-package.value-object.ts` | ContextPackage value object |
| `src/hexagons/workflow/domain/context-package.value-object.spec.ts` | Tests for ContextPackage VO |
| `src/hexagons/workflow/domain/context-package.helpers.ts` | isActivePhase, resolveAgentType, buildTaskPrompt, PHASE_AGENT_MAP |
| `src/hexagons/workflow/domain/context-package.helpers.spec.ts` | Tests for helpers |
| `src/hexagons/workflow/domain/context-package.builder.ts` | Builder with faker defaults for testing |
| `src/hexagons/workflow/domain/ports/context-staging.port.ts` | ContextStagingPort + ContextStagingRequest schema |
| `src/hexagons/workflow/infrastructure/in-memory-context-staging.adapter.ts` | InMemory adapter implementation |
| `src/hexagons/workflow/infrastructure/in-memory-context-staging.adapter.spec.ts` | Tests for InMemory adapter |

### Modify (3 files)

| File | Change |
|---|---|
| `src/hexagons/workflow/index.ts` | Add barrel exports for all new types |
| `src/hexagons/workflow/infrastructure/pi/workflow.extension.ts` | Add `contextStaging: ContextStagingPort` to WorkflowExtensionDeps |
| `src/hexagons/workflow/infrastructure/pi/workflow.extension.spec.ts` | Add contextStaging stub to test deps |

---

## Wave 0 — Foundation (parallel, no tests)

### T01: Create context-package schemas

**File:** Create `src/hexagons/workflow/domain/context-package.schemas.ts`
**Traces to:** AC1, AC3

```typescript
import { z } from "zod";
import { AgentTypeSchema, IdSchema, ModelProfileNameSchema } from "@kernel";
import { WorkflowPhaseSchema } from "./workflow-session.schemas";

export const SKILL_NAMES = {
  BRAINSTORMING: "brainstorming",
  WRITING_PLANS: "writing-plans",
  STRESS_TESTING_SPECS: "stress-testing-specs",
  TEST_DRIVEN_DEVELOPMENT: "test-driven-development",
  HEXAGONAL_ARCHITECTURE: "hexagonal-architecture",
  COMMIT_CONVENTIONS: "commit-conventions",
  SYSTEMATIC_DEBUGGING: "systematic-debugging",
  RESEARCH_METHODOLOGY: "research-methodology",
  ACCEPTANCE_CRITERIA_VALIDATION: "acceptance-criteria-validation",
  VERIFICATION_BEFORE_COMPLETION: "verification-before-completion",
  CODE_REVIEW_PROTOCOL: "code-review-protocol",
  ARCHITECTURE_REVIEW: "architecture-review",
  FINISHING_WORK: "finishing-work",
} as const;

export const SkillNameSchema = z.enum([
  SKILL_NAMES.BRAINSTORMING,
  SKILL_NAMES.WRITING_PLANS,
  SKILL_NAMES.STRESS_TESTING_SPECS,
  SKILL_NAMES.TEST_DRIVEN_DEVELOPMENT,
  SKILL_NAMES.HEXAGONAL_ARCHITECTURE,
  SKILL_NAMES.COMMIT_CONVENTIONS,
  SKILL_NAMES.SYSTEMATIC_DEBUGGING,
  SKILL_NAMES.RESEARCH_METHODOLOGY,
  SKILL_NAMES.ACCEPTANCE_CRITERIA_VALIDATION,
  SKILL_NAMES.VERIFICATION_BEFORE_COMPLETION,
  SKILL_NAMES.CODE_REVIEW_PROTOCOL,
  SKILL_NAMES.ARCHITECTURE_REVIEW,
  SKILL_NAMES.FINISHING_WORK,
]);
export type SkillName = z.infer<typeof SkillNameSchema>;

export const SkillTypeSchema = z.enum(["rigid", "flexible"]);
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

- **Commit:** `feat(S04/T01): add context-package schemas`

---

### T02: Create context-staging error types

**File:** Create `src/hexagons/workflow/domain/errors/context-staging.error.ts`
**Traces to:** AC4

```typescript
import { WorkflowBaseError } from "./workflow-base.error";

export abstract class ContextStagingError extends WorkflowBaseError {}

export class InvalidPhaseForStagingError extends ContextStagingError {
  readonly code = "CONTEXT_STAGING.INVALID_PHASE";

  constructor(phase: string) {
    super(`Cannot stage context for non-active phase: ${phase}`, { phase });
  }
}
```

- **Commit:** `feat(S04/T02): add context-staging error types`

---

### T03: Create ModelProfileResolverPort

**File:** Create `src/hexagons/workflow/domain/ports/model-profile-resolver.port.ts`
**Traces to:** AC5

```typescript
import type { ComplexityTier, ModelProfileName } from "@kernel";
import type { WorkflowPhase } from "../workflow-session.schemas";

export abstract class ModelProfileResolverPort {
  abstract resolveForPhase(
    phase: WorkflowPhase,
    complexity: ComplexityTier,
  ): Promise<ModelProfileName>;
}
```

- **Commit:** `feat(S04/T03): add ModelProfileResolverPort`

---

## Wave 1 — Core domain tests (parallel)

### T04: Write failing tests for PhaseSkillMap

**File:** Create `src/hexagons/workflow/domain/phase-skill-map.spec.ts`
**Traces to:** AC2, AC3

```typescript
import { describe, expect, it } from "vitest";
import {
  PHASE_SKILL_MAP,
  selectSkillsForPhase,
  SKILL_REGISTRY,
} from "./phase-skill-map";
import { ACTIVE_PHASES } from "./transition-table";
import { SKILL_NAMES } from "./context-package.schemas";

describe("PhaseSkillMap", () => {
  describe("SKILL_REGISTRY", () => {
    it("contains exactly 13 skills", () => {
      expect(Object.keys(SKILL_REGISTRY)).toHaveLength(13);
    });

    it("classifies all SKILL_NAMES values", () => {
      for (const name of Object.values(SKILL_NAMES)) {
        expect(SKILL_REGISTRY[name]).toBeDefined();
      }
    });

    it("classifies brainstorming as flexible", () => {
      expect(SKILL_REGISTRY.brainstorming).toBe("flexible");
    });

    it("classifies test-driven-development as rigid", () => {
      expect(SKILL_REGISTRY["test-driven-development"]).toBe("rigid");
    });

    it("classifies writing-plans as rigid", () => {
      expect(SKILL_REGISTRY["writing-plans"]).toBe("rigid");
    });
  });

  describe("PHASE_SKILL_MAP", () => {
    it("covers all 11 workflow phases", () => {
      expect(Object.keys(PHASE_SKILL_MAP)).toHaveLength(11);
    });

    it("maps non-active phases to empty arrays", () => {
      expect(PHASE_SKILL_MAP.idle).toEqual([]);
      expect(PHASE_SKILL_MAP.paused).toEqual([]);
      expect(PHASE_SKILL_MAP.blocked).toEqual([]);
      expect(PHASE_SKILL_MAP["completing-milestone"]).toEqual([]);
    });

    it("maps discussing to brainstorming", () => {
      expect(PHASE_SKILL_MAP.discussing).toEqual(["brainstorming"]);
    });

    it("maps executing to TDD + hexagonal + commit skills", () => {
      expect(PHASE_SKILL_MAP.executing).toEqual([
        "test-driven-development",
        "hexagonal-architecture",
        "commit-conventions",
      ]);
    });

    it("maps no phase to more than 3 skills", () => {
      for (const skills of Object.values(PHASE_SKILL_MAP)) {
        expect(skills.length).toBeLessThanOrEqual(3);
      }
    });
  });

  describe("selectSkillsForPhase", () => {
    it("returns empty array for idle", () => {
      expect(selectSkillsForPhase("idle")).toEqual([]);
    });

    it("returns skills sorted rigid-first for executing", () => {
      const skills = selectSkillsForPhase("executing");
      expect(skills).toHaveLength(3);
      expect(skills[0].type).toBe("rigid");
      expect(skills[0].name).toBe("test-driven-development");
      expect(skills[1].type).toBe("rigid");
      expect(skills[1].name).toBe("commit-conventions");
      expect(skills[2].type).toBe("flexible");
      expect(skills[2].name).toBe("hexagonal-architecture");
    });

    it("returns skills for every active phase", () => {
      for (const phase of ACTIVE_PHASES) {
        const skills = selectSkillsForPhase(phase);
        expect(skills.length).toBeGreaterThan(0);
      }
    });

    it("caps at 3 skills", () => {
      for (const phase of ACTIVE_PHASES) {
        expect(selectSkillsForPhase(phase).length).toBeLessThanOrEqual(3);
      }
    });

    it("returns SkillReference objects with name and type", () => {
      const skills = selectSkillsForPhase("planning");
      for (const skill of skills) {
        expect(skill).toHaveProperty("name");
        expect(skill).toHaveProperty("type");
      }
    });
  });
});
```

- **Run:** `npx vitest run src/hexagons/workflow/domain/phase-skill-map.spec.ts`
- **Expect:** FAIL — module `./phase-skill-map` not found

---

### T05: Write failing tests for ContextPackage VO

**File:** Create `src/hexagons/workflow/domain/context-package.value-object.spec.ts`
**Traces to:** AC1

```typescript
import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";
import type { ContextPackageProps } from "./context-package.schemas";
import { ContextPackage } from "./context-package.value-object";

function validProps(overrides?: Partial<ContextPackageProps>): ContextPackageProps {
  return {
    phase: "executing",
    sliceId: faker.string.uuid(),
    skills: [{ name: "test-driven-development", type: "rigid" }],
    agentType: "fixer",
    modelProfile: "balanced",
    filePaths: ["src/foo.ts"],
    taskPrompt: "Implement the feature",
    ...overrides,
  };
}

describe("ContextPackage", () => {
  describe("create", () => {
    it("creates a valid ContextPackage with all fields", () => {
      const props = validProps();
      const pkg = ContextPackage.create(props);
      expect(pkg.phase).toBe("executing");
      expect(pkg.sliceId).toBe(props.sliceId);
      expect(pkg.skills).toEqual([{ name: "test-driven-development", type: "rigid" }]);
      expect(pkg.agentType).toBe("fixer");
      expect(pkg.modelProfile).toBe("balanced");
      expect(pkg.filePaths).toEqual(["src/foo.ts"]);
      expect(pkg.taskPrompt).toBe("Implement the feature");
    });

    it("creates a ContextPackage with optional taskId", () => {
      const taskId = faker.string.uuid();
      const pkg = ContextPackage.create(validProps({ taskId }));
      expect(pkg.taskId).toBe(taskId);
    });

    it("creates a ContextPackage without taskId", () => {
      const pkg = ContextPackage.create(validProps());
      expect(pkg.taskId).toBeUndefined();
    });

    it("accepts empty skills array", () => {
      const pkg = ContextPackage.create(validProps({ skills: [] }));
      expect(pkg.skills).toEqual([]);
    });

    it("accepts up to 3 skills", () => {
      const pkg = ContextPackage.create(
        validProps({
          skills: [
            { name: "test-driven-development", type: "rigid" },
            { name: "hexagonal-architecture", type: "flexible" },
            { name: "commit-conventions", type: "rigid" },
          ],
        }),
      );
      expect(pkg.skills).toHaveLength(3);
    });

    it("rejects more than 3 skills", () => {
      expect(() =>
        ContextPackage.create(
          validProps({
            skills: [
              { name: "test-driven-development", type: "rigid" },
              { name: "hexagonal-architecture", type: "flexible" },
              { name: "commit-conventions", type: "rigid" },
              { name: "brainstorming", type: "flexible" },
            ],
          }),
        ),
      ).toThrow();
    });

    it("rejects invalid phase", () => {
      expect(() =>
        ContextPackage.create(
          Object.assign(validProps(), { phase: "invalid-phase" }),
        ),
      ).toThrow();
    });

    it("rejects invalid sliceId (non-UUID)", () => {
      expect(() =>
        ContextPackage.create(
          Object.assign(validProps(), { sliceId: "not-a-uuid" }),
        ),
      ).toThrow();
    });
  });

  describe("equals", () => {
    it("returns true for two packages with identical props", () => {
      const props = validProps();
      const a = ContextPackage.create(props);
      const b = ContextPackage.create(props);
      expect(a.equals(b)).toBe(true);
    });

    it("returns false for packages with different phases", () => {
      const base = validProps();
      const a = ContextPackage.create(base);
      const b = ContextPackage.create({ ...base, phase: "planning" });
      expect(a.equals(b)).toBe(false);
    });
  });
});
```

- **Run:** `npx vitest run src/hexagons/workflow/domain/context-package.value-object.spec.ts`
- **Expect:** FAIL — module `./context-package.value-object` not found

---

## Wave 2 — Core domain implementations (parallel)

### T06: Implement PhaseSkillMap

**File:** Create `src/hexagons/workflow/domain/phase-skill-map.ts`
**Traces to:** AC2, AC3

```typescript
import type {
  SkillName,
  SkillReference,
  SkillType,
} from "./context-package.schemas";
import type { WorkflowPhase } from "./workflow-session.schemas";

export const SKILL_REGISTRY: Record<SkillName, SkillType> = {
  brainstorming: "flexible",
  "writing-plans": "rigid",
  "stress-testing-specs": "flexible",
  "test-driven-development": "rigid",
  "hexagonal-architecture": "flexible",
  "commit-conventions": "rigid",
  "systematic-debugging": "rigid",
  "research-methodology": "flexible",
  "acceptance-criteria-validation": "rigid",
  "verification-before-completion": "rigid",
  "code-review-protocol": "rigid",
  "architecture-review": "flexible",
  "finishing-work": "flexible",
};

export const PHASE_SKILL_MAP: Record<WorkflowPhase, SkillName[]> = {
  idle: [],
  discussing: ["brainstorming"],
  researching: ["research-methodology"],
  planning: ["writing-plans", "stress-testing-specs"],
  executing: [
    "test-driven-development",
    "hexagonal-architecture",
    "commit-conventions",
  ],
  verifying: ["acceptance-criteria-validation", "verification-before-completion"],
  reviewing: ["code-review-protocol"],
  shipping: ["finishing-work", "commit-conventions"],
  "completing-milestone": [],
  paused: [],
  blocked: [],
};

const MAX_SKILLS_PER_DISPATCH = 3;

export function selectSkillsForPhase(phase: WorkflowPhase): SkillReference[] {
  const names = PHASE_SKILL_MAP[phase];
  const refs: SkillReference[] = names.map((name) => ({
    name,
    type: SKILL_REGISTRY[name],
  }));
  const sorted = [...refs].sort((a, b) => {
    if (a.type === "rigid" && b.type !== "rigid") return -1;
    if (a.type !== "rigid" && b.type === "rigid") return 1;
    return 0;
  });
  return sorted.slice(0, MAX_SKILLS_PER_DISPATCH);
}
```

- **Run:** `npx vitest run src/hexagons/workflow/domain/phase-skill-map.spec.ts`
- **Expect:** PASS — all PhaseSkillMap tests green
- **Commit:** `feat(S04/T06): add PhaseSkillMap with skill registry and selection`

---

### T07: Implement ContextPackage value object

**File:** Create `src/hexagons/workflow/domain/context-package.value-object.ts`
**Traces to:** AC1

```typescript
import type { AgentType, ModelProfileName } from "@kernel";
import { ValueObject } from "@kernel";
import {
  type ContextPackageProps,
  ContextPackagePropsSchema,
  type SkillReference,
} from "./context-package.schemas";
import type { WorkflowPhase } from "./workflow-session.schemas";

export class ContextPackage extends ValueObject<ContextPackageProps> {
  private constructor(props: ContextPackageProps) {
    super(props, ContextPackagePropsSchema);
  }

  static create(props: ContextPackageProps): ContextPackage {
    return new ContextPackage(props);
  }

  get phase(): WorkflowPhase {
    return this.props.phase;
  }

  get sliceId(): string {
    return this.props.sliceId;
  }

  get taskId(): string | undefined {
    return this.props.taskId;
  }

  get skills(): SkillReference[] {
    return this.props.skills;
  }

  get agentType(): AgentType {
    return this.props.agentType;
  }

  get modelProfile(): ModelProfileName {
    return this.props.modelProfile;
  }

  get filePaths(): string[] {
    return this.props.filePaths;
  }

  get taskPrompt(): string {
    return this.props.taskPrompt;
  }
}
```

- **Run:** `npx vitest run src/hexagons/workflow/domain/context-package.value-object.spec.ts`
- **Expect:** PASS — all ContextPackage VO tests green
- **Commit:** `feat(S04/T07): add ContextPackage value object`

---

## Wave 3 — Mid-layer (parallel)

### T08: Create ContextStagingPort

**File:** Create `src/hexagons/workflow/domain/ports/context-staging.port.ts`
**Traces to:** AC4

```typescript
import { z } from "zod";
import { ComplexityTierSchema, IdSchema, type Result } from "@kernel";
import type { ContextPackage } from "../context-package.value-object";
import type { ContextStagingError } from "../errors/context-staging.error";
import { WorkflowPhaseSchema } from "../workflow-session.schemas";

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
  abstract stage(
    request: ContextStagingRequest,
  ): Promise<Result<ContextPackage, ContextStagingError>>;
}
```

- **Commit:** `feat(S04/T08): add ContextStagingPort and request schema`

---

### T09: Create ContextPackage builder

**File:** Create `src/hexagons/workflow/domain/context-package.builder.ts`
**Traces to:** AC8

```typescript
import { faker } from "@faker-js/faker";
import type {
  ContextPackageProps,
  SkillReference,
} from "./context-package.schemas";
import { ContextPackage } from "./context-package.value-object";
import type { WorkflowPhase } from "./workflow-session.schemas";
import type { AgentType, ModelProfileName } from "@kernel";

export class ContextPackageBuilder {
  private _phase: WorkflowPhase = "executing";
  private _sliceId: string = faker.string.uuid();
  private _taskId: string | undefined = undefined;
  private _skills: SkillReference[] = [
    { name: "test-driven-development", type: "rigid" },
  ];
  private _agentType: AgentType = "fixer";
  private _modelProfile: ModelProfileName = "balanced";
  private _filePaths: string[] = ["src/example.ts"];
  private _taskPrompt: string = faker.lorem.sentence();

  withPhase(phase: WorkflowPhase): this {
    this._phase = phase;
    return this;
  }

  withSliceId(sliceId: string): this {
    this._sliceId = sliceId;
    return this;
  }

  withTaskId(taskId: string): this {
    this._taskId = taskId;
    return this;
  }

  withSkills(skills: SkillReference[]): this {
    this._skills = skills;
    return this;
  }

  withAgentType(agentType: AgentType): this {
    this._agentType = agentType;
    return this;
  }

  withModelProfile(modelProfile: ModelProfileName): this {
    this._modelProfile = modelProfile;
    return this;
  }

  withFilePaths(filePaths: string[]): this {
    this._filePaths = filePaths;
    return this;
  }

  withTaskPrompt(taskPrompt: string): this {
    this._taskPrompt = taskPrompt;
    return this;
  }

  build(): ContextPackage {
    return ContextPackage.create(this.buildProps());
  }

  buildProps(): ContextPackageProps {
    return {
      phase: this._phase,
      sliceId: this._sliceId,
      taskId: this._taskId,
      skills: this._skills,
      agentType: this._agentType,
      modelProfile: this._modelProfile,
      filePaths: this._filePaths,
      taskPrompt: this._taskPrompt,
    };
  }
}
```

- **Commit:** `feat(S04/T09): add ContextPackage builder`

---

### T10: Write failing tests for helpers

**File:** Create `src/hexagons/workflow/domain/context-package.helpers.spec.ts`
**Traces to:** AC10, AC11, AC12

```typescript
import { describe, expect, it } from "vitest";
import {
  buildTaskPrompt,
  isActivePhase,
  PHASE_AGENT_MAP,
  resolveAgentType,
} from "./context-package.helpers";
import { ACTIVE_PHASES } from "./transition-table";
import type { WorkflowPhase } from "./workflow-session.schemas";

describe("context-package helpers", () => {
  describe("isActivePhase", () => {
    it("returns true for all active phases", () => {
      for (const phase of ACTIVE_PHASES) {
        expect(isActivePhase(phase)).toBe(true);
      }
    });

    it("returns false for idle", () => {
      expect(isActivePhase("idle")).toBe(false);
    });

    it("returns false for paused", () => {
      expect(isActivePhase("paused")).toBe(false);
    });

    it("returns false for blocked", () => {
      expect(isActivePhase("blocked")).toBe(false);
    });

    it("returns false for completing-milestone", () => {
      expect(isActivePhase("completing-milestone")).toBe(false);
    });

    it("delegates to ACTIVE_PHASES from transition-table", () => {
      const allPhases: WorkflowPhase[] = [
        "idle",
        "discussing",
        "researching",
        "planning",
        "executing",
        "verifying",
        "reviewing",
        "shipping",
        "completing-milestone",
        "paused",
        "blocked",
      ];
      for (const phase of allPhases) {
        expect(isActivePhase(phase)).toBe(ACTIVE_PHASES.has(phase));
      }
    });
  });

  describe("resolveAgentType", () => {
    it("returns code-reviewer for reviewing", () => {
      expect(resolveAgentType("reviewing")).toBe("code-reviewer");
    });

    it("returns spec-reviewer for verifying", () => {
      expect(resolveAgentType("verifying")).toBe("spec-reviewer");
    });

    it("returns fixer for executing", () => {
      expect(resolveAgentType("executing")).toBe("fixer");
    });

    it("returns fixer for discussing", () => {
      expect(resolveAgentType("discussing")).toBe("fixer");
    });

    it("returns fixer for all phases not in PHASE_AGENT_MAP", () => {
      const phasesWithDefault: WorkflowPhase[] = [
        "idle",
        "discussing",
        "researching",
        "planning",
        "executing",
        "shipping",
        "completing-milestone",
        "paused",
        "blocked",
      ];
      for (const phase of phasesWithDefault) {
        expect(resolveAgentType(phase)).toBe("fixer");
      }
    });
  });

  describe("PHASE_AGENT_MAP", () => {
    it("only overrides reviewing and verifying", () => {
      expect(Object.keys(PHASE_AGENT_MAP)).toHaveLength(2);
      expect(PHASE_AGENT_MAP.reviewing).toBe("code-reviewer");
      expect(PHASE_AGENT_MAP.verifying).toBe("spec-reviewer");
    });
  });

  describe("buildTaskPrompt", () => {
    it("builds prompt with description and acceptance criteria", () => {
      const result = buildTaskPrompt("Do the thing", ["It works", "It passes"]);
      expect(result).toContain("Do the thing");
      expect(result).toContain("## Acceptance Criteria");
      expect(result).toContain("1. It works");
      expect(result).toContain("2. It passes");
    });

    it("builds prompt without AC section when criteria array is empty", () => {
      const result = buildTaskPrompt("Do the thing", []);
      expect(result).toBe("Do the thing");
      expect(result).not.toContain("Acceptance Criteria");
    });

    it("handles empty description", () => {
      const result = buildTaskPrompt("", ["Criterion"]);
      expect(result).toContain("## Acceptance Criteria");
      expect(result).toContain("1. Criterion");
    });

    it("handles empty description and empty criteria", () => {
      const result = buildTaskPrompt("", []);
      expect(result).toBe("");
    });
  });
});
```

- **Run:** `npx vitest run src/hexagons/workflow/domain/context-package.helpers.spec.ts`
- **Expect:** FAIL — module `./context-package.helpers` not found

---

## Wave 4 — Helpers + extension deps (parallel)

### T11: Implement context-package helpers

**File:** Create `src/hexagons/workflow/domain/context-package.helpers.ts`
**Traces to:** AC10, AC11, AC12

```typescript
import type { AgentType } from "@kernel";
import { ACTIVE_PHASES } from "./transition-table";
import type { WorkflowPhase } from "./workflow-session.schemas";

export function isActivePhase(phase: WorkflowPhase): boolean {
  return ACTIVE_PHASES.has(phase);
}

export const PHASE_AGENT_MAP: Partial<Record<WorkflowPhase, AgentType>> = {
  reviewing: "code-reviewer",
  verifying: "spec-reviewer",
};

export function resolveAgentType(phase: WorkflowPhase): AgentType {
  return PHASE_AGENT_MAP[phase] ?? "fixer";
}

export function buildTaskPrompt(
  description: string,
  acceptanceCriteria: string[],
): string {
  const acSection =
    acceptanceCriteria.length > 0
      ? `\n\n## Acceptance Criteria\n${acceptanceCriteria.map((ac, i) => `${i + 1}. ${ac}`).join("\n")}`
      : "";
  return `${description}${acSection}`;
}
```

- **Run:** `npx vitest run src/hexagons/workflow/domain/context-package.helpers.spec.ts`
- **Expect:** PASS — all helpers tests green
- **Commit:** `feat(S04/T11): add context-package helpers`

---

### T15: Update WorkflowExtensionDeps

**File:** Modify `src/hexagons/workflow/infrastructure/pi/workflow.extension.ts`
**File:** Modify `src/hexagons/workflow/infrastructure/pi/workflow.extension.spec.ts`
**Traces to:** AC7

Add import and new field to the interface:

```typescript
// Add to imports at top of workflow.extension.ts:
import type { ContextStagingPort } from "../../domain/ports/context-staging.port";

// Update WorkflowExtensionDeps interface:
export interface WorkflowExtensionDeps {
  projectRepo: ProjectRepositoryPort;
  milestoneRepo: MilestoneRepositoryPort;
  sliceRepo: SliceRepositoryPort;
  taskRepo: TaskRepositoryPort;
  sliceTransitionPort: SliceTransitionPort;
  eventBus: EventBusPort;
  dateProvider: DateProviderPort;
  contextStaging: ContextStagingPort;
}
```

Update the test file to provide a stub:

```typescript
// Add to imports at top of workflow.extension.spec.ts:
import type { ComplexityTier, ModelProfileName, Result } from "@kernel";
import { ContextStagingPort } from "../../domain/ports/context-staging.port";
import type { ContextPackage } from "../../domain/context-package.value-object";
import type { ContextStagingError } from "../../domain/errors/context-staging.error";
import type { WorkflowPhase } from "../../domain/workflow-session.schemas";

// Add stub class before describe block:
class StubContextStaging extends ContextStagingPort {
  async stage(): Promise<Result<ContextPackage, ContextStagingError>> {
    throw new Error("Not implemented");
  }
}

// In each test's deps object, add:
//   contextStaging: new StubContextStaging(),
```

- **Run:** `npx vitest run src/hexagons/workflow/infrastructure/pi/workflow.extension.spec.ts`
- **Expect:** PASS — existing tests still green with new required field
- **Commit:** `feat(S04/T15): add contextStaging to WorkflowExtensionDeps`

---

## Wave 5 — Adapter test

### T12: Write failing tests for InMemory adapter

**File:** Create `src/hexagons/workflow/infrastructure/in-memory-context-staging.adapter.spec.ts`
**Traces to:** AC4, AC6

```typescript
import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";
import type { ComplexityTier, ModelProfileName } from "@kernel";
import { ContextPackageBuilder } from "../domain/context-package.builder";
import type { ContextStagingRequest } from "../domain/ports/context-staging.port";
import { ModelProfileResolverPort } from "../domain/ports/model-profile-resolver.port";
import type { WorkflowPhase } from "../domain/workflow-session.schemas";
import { ACTIVE_PHASES } from "../domain/transition-table";
import { InMemoryContextStagingAdapter } from "./in-memory-context-staging.adapter";

class StubModelProfileResolver extends ModelProfileResolverPort {
  readonly lastCall: { phase?: WorkflowPhase; complexity?: ComplexityTier } = {};

  async resolveForPhase(
    phase: WorkflowPhase,
    complexity: ComplexityTier,
  ): Promise<ModelProfileName> {
    this.lastCall.phase = phase;
    this.lastCall.complexity = complexity;
    return "balanced";
  }
}

function validRequest(overrides?: Partial<ContextStagingRequest>): ContextStagingRequest {
  return {
    phase: "executing",
    sliceId: faker.string.uuid(),
    complexity: "F-lite",
    filePaths: ["src/foo.ts"],
    taskDescription: "Implement the feature",
    acceptanceCriteria: ["It works"],
    ...overrides,
  };
}

describe("InMemoryContextStagingAdapter", () => {
  function createSut() {
    const resolver = new StubModelProfileResolver();
    const adapter = new InMemoryContextStagingAdapter({
      modelProfileResolver: resolver,
    });
    return { adapter, resolver };
  }

  describe("stage — active phases", () => {
    it("returns a valid ContextPackage for executing", async () => {
      const { adapter } = createSut();
      const result = await adapter.stage(validRequest({ phase: "executing" }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.phase).toBe("executing");
        expect(result.data.agentType).toBe("fixer");
        expect(result.data.modelProfile).toBe("balanced");
        expect(result.data.skills.length).toBeGreaterThan(0);
      }
    });

    it("produces valid ContextPackage for every active phase", async () => {
      const { adapter } = createSut();
      for (const phase of ACTIVE_PHASES) {
        const result = await adapter.stage(validRequest({ phase }));
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.phase).toBe(phase);
        }
      }
    });

    it("passes phase and complexity to ModelProfileResolverPort", async () => {
      const { adapter, resolver } = createSut();
      await adapter.stage(validRequest({ phase: "planning", complexity: "F-full" }));
      expect(resolver.lastCall.phase).toBe("planning");
      expect(resolver.lastCall.complexity).toBe("F-full");
    });

    it("includes taskId when provided", async () => {
      const { adapter } = createSut();
      const taskId = faker.string.uuid();
      const result = await adapter.stage(validRequest({ taskId }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.taskId).toBe(taskId);
      }
    });

    it("builds task prompt from description and criteria", async () => {
      const { adapter } = createSut();
      const result = await adapter.stage(
        validRequest({
          taskDescription: "Do X",
          acceptanceCriteria: ["AC1", "AC2"],
        }),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.taskPrompt).toContain("Do X");
        expect(result.data.taskPrompt).toContain("1. AC1");
        expect(result.data.taskPrompt).toContain("2. AC2");
      }
    });

    it("returns correct agent type for reviewing phase", async () => {
      const { adapter } = createSut();
      const result = await adapter.stage(validRequest({ phase: "reviewing" }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.agentType).toBe("code-reviewer");
      }
    });
  });

  describe("stage — non-active phases", () => {
    const nonActivePhases: WorkflowPhase[] = [
      "idle",
      "paused",
      "blocked",
      "completing-milestone",
    ];

    for (const phase of nonActivePhases) {
      it(`returns InvalidPhaseForStagingError for ${phase}`, async () => {
        const { adapter } = createSut();
        const result = await adapter.stage(validRequest({ phase }));
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe("CONTEXT_STAGING.INVALID_PHASE");
        }
      });
    }
  });
});
```

- **Run:** `npx vitest run src/hexagons/workflow/infrastructure/in-memory-context-staging.adapter.spec.ts`
- **Expect:** FAIL — module `./in-memory-context-staging.adapter` not found

---

## Wave 6 — Adapter implementation

### T13: Implement InMemory adapter

**File:** Create `src/hexagons/workflow/infrastructure/in-memory-context-staging.adapter.ts`
**Traces to:** AC4, AC6

```typescript
import { err, ok, type Result } from "@kernel";
import { isActivePhase, resolveAgentType, buildTaskPrompt } from "../domain/context-package.helpers";
import { selectSkillsForPhase } from "../domain/phase-skill-map";
import { ContextPackage } from "../domain/context-package.value-object";
import {
  ContextStagingPort,
  type ContextStagingRequest,
} from "../domain/ports/context-staging.port";
import { ModelProfileResolverPort } from "../domain/ports/model-profile-resolver.port";
import {
  type ContextStagingError,
  InvalidPhaseForStagingError,
} from "../domain/errors/context-staging.error";

export class InMemoryContextStagingAdapter extends ContextStagingPort {
  constructor(
    private readonly deps: { modelProfileResolver: ModelProfileResolverPort },
  ) {
    super();
  }

  async stage(
    request: ContextStagingRequest,
  ): Promise<Result<ContextPackage, ContextStagingError>> {
    const {
      phase,
      sliceId,
      taskId,
      complexity,
      filePaths,
      taskDescription,
      acceptanceCriteria,
    } = request;

    if (!isActivePhase(phase)) {
      return err(new InvalidPhaseForStagingError(phase));
    }

    const skills = selectSkillsForPhase(phase);
    const agentType = resolveAgentType(phase);
    const modelProfile = await this.deps.modelProfileResolver.resolveForPhase(
      phase,
      complexity,
    );
    const taskPrompt = buildTaskPrompt(taskDescription, acceptanceCriteria);

    return ok(
      ContextPackage.create({
        phase,
        sliceId,
        taskId,
        skills,
        agentType,
        modelProfile,
        filePaths,
        taskPrompt,
      }),
    );
  }
}
```

- **Run:** `npx vitest run src/hexagons/workflow/infrastructure/in-memory-context-staging.adapter.spec.ts`
- **Expect:** PASS — all InMemory adapter tests green
- **Commit:** `feat(S04/T13): add InMemoryContextStagingAdapter`

---

## Wave 7 — Final integration

### T14: Update barrel exports

**File:** Modify `src/hexagons/workflow/index.ts`
**Traces to:** AC9

Append the following exports to the existing barrel file:

```typescript
// Domain — Context Package
export { ContextPackage } from "./domain/context-package.value-object";
export { ContextPackageBuilder } from "./domain/context-package.builder";
export {
  buildTaskPrompt,
  isActivePhase,
  PHASE_AGENT_MAP,
  resolveAgentType,
} from "./domain/context-package.helpers";
export type {
  ContextPackageProps,
  SkillName,
  SkillReference,
  SkillType,
} from "./domain/context-package.schemas";
export {
  ContextPackagePropsSchema,
  SKILL_NAMES,
  SkillNameSchema,
  SkillReferenceSchema,
  SkillTypeSchema,
} from "./domain/context-package.schemas";

// Domain — Context Staging Errors
export {
  ContextStagingError,
  InvalidPhaseForStagingError,
} from "./domain/errors/context-staging.error";

// Domain — Context Staging Ports
export type { ContextStagingRequest } from "./domain/ports/context-staging.port";
export {
  ContextStagingPort,
  ContextStagingRequestSchema,
} from "./domain/ports/context-staging.port";
export { ModelProfileResolverPort } from "./domain/ports/model-profile-resolver.port";

// Domain — Phase Skill Map
export {
  PHASE_SKILL_MAP,
  selectSkillsForPhase,
  SKILL_REGISTRY,
} from "./domain/phase-skill-map";

// Infrastructure — Context Staging
export { InMemoryContextStagingAdapter } from "./infrastructure/in-memory-context-staging.adapter";
```

- **Run:** `npx vitest run src/hexagons/workflow/` — verify all workflow tests still pass
- **Commit:** `feat(S04/T14): update barrel exports for context staging`

## Wave Summary

| Wave | Tasks | Parallel | Dependencies |
|---|---|---|---|
| 0 | T01, T02, T03 | 3 | none |
| 1 | T04, T05 | 2 | T01 |
| 2 | T06, T07 | 2 | T04, T05 |
| 3 | T08, T09, T10 | 3 | T01+T02+T07, T07, T06 |
| 4 | T11, T15 | 2 | T10, T08 |
| 5 | T12 | 1 | T08, T09, T11 |
| 6 | T13 | 1 | T12 |
| 7 | T14 | 1 | T13 |

## Acceptance Criteria Traceability

| AC | Tasks |
|---|---|
| AC1 — ContextPackage VO | T01, T05, T07 |
| AC2 — PhaseSkillMap | T04, T06 |
| AC3 — Skill Registry | T01, T04, T06 |
| AC4 — ContextStagingPort | T08, T12, T13 |
| AC5 — ModelProfileResolverPort | T03 |
| AC6 — InMemory adapter | T12, T13 |
| AC7 — Decoupled integration | T15 |
| AC8 — Builder | T09 |
| AC9 — Barrel exports | T14 |
| AC10 — isActivePhase | T10, T11 |
| AC11 — Phase-to-agent mapping | T10, T11 |
| AC12 — buildTaskPrompt edge cases | T10, T11 |
