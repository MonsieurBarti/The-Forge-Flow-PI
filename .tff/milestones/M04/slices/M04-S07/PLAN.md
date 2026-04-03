# M04-S07: Wave-Based Execution Engine — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Implement `ExecuteSliceUseCase` w/ wave detection, parallel dispatch via `AgentDispatchPort`, checkpoint resume, domain routing (filePaths → skills), stale claim detection, `AllTasksCompletedEvent`, ∧ self-contained event wiring (journal + metrics).

**Architecture:** Orchestrator + collaborators in execution hexagon. `ExecuteSliceUseCase` owns wave loop + checkpoint. Delegates to `DomainRouter` (routing) ∧ `PromptBuilder` (config assembly). Cross-hexagon deps: `TaskRepositoryPort` ∧ `WaveDetectionPort` from task hex barrel.

**Tech Stack:** TypeScript, Zod schemas, vitest, Result<T,E>, Promise.allSettled for parallel dispatch, compressed .md protocol templates.

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/hexagons/task/domain/task-status.vo.ts` | Modify | Add `blocked` to `in_progress` transitions |
| `src/hexagons/task/domain/task-status.vo.spec.ts` | Modify | Test in_progress → blocked |
| `src/kernel/agents/agent-card.schema.ts` | Modify | Add `"executor"` ∧ `"execute"` |
| `src/kernel/agents/agent-card.schema.spec.ts` | Modify | Test new enum values |
| `src/resources/protocols/execute.md` | Create | Execution protocol template |
| `src/hexagons/execution/domain/errors/execution.error.ts` | Create | ExecutionError w/ 5 factories |
| `src/hexagons/execution/domain/errors/execution.error.spec.ts` | Create | Error tests |
| `src/hexagons/execution/domain/events/all-tasks-completed.event.ts` | Create | AllTasksCompletedEvent |
| `src/hexagons/execution/domain/events/all-tasks-completed.event.spec.ts` | Create | Event tests |
| `src/hexagons/execution/application/execute-slice.schemas.ts` | Create | Input/Result schemas |
| `src/hexagons/execution/application/execute-slice.schemas.spec.ts` | Create | Schema tests |
| `src/hexagons/execution/application/domain-router.ts` | Create | filePaths → skills |
| `src/hexagons/execution/application/domain-router.spec.ts` | Create | Routing tests |
| `src/hexagons/execution/application/prompt-builder.ts` | Create | Task → AgentDispatchConfig |
| `src/hexagons/execution/application/prompt-builder.spec.ts` | Create | Prompt assembly tests |
| `src/hexagons/execution/application/execute-slice.use-case.ts` | Create | Core orchestrator |
| `src/hexagons/execution/application/execute-slice.use-case.spec.ts` | Create | Wave/resume/fail-fast tests |
| `src/hexagons/execution/index.ts` | Modify | Export new artifacts |

---

## Wave 0 (parallel — no dependencies)

### T00: Extend Task state machine — allow in_progress → blocked
**Files:** Modify `src/hexagons/task/domain/task-status.vo.ts`, Modify `src/hexagons/task/domain/task-status.vo.spec.ts`
**Traces to:** AC3, AC5

The execution engine needs to `task.start(now)` before dispatch (so `complete()` works) ∧ `task.block()` on failure. Current state machine only allows `in_progress → closed`. Must add `blocked` to allowed transitions from `in_progress`.

- [ ] Step 1: Add test to `src/hexagons/task/domain/task-status.vo.spec.ts`:
  ```typescript
  it("allows in_progress → blocked (execution failure)", () => {
    const status = TaskStatusVO.create("in_progress");
    expect(status.canTransitionTo("blocked")).toBe(true);
    const result = status.transitionTo("blocked");
    expect(isOk(result)).toBe(true);
  });
  ```
- [ ] Step 2: Run `npx vitest run src/hexagons/task/domain/task-status.vo.spec.ts`, verify FAIL
- [ ] Step 3: Modify `src/hexagons/task/domain/task-status.vo.ts` — add `"blocked"` to the `in_progress` transition set:
  ```typescript
  ["in_progress", new Set(["closed", "blocked"])],
  ```
- [ ] Step 4: Run `npx vitest run src/hexagons/task/domain/task-status.vo.spec.ts`, verify PASS
- [ ] Step 5: `git add src/hexagons/task/domain/task-status.vo.ts src/hexagons/task/domain/task-status.vo.spec.ts && git commit -m "feat(S07/T00): allow in_progress → blocked task transition"`

---

### T01: AgentType extension
**Files:** Modify `src/kernel/agents/agent-card.schema.ts`, Modify `src/kernel/agents/agent-card.schema.spec.ts`
**Traces to:** AC12

- [ ] Step 1: Add test cases to `src/kernel/agents/agent-card.schema.spec.ts`:
  ```typescript
  it("accepts executor agent type", () => {
    const result = AgentTypeSchema.safeParse("executor");
    expect(result.success).toBe(true);
  });

  it("accepts execute capability", () => {
    const result = AgentCapabilitySchema.safeParse("execute");
    expect(result.success).toBe(true);
  });
  ```
- [ ] Step 2: Run `npx vitest run src/kernel/agents/agent-card.schema.spec.ts`, verify FAIL
- [ ] Step 3: Modify `src/kernel/agents/agent-card.schema.ts`:
  ```typescript
  export const AgentTypeSchema = z.enum([
    "spec-reviewer",
    "code-reviewer",
    "security-auditor",
    "fixer",
    "executor",
  ]);

  export const AgentCapabilitySchema = z.enum(["review", "fix", "execute"]);
  ```
- [ ] Step 4: Run `npx vitest run src/kernel/agents/agent-card.schema.spec.ts`, verify PASS
- [ ] Step 5: `git add src/kernel/agents/agent-card.schema.ts src/kernel/agents/agent-card.schema.spec.ts && git commit -m "feat(S07/T01): add executor agent type + execute capability"`

---

### T02: ExecutionError
**Files:** Create `src/hexagons/execution/domain/errors/execution.error.ts`, Create `src/hexagons/execution/domain/errors/execution.error.spec.ts`
**Traces to:** AC3, AC9

- [ ] Step 1: Write test `src/hexagons/execution/domain/errors/execution.error.spec.ts`:
  ```typescript
  import { describe, expect, it } from "vitest";
  import { ExecutionError } from "./execution.error";

  describe("ExecutionError", () => {
    it("noTasks includes sliceId in code and metadata", () => {
      const e = ExecutionError.noTasks("slice-1");
      expect(e.code).toBe("EXECUTION.NO_TASKS");
      expect(e.message).toContain("slice-1");
      expect(e.metadata?.sliceId).toBe("slice-1");
    });

    it("cyclicDependency", () => {
      const e = ExecutionError.cyclicDependency("slice-1");
      expect(e.code).toBe("EXECUTION.CYCLIC_DEPENDENCY");
    });

    it("worktreeRequired", () => {
      const e = ExecutionError.worktreeRequired("slice-1");
      expect(e.code).toBe("EXECUTION.WORKTREE_REQUIRED");
      expect(e.metadata?.sliceId).toBe("slice-1");
    });

    it("waveFailed includes waveIndex and failedTaskIds", () => {
      const e = ExecutionError.waveFailed("slice-1", 2, ["t1", "t2"]);
      expect(e.code).toBe("EXECUTION.WAVE_FAILED");
      expect(e.metadata?.waveIndex).toBe(2);
      expect(e.metadata?.failedTaskIds).toEqual(["t1", "t2"]);
    });

    it("staleClaim includes taskId", () => {
      const e = ExecutionError.staleClaim("task-1");
      expect(e.code).toBe("EXECUTION.STALE_CLAIM");
      expect(e.metadata?.taskId).toBe("task-1");
    });

    it("extends Error", () => {
      expect(ExecutionError.noTasks("x")).toBeInstanceOf(Error);
    });
  });
  ```
- [ ] Step 2: Run `npx vitest run src/hexagons/execution/domain/errors/execution.error.spec.ts`, verify FAIL
- [ ] Step 3: Implement `src/hexagons/execution/domain/errors/execution.error.ts`:
  ```typescript
  import { BaseDomainError } from "@kernel";

  export class ExecutionError extends BaseDomainError {
    readonly code: string;

    private constructor(code: string, message: string, metadata?: Record<string, unknown>) {
      super(message, metadata);
      this.code = code;
    }

    static noTasks(sliceId: string): ExecutionError {
      return new ExecutionError("EXECUTION.NO_TASKS", `No tasks found for slice ${sliceId}`, { sliceId });
    }

    static cyclicDependency(sliceId: string): ExecutionError {
      return new ExecutionError("EXECUTION.CYCLIC_DEPENDENCY", `Cyclic task dependency in slice ${sliceId}`, { sliceId });
    }

    static worktreeRequired(sliceId: string): ExecutionError {
      return new ExecutionError("EXECUTION.WORKTREE_REQUIRED", `Worktree missing for non-S-tier slice ${sliceId}`, { sliceId });
    }

    static waveFailed(sliceId: string, waveIndex: number, failedTaskIds: string[]): ExecutionError {
      return new ExecutionError("EXECUTION.WAVE_FAILED", `Wave ${waveIndex} failed: ${failedTaskIds.length} task(s)`, { sliceId, waveIndex, failedTaskIds });
    }

    static staleClaim(taskId: string): ExecutionError {
      return new ExecutionError("EXECUTION.STALE_CLAIM", `Task ${taskId} has stale in_progress claim`, { taskId });
    }
  }
  ```
- [ ] Step 4: Run `npx vitest run src/hexagons/execution/domain/errors/execution.error.spec.ts`, verify PASS
- [ ] Step 5: `git add src/hexagons/execution/domain/errors/execution.error.ts src/hexagons/execution/domain/errors/execution.error.spec.ts && git commit -m "feat(S07/T02): ExecutionError with 5 static factories"`

---

### T03: AllTasksCompletedEvent
**Files:** Create `src/hexagons/execution/domain/events/all-tasks-completed.event.ts`, Create `src/hexagons/execution/domain/events/all-tasks-completed.event.spec.ts`
**Traces to:** AC6

- [ ] Step 1: Write test `src/hexagons/execution/domain/events/all-tasks-completed.event.spec.ts`:
  ```typescript
  import { EVENT_NAMES } from "@kernel";
  import { randomUUID } from "node:crypto";
  import { describe, expect, it } from "vitest";
  import { AllTasksCompletedEvent } from "./all-tasks-completed.event";

  describe("AllTasksCompletedEvent", () => {
    it("has correct eventName", () => {
      const event = new AllTasksCompletedEvent({
        id: randomUUID(),
        aggregateId: randomUUID(),
        occurredAt: new Date(),
        sliceId: randomUUID(),
        milestoneId: randomUUID(),
        completedTaskCount: 5,
        totalWaveCount: 2,
      });
      expect(event.eventName).toBe(EVENT_NAMES.ALL_TASKS_COMPLETED);
    });

    it("exposes typed properties", () => {
      const sliceId = randomUUID();
      const milestoneId = randomUUID();
      const event = new AllTasksCompletedEvent({
        id: randomUUID(),
        aggregateId: sliceId,
        occurredAt: new Date(),
        sliceId,
        milestoneId,
        completedTaskCount: 3,
        totalWaveCount: 1,
      });
      expect(event.sliceId).toBe(sliceId);
      expect(event.milestoneId).toBe(milestoneId);
      expect(event.completedTaskCount).toBe(3);
      expect(event.totalWaveCount).toBe(1);
    });

    it("validates props via schema", () => {
      expect(() => new AllTasksCompletedEvent({
        id: randomUUID(),
        aggregateId: randomUUID(),
        occurredAt: new Date(),
        sliceId: randomUUID(),
        milestoneId: randomUUID(),
        completedTaskCount: -1,
        totalWaveCount: 0,
      })).toThrow();
    });
  });
  ```
- [ ] Step 2: Run `npx vitest run src/hexagons/execution/domain/events/all-tasks-completed.event.spec.ts`, verify FAIL
- [ ] Step 3: Implement `src/hexagons/execution/domain/events/all-tasks-completed.event.ts`:
  ```typescript
  import { DomainEvent, DomainEventPropsSchema, EVENT_NAMES, IdSchema } from "@kernel";
  import type { EventName } from "@kernel";
  import { z } from "zod";

  const AllTasksCompletedEventPropsSchema = DomainEventPropsSchema.extend({
    sliceId: IdSchema,
    milestoneId: IdSchema,
    completedTaskCount: z.number().int().nonnegative(),
    totalWaveCount: z.number().int().positive(),
  });
  type AllTasksCompletedEventProps = z.infer<typeof AllTasksCompletedEventPropsSchema>;

  export class AllTasksCompletedEvent extends DomainEvent {
    readonly eventName: EventName = EVENT_NAMES.ALL_TASKS_COMPLETED;
    readonly sliceId: string;
    readonly milestoneId: string;
    readonly completedTaskCount: number;
    readonly totalWaveCount: number;

    constructor(props: AllTasksCompletedEventProps) {
      const parsed = AllTasksCompletedEventPropsSchema.parse(props);
      super(parsed);
      this.sliceId = parsed.sliceId;
      this.milestoneId = parsed.milestoneId;
      this.completedTaskCount = parsed.completedTaskCount;
      this.totalWaveCount = parsed.totalWaveCount;
    }
  }
  ```
- [ ] Step 4: Run `npx vitest run src/hexagons/execution/domain/events/all-tasks-completed.event.spec.ts`, verify PASS
- [ ] Step 5: `git add src/hexagons/execution/domain/events/all-tasks-completed.event.ts src/hexagons/execution/domain/events/all-tasks-completed.event.spec.ts && git commit -m "feat(S07/T03): AllTasksCompletedEvent"`

---

### T04: ExecuteSlice schemas
**Files:** Create `src/hexagons/execution/application/execute-slice.schemas.ts`, Create `src/hexagons/execution/application/execute-slice.schemas.spec.ts`
**Traces to:** AC1, AC2, AC3, AC7

- [ ] Step 1: Write test `src/hexagons/execution/application/execute-slice.schemas.spec.ts`:
  ```typescript
  import { randomUUID } from "node:crypto";
  import { describe, expect, it } from "vitest";
  import { ExecuteSliceInputSchema, ExecuteSliceResultSchema } from "./execute-slice.schemas";

  describe("ExecuteSliceInputSchema", () => {
    const valid = {
      sliceId: randomUUID(),
      milestoneId: randomUUID(),
      sliceLabel: "M04-S07",
      sliceTitle: "Wave-based execution engine",
      complexity: "F-full" as const,
      model: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      modelProfile: "balanced" as const,
      workingDirectory: "/path/to/worktree",
    };

    it("parses valid input", () => {
      expect(ExecuteSliceInputSchema.safeParse(valid).success).toBe(true);
    });

    it("rejects missing sliceLabel", () => {
      const { sliceLabel: _, ...without } = valid;
      expect(ExecuteSliceInputSchema.safeParse(without).success).toBe(false);
    });

    it("accepts all complexity tiers", () => {
      for (const tier of ["S", "F-lite", "F-full"]) {
        expect(ExecuteSliceInputSchema.safeParse({ ...valid, complexity: tier }).success).toBe(true);
      }
    });
  });

  describe("ExecuteSliceResultSchema", () => {
    it("parses valid result", () => {
      const result = ExecuteSliceResultSchema.safeParse({
        sliceId: randomUUID(),
        completedTasks: [randomUUID()],
        failedTasks: [],
        skippedTasks: [],
        wavesCompleted: 2,
        totalWaves: 2,
        aborted: false,
      });
      expect(result.success).toBe(true);
    });

    it("requires skippedTasks array", () => {
      const result = ExecuteSliceResultSchema.safeParse({
        sliceId: randomUUID(),
        completedTasks: [],
        failedTasks: [],
        wavesCompleted: 0,
        totalWaves: 1,
        aborted: false,
      });
      expect(result.success).toBe(false);
    });
  });
  ```
- [ ] Step 2: Run `npx vitest run src/hexagons/execution/application/execute-slice.schemas.spec.ts`, verify FAIL
- [ ] Step 3: Implement `src/hexagons/execution/application/execute-slice.schemas.ts`:
  ```typescript
  import { ComplexityTierSchema, IdSchema, ModelProfileNameSchema, ResolvedModelSchema } from "@kernel";
  import { z } from "zod";

  export const ExecuteSliceInputSchema = z.object({
    sliceId: IdSchema,
    milestoneId: IdSchema,
    sliceLabel: z.string().min(1),
    sliceTitle: z.string().min(1),
    complexity: ComplexityTierSchema,
    model: ResolvedModelSchema,
    modelProfile: ModelProfileNameSchema,
    workingDirectory: z.string().min(1),
  });
  export type ExecuteSliceInput = z.infer<typeof ExecuteSliceInputSchema>;

  export const ExecuteSliceResultSchema = z.object({
    sliceId: IdSchema,
    completedTasks: z.array(IdSchema),
    failedTasks: z.array(IdSchema),
    skippedTasks: z.array(IdSchema),
    wavesCompleted: z.number().int().nonnegative(),
    totalWaves: z.number().int().nonnegative(),
    aborted: z.boolean(),
  });
  export type ExecuteSliceResult = z.infer<typeof ExecuteSliceResultSchema>;
  ```
- [ ] Step 4: Run `npx vitest run src/hexagons/execution/application/execute-slice.schemas.spec.ts`, verify PASS
- [ ] Step 5: `git add src/hexagons/execution/application/execute-slice.schemas.ts src/hexagons/execution/application/execute-slice.schemas.spec.ts && git commit -m "feat(S07/T04): ExecuteSlice input/result schemas"`

---

### T05: Execution protocol template
**Files:** Create `src/resources/protocols/execute.md`
**Traces to:** AC11

No TDD — markdown artifact. Verify existence ∧ interpolation variables.

- [ ] Step 1: Create `src/resources/protocols/execute.md`:
  ```markdown
  EXECUTING — {{sliceLabel}}: {{sliceTitle}}.

  ## Context
  - Task: {{taskLabel}} — {{taskTitle}}
  - Slice: {{sliceId}} ({{complexity}})
  - Dir: {{workingDirectory}}

  ## Instructions
  ∀ AC: implement ∧ verify.
  TDD: RED ⇒ GREEN ⇒ REFACTOR ⇒ commit.
  Commit: `<type>({{sliceLabel}}/{{taskLabel}}): <summary>`

  ## Task
  {{taskDescription}}

  ## AC
  {{acceptanceCriteria}}

  ## Files
  {{filePaths}}

  ## Status
  ∀ completion: emit report between `<!-- TFF_STATUS_REPORT -->` markers.
  ¬DONE ∧ ∃ concerns ⇒ DONE_WITH_CONCERNS.
  ```
- [ ] Step 2: `git add src/resources/protocols/execute.md && git commit -m "feat(S07/T05): execution protocol template — compressed notation"`

---

### T06: DomainRouter
**Files:** Create `src/hexagons/execution/application/domain-router.ts`, Create `src/hexagons/execution/application/domain-router.spec.ts`
**Traces to:** AC4

- [ ] Step 1: Write test `src/hexagons/execution/application/domain-router.spec.ts`:
  ```typescript
  import { describe, expect, it } from "vitest";
  import { DomainRouter } from "./domain-router";

  describe("DomainRouter", () => {
    const router = new DomainRouter();

    it("always includes baseline skills", () => {
      const skills = router.resolve([]);
      expect(skills).toContain("executing-plans");
      expect(skills).toContain("commit-conventions");
    });

    it("maps domain/ paths to hexagonal-architecture", () => {
      const skills = router.resolve(["src/hexagons/execution/domain/foo.ts"]);
      expect(skills).toContain("hexagonal-architecture");
    });

    it("maps application/ paths to hexagonal-architecture", () => {
      const skills = router.resolve(["src/hexagons/execution/application/bar.ts"]);
      expect(skills).toContain("hexagonal-architecture");
    });

    it("maps infrastructure/ paths to hexagonal-architecture", () => {
      const skills = router.resolve(["src/hexagons/execution/infrastructure/baz.ts"]);
      expect(skills).toContain("hexagonal-architecture");
    });

    it("maps .spec.ts files to test-driven-development", () => {
      const skills = router.resolve(["src/foo.spec.ts"]);
      expect(skills).toContain("test-driven-development");
    });

    it("deduplicates skills from multiple matching paths", () => {
      const skills = router.resolve([
        "src/hexagons/execution/domain/a.ts",
        "src/hexagons/execution/application/b.ts",
      ]);
      const hexCount = skills.filter(s => s === "hexagonal-architecture").length;
      expect(hexCount).toBe(1);
    });

    it("caps at 3 skills maximum", () => {
      const skills = router.resolve([
        "src/hexagons/execution/domain/a.spec.ts",
      ]);
      expect(skills.length).toBeLessThanOrEqual(3);
    });

    it("prioritizes rigid skills (commit-conventions) over flexible", () => {
      const skills = router.resolve(["src/hexagons/execution/domain/a.spec.ts"]);
      // commit-conventions is rigid, should appear before flexible hexagonal-architecture
      const rigidIdx = skills.indexOf("commit-conventions");
      const flexIdx = skills.indexOf("hexagonal-architecture");
      if (rigidIdx >= 0 && flexIdx >= 0) {
        expect(rigidIdx).toBeLessThan(flexIdx);
      }
    });
  });
  ```
- [ ] Step 2: Run `npx vitest run src/hexagons/execution/application/domain-router.spec.ts`, verify FAIL
- [ ] Step 3: Implement `src/hexagons/execution/application/domain-router.ts`:
  ```typescript
  interface RouteEntry {
    readonly pattern: RegExp;
    readonly skills: readonly string[];
  }

  const ROUTE_TABLE: readonly RouteEntry[] = [
    { pattern: /\/(domain|entities)\//, skills: ["hexagonal-architecture"] },
    { pattern: /\/(application|use-case)\//, skills: ["hexagonal-architecture"] },
    { pattern: /\/(infrastructure|adapters?)\//, skills: ["hexagonal-architecture"] },
    { pattern: /\.spec\.ts$/, skills: ["test-driven-development"] },
  ];

  const BASELINE_SKILLS: readonly string[] = ["executing-plans", "commit-conventions"];
  const MAX_SKILLS = 3;

  // Skills classified as rigid follow strict discipline — prioritized in dispatch
  const RIGID_SKILLS = new Set([
    "executing-plans",
    "commit-conventions",
    "test-driven-development",
  ]);

  export class DomainRouter {
    resolve(filePaths: readonly string[]): string[] {
      const matched = new Set<string>(BASELINE_SKILLS);
      for (const fp of filePaths) {
        for (const route of ROUTE_TABLE) {
          if (route.pattern.test(fp)) {
            for (const skill of route.skills) {
              matched.add(skill);
            }
          }
        }
      }
      return [...matched]
        .sort((a, b) => {
          const aRigid = RIGID_SKILLS.has(a) ? 0 : 1;
          const bRigid = RIGID_SKILLS.has(b) ? 0 : 1;
          if (aRigid !== bRigid) return aRigid - bRigid;
          return a.localeCompare(b);
        })
        .slice(0, MAX_SKILLS);
    }
  }
  ```
- [ ] Step 4: Run `npx vitest run src/hexagons/execution/application/domain-router.spec.ts`, verify PASS
- [ ] Step 5: `git add src/hexagons/execution/application/domain-router.ts src/hexagons/execution/application/domain-router.spec.ts && git commit -m "feat(S07/T06): DomainRouter — file path to skill mapping"`

---

## Wave 1 (depends on T01, T05, T06)

### T07: PromptBuilder
**Files:** Create `src/hexagons/execution/application/prompt-builder.ts`, Create `src/hexagons/execution/application/prompt-builder.spec.ts`
**Traces to:** AC11, AC12

Note: PromptBuilder accepts `templateContent: string` as constructor param. The canonical template lives at `src/resources/protocols/execute.md` (T05). The caller loads the file and passes its content. This keeps PromptBuilder pure (no file I/O) and testable. PI adapter appends `AGENT_STATUS_PROMPT` automatically — PromptBuilder does ¬include it.

- [ ] Step 1: Write test `src/hexagons/execution/application/prompt-builder.spec.ts`:
  ```typescript
  import { readFileSync } from "node:fs";
  import { randomUUID } from "node:crypto";
  import { join } from "node:path";
  import { describe, expect, it } from "vitest";
  import { AGENT_STATUS_PROMPT } from "@kernel";
  import { DomainRouter } from "./domain-router";
  import { PromptBuilder } from "./prompt-builder";

  // Load canonical template — verifies T05 artifact is usable
  const templateContent = readFileSync(
    join(process.cwd(), "src/resources/protocols/execute.md"),
    "utf-8",
  );

  describe("PromptBuilder", () => {
    const config = {
      sliceId: randomUUID(),
      sliceLabel: "M04-S07",
      sliceTitle: "Wave-based execution engine",
      milestoneId: randomUUID(),
      workingDirectory: "/path/to/worktree",
      model: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      complexity: "F-full" as const,
    };
    const router = new DomainRouter();
    const builder = new PromptBuilder(config, router, templateContent);

    // Only PromptBuilderTask fields — no extraneous Task aggregate props
    const task = {
      id: randomUUID(),
      label: "T01",
      title: "Test task",
      description: "Implement feature X",
      acceptanceCriteria: "AC1: Feature X works",
      filePaths: ["src/hexagons/execution/domain/foo.ts"],
    };

    it("sets agentType to executor (AC12)", () => {
      const result = builder.build(task);
      expect(result.agentType).toBe("executor");
    });

    it("includes workingDirectory from config", () => {
      const result = builder.build(task);
      expect(result.workingDirectory).toBe("/path/to/worktree");
    });

    it("includes task filePaths", () => {
      const result = builder.build(task);
      expect(result.filePaths).toEqual(task.filePaths);
    });

    it("systemPrompt does NOT include AGENT_STATUS_PROMPT (PI adapter appends it)", () => {
      const result = builder.build(task);
      expect(result.systemPrompt).not.toContain(AGENT_STATUS_PROMPT);
    });

    it("taskPrompt contains task title and description", () => {
      const result = builder.build(task);
      expect(result.taskPrompt).toContain("Test task");
      expect(result.taskPrompt).toContain("Implement feature X");
    });

    it("taskPrompt contains compressed notation symbols from template", () => {
      const result = builder.build(task);
      expect(result.taskPrompt).toMatch(/[∀⇒¬∧]/);
    });

    it("taskPrompt contains slice label and task label", () => {
      const result = builder.build(task);
      expect(result.taskPrompt).toContain("M04-S07");
      expect(result.taskPrompt).toContain("T01");
    });

    it("includes model from config", () => {
      const result = builder.build(task);
      expect(result.model).toEqual(config.model);
    });

    it("includes standard tool set", () => {
      const result = builder.build(task);
      expect(result.tools).toContain("Read");
      expect(result.tools).toContain("Write");
      expect(result.tools).toContain("Bash");
    });
  });
  ```
- [ ] Step 2: Run `npx vitest run src/hexagons/execution/application/prompt-builder.spec.ts`, verify FAIL
- [ ] Step 3: Implement `src/hexagons/execution/application/prompt-builder.ts`:
  ```typescript
  import type { AgentDispatchConfig, ComplexityTier, ResolvedModel } from "@kernel";
  import type { DomainRouter } from "./domain-router";

  export interface PromptBuilderConfig {
    readonly sliceId: string;
    readonly sliceLabel: string;
    readonly sliceTitle: string;
    readonly milestoneId: string;
    readonly workingDirectory: string;
    readonly model: ResolvedModel;
    readonly complexity: ComplexityTier;
  }

  export interface PromptBuilderTask {
    readonly id: string;
    readonly label: string;
    readonly title: string;
    readonly description: string;
    readonly acceptanceCriteria: string;
    readonly filePaths: readonly string[];
  }

  export class PromptBuilder {
    constructor(
      private readonly config: PromptBuilderConfig,
      private readonly router: DomainRouter,
      private readonly templateContent: string,
    ) {}

    build(task: PromptBuilderTask): AgentDispatchConfig {
      const skills = this.router.resolve(task.filePaths);
      return {
        taskId: task.id,
        sliceId: this.config.sliceId,
        agentType: "executor",
        workingDirectory: this.config.workingDirectory,
        systemPrompt: this.buildSystemPrompt(skills),
        taskPrompt: this.interpolateTemplate(task),
        model: this.config.model,
        tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
        filePaths: [...task.filePaths],
      };
    }

    private buildSystemPrompt(skills: string[]): string {
      return skills.map((s) => `<skill name="${s}" />`).join("\n");
    }

    private interpolateTemplate(task: PromptBuilderTask): string {
      return this.templateContent
        .replace(/\{\{sliceLabel\}\}/g, this.config.sliceLabel)
        .replace(/\{\{sliceTitle\}\}/g, this.config.sliceTitle)
        .replace(/\{\{sliceId\}\}/g, this.config.sliceId)
        .replace(/\{\{complexity\}\}/g, this.config.complexity)
        .replace(/\{\{workingDirectory\}\}/g, this.config.workingDirectory)
        .replace(/\{\{taskLabel\}\}/g, task.label)
        .replace(/\{\{taskTitle\}\}/g, task.title)
        .replace(/\{\{taskDescription\}\}/g, task.description)
        .replace(/\{\{acceptanceCriteria\}\}/g, task.acceptanceCriteria)
        .replace(/\{\{filePaths\}\}/g, task.filePaths.map((f) => `- \`${f}\``).join("\n"));
    }
  }
  ```
- [ ] Step 4: Run `npx vitest run src/hexagons/execution/application/prompt-builder.spec.ts`, verify PASS
- [ ] Step 5: `git add src/hexagons/execution/application/prompt-builder.ts src/hexagons/execution/application/prompt-builder.spec.ts && git commit -m "feat(S07/T07): PromptBuilder — template interpolation + executor agent type"`

---

## Wave 2 (depends on T00, T02, T03, T04, T07)

### T08: ExecuteSliceUseCase
**Files:** Create `src/hexagons/execution/application/execute-slice.use-case.ts`, Create `src/hexagons/execution/application/execute-slice.use-case.spec.ts`
**Traces to:** AC1, AC2, AC3, AC5, AC6, AC7, AC8, AC9, AC10

This is the core orchestrator. Tests verify: wave sequencing, parallel dispatch, checkpoint resume, fail-fast, stale claims, event emission, event wiring.

**Important — Task aggregate method signatures:**
- `task.complete(now: Date)` — needs DateProvider
- `task.block(blockerIds: string[], now: Date)` — pass `[taskId]` as blocker ∧ DateProvider

- [ ] Step 1: Write test `src/hexagons/execution/application/execute-slice.use-case.spec.ts`:

  Test setup skeleton:
  ```typescript
  import { randomUUID } from "node:crypto";
  import { beforeEach, describe, expect, it } from "vitest";
  import { InProcessEventBus, SilentLoggerAdapter, isOk, isErr, ok } from "@kernel";
  import { InMemoryAgentDispatchAdapter } from "../infrastructure/in-memory-agent-dispatch.adapter";
  import { InMemoryCheckpointRepository } from "../infrastructure/in-memory-checkpoint.repository";
  import { InMemoryWorktreeAdapter } from "../infrastructure/in-memory-worktree.adapter";
  import { InMemoryJournalRepository } from "../infrastructure/in-memory-journal.repository";
  import { InMemoryMetricsRepository } from "../infrastructure/in-memory-metrics.repository";
  import { AgentResultBuilder } from "@kernel/agents";
  import { ExecuteSliceUseCase } from "./execute-slice.use-case";
  import { DomainRouter } from "./domain-router";

  // Stub TaskRepositoryPort — returns pre-configured tasks
  // Stub WaveDetectionPort — returns pre-configured waves (sync)
  // FixedDateProvider — returns deterministic dates

  describe("ExecuteSliceUseCase", () => {
    let agentDispatch: InMemoryAgentDispatchAdapter;
    let checkpointRepo: InMemoryCheckpointRepository;
    let worktreeAdapter: InMemoryWorktreeAdapter;
    let eventBus: InProcessEventBus;
    let journalRepo: InMemoryJournalRepository;
    let metricsRepo: InMemoryMetricsRepository;
    let useCase: ExecuteSliceUseCase;

    beforeEach(() => {
      agentDispatch = new InMemoryAgentDispatchAdapter();
      checkpointRepo = new InMemoryCheckpointRepository();
      worktreeAdapter = new InMemoryWorktreeAdapter();
      eventBus = new InProcessEventBus(new SilentLoggerAdapter());
      journalRepo = new InMemoryJournalRepository();
      metricsRepo = new InMemoryMetricsRepository();
      // Wire useCase with all deps...
    });
  });
  ```

  Test cases (each maps to ACs):
  - "dispatches wave 0 tasks in parallel via Promise.allSettled (AC1)"
  - "executes waves sequentially — wave 1 waits for wave 0 (AC1)"
  - "skips completed waves on resume from checkpoint (AC2)"
  - "skips completed tasks within current wave on resume (AC2)"
  - "aborts on task failure — in-flight complete, ¬further waves (AC3)"
  - "emits TaskCompletedEvent + TaskExecutionCompletedEvent on success (AC5)"
  - "emits TaskBlockedEvent + TaskExecutionCompletedEvent on failure (AC5)"
  - "emits AllTasksCompletedEvent when all waves complete (AC6)"
  - "does NOT emit AllTasksCompletedEvent when aborted (AC6)"
  - "detects stale claims and collects in skippedTasks (AC7)"
  - "wires JournalEventHandler + RecordTaskMetricsUseCase before dispatch (AC8)"
  - "returns worktreeRequired error for non-S complexity without worktree (AC9)"
  - "saves checkpoint after each task completion (AC10)"
  - "advances checkpoint wave after wave completes (AC10)"
  - "returns noTasks error for empty slice"
  - "returns cyclicDependency error for cyclic deps"

- [ ] Step 2: Run `npx vitest run src/hexagons/execution/application/execute-slice.use-case.spec.ts`, verify FAIL
- [ ] Step 3: Implement `src/hexagons/execution/application/execute-slice.use-case.ts`:
  Follow the execute flow from SPEC.md exactly:
  1. Load tasks, detect waves, validate worktree
  2. Load/create checkpoint
  3. Wire event handlers (JournalEventHandler.register + RecordTaskMetricsUseCase.register)
  4. Wave loop with Promise.allSettled:
     ∀ task in wave (before dispatch):
     - `task.start(dateProvider.now())` — open → in_progress
     - `checkpoint.recordTaskStart(taskId, "executor", dateProvider.now())`
  5. Process results:
     - success → `task.complete(dateProvider.now())` (in_progress → closed)
       → `checkpoint.recordTaskComplete(taskId, dateProvider.now())`
       → publish checkpoint events via `checkpoint.pullEvents()`
       → emit TaskCompletedEvent + TaskExecutionCompletedEvent
     - failure → `task.block([task.id], dateProvider.now())` (in_progress → blocked, requires T00)
       → emit TaskBlockedEvent + TaskExecutionCompletedEvent
       → collect in failedTasks
  6. Emit AllTasksCompletedEvent if all done ∧ ¬aborted
  7. Return ExecuteSliceResult
- [ ] Step 4: Run `npx vitest run src/hexagons/execution/application/execute-slice.use-case.spec.ts`, verify PASS
- [ ] Step 5: `git add src/hexagons/execution/application/execute-slice.use-case.ts src/hexagons/execution/application/execute-slice.use-case.spec.ts && git commit -m "feat(S07/T08): ExecuteSliceUseCase — wave-based parallel dispatch"`

---

## Wave 3 (depends on T08)

### T09: Barrel exports + full verification
**Files:** Modify `src/hexagons/execution/index.ts`
**Traces to:** All ACs (public API)

- [ ] Step 1: Add exports to `src/hexagons/execution/index.ts`:

  Domain errors:
  ```typescript
  export { ExecutionError } from "./domain/errors/execution.error";
  ```

  Domain events:
  ```typescript
  export { AllTasksCompletedEvent } from "./domain/events/all-tasks-completed.event";
  ```

  Application schemas:
  ```typescript
  export { ExecuteSliceInputSchema, ExecuteSliceResultSchema } from "./application/execute-slice.schemas";
  export type { ExecuteSliceInput, ExecuteSliceResult } from "./application/execute-slice.schemas";
  ```

  Application use case:
  ```typescript
  export { ExecuteSliceUseCase } from "./application/execute-slice.use-case";
  ```

  Application collaborators:
  ```typescript
  export { DomainRouter } from "./application/domain-router";
  export { PromptBuilder } from "./application/prompt-builder";
  export type { PromptBuilderConfig, PromptBuilderTask } from "./application/prompt-builder";
  ```

- [ ] Step 2: Run full test suite: `npx vitest run src/hexagons/execution/ && npx vitest run src/kernel/agents/`, verify all PASS
- [ ] Step 3: `git add src/hexagons/execution/index.ts && git commit -m "feat(S07/T09): barrel exports for wave-based execution engine"`
