# M03-S07: Plan Command — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Build `/tff:plan` command that decomposes a spec into tasks, detects waves, writes PLAN.md, and gates on human approval.
**Architecture:** Tool+protocol pattern (matches S05/S06). Cross-hexagon `CreateTasksPort` for task creation.
**Tech Stack:** TypeScript, Zod, Vitest, PI SDK extension API.

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/hexagons/task/domain/task.aggregate.ts` | Add `blockedBy` to `createNew()` |
| Modify | `src/hexagons/task/domain/task.aggregate.spec.ts` | Test blockedBy param |
| Create | `src/hexagons/task/application/create-tasks.use-case.ts` | Two-pass task creation + wave detection |
| Create | `src/hexagons/task/application/create-tasks.use-case.spec.ts` | Tests |
| Modify | `src/hexagons/task/index.ts` | Export CreateTasksUseCase |
| Modify | `src/hexagons/slice/domain/slice.aggregate.ts` | Add `setPlanPath()` |
| Modify | `src/hexagons/slice/domain/slice.aggregate.spec.ts` | Test setPlanPath |
| Create | `src/hexagons/task/domain/ports/create-tasks.port.ts` | Port interface |
| Create | `src/hexagons/workflow/use-cases/write-plan.use-case.ts` | Write PLAN.md + delegate |
| Create | `src/hexagons/workflow/use-cases/write-plan.use-case.spec.ts` | Tests |
| Create | `src/hexagons/workflow/infrastructure/pi/write-plan.tool.ts` | `tff_write_plan` tool |
| Create | `src/hexagons/workflow/infrastructure/pi/plan-protocol.ts` | Protocol builder |
| Create | `src/hexagons/workflow/infrastructure/pi/templates/protocols/plan.md` | Protocol template |
| Create | `src/hexagons/workflow/infrastructure/pi/plan.command.ts` | Command handler |
| Create | `src/hexagons/workflow/infrastructure/pi/plan.command.spec.ts` | Command tests |
| Modify | `src/hexagons/workflow/infrastructure/pi/workflow.extension.ts` | Wire plan |
| Modify | `src/hexagons/workflow/index.ts` | Barrel exports |

---

## Wave 0 (parallel — no dependencies)

### T01: Add `blockedBy` param to `Task.createNew()` + test

**Files:** Modify `src/hexagons/task/domain/task.aggregate.ts`, Modify `src/hexagons/task/domain/task.aggregate.spec.ts`
**Traces to:** AC6, AC9

#### TDD

1. **RED** — In `task.aggregate.spec.ts`, add test:
```typescript
it("should accept optional blockedBy in createNew", () => {
  const blockerId = crypto.randomUUID();
  const task = Task.createNew({
    id: crypto.randomUUID(),
    sliceId: crypto.randomUUID(),
    label: "T02",
    title: "Depends on T01",
    blockedBy: [blockerId],
    now: new Date(),
  });
  expect(task.blockedBy).toEqual([blockerId]);
});
```
- **Run:** `npx vitest run src/hexagons/task/domain/task.aggregate.spec.ts`
- **Expect:** FAIL — `blockedBy` not in createNew params

2. **GREEN** — In `task.aggregate.ts`, modify `createNew` params:
```typescript
static createNew(params: {
  id: Id;
  sliceId: Id;
  label: string;
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  filePaths?: string[];
  blockedBy?: string[];  // NEW
  now: Date;
}): Task {
  const task = new Task({
    // ... existing fields ...
    blockedBy: params.blockedBy ?? [],  // Changed from hardcoded []
    // ...
  });
```
- **Run:** `npx vitest run src/hexagons/task/domain/task.aggregate.spec.ts`
- **Expect:** PASS

3. **Commit:** `feat(S07/T01): add blockedBy param to Task.createNew()`

---

### T02: Add `setPlanPath()` to Slice aggregate + test

**Files:** Modify `src/hexagons/slice/domain/slice.aggregate.ts`, Modify `src/hexagons/slice/domain/slice.aggregate.spec.ts`
**Traces to:** AC13

#### TDD

1. **RED** — In `slice.aggregate.spec.ts`, add test:
```typescript
it("should update planPath and updatedAt", () => {
  const slice = new SliceBuilder().build();
  const now = new Date("2026-03-27T15:00:00Z");
  slice.setPlanPath(".tff/milestones/M03/slices/M03-S07/PLAN.md", now);
  expect(slice.planPath).toBe(".tff/milestones/M03/slices/M03-S07/PLAN.md");
  expect(slice.updatedAt).toEqual(now);
});
```
- **Run:** `npx vitest run src/hexagons/slice/domain/slice.aggregate.spec.ts`
- **Expect:** FAIL — `setPlanPath` not defined

2. **GREEN** — In `slice.aggregate.ts`, add after `setResearchPath`:
```typescript
setPlanPath(path: string, now: Date): void {
  this.props.planPath = path;
  this.props.updatedAt = now;
}
```
- **Run:** `npx vitest run src/hexagons/slice/domain/slice.aggregate.spec.ts`
- **Expect:** PASS

3. **Commit:** `feat(S07/T02): add setPlanPath to Slice aggregate`

---

### T03: Create `CreateTasksPort` interface (task hexagon)

**Files:** Create `src/hexagons/task/domain/ports/create-tasks.port.ts`
**Traces to:** AC5, AC6
**Deps:** —

No TDD needed (pure interface, no logic).

1. **Create** `src/hexagons/task/domain/ports/create-tasks.port.ts`:
```typescript
import type { Result } from "@kernel";
import type { CyclicDependencyError } from "../errors/cyclic-dependency.error";
import type { PersistenceError } from "@kernel";

export interface TaskInput {
  label: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  filePaths: string[];
  blockedBy: string[];
}

export interface CreateTasksResult {
  taskCount: number;
  waveCount: number;
}

export abstract class CreateTasksPort {
  abstract createTasks(params: {
    sliceId: string;
    tasks: TaskInput[];
  }): Promise<Result<CreateTasksResult, PersistenceError | CyclicDependencyError>>;
}
```

2. **Run:** `npx vitest run` (ensure no compilation errors)
3. **Commit:** `feat(S07/T03): add CreateTasksPort interface`

---

## Wave 1 (depends on Wave 0)

### T04: Create `CreateTasksUseCase` in task hexagon + tests

**Files:** Create `src/hexagons/task/application/create-tasks.use-case.ts`, Create `src/hexagons/task/application/create-tasks.use-case.spec.ts`, Modify `src/hexagons/task/index.ts`
**Traces to:** AC6, AC9
**Deps:** T01 (blockedBy param), T03 (CreateTasksPort interface)

#### TDD

1. **RED** — Create `create-tasks.use-case.spec.ts`:
```typescript
import { InMemoryTaskRepository } from "../infrastructure/in-memory-task.repository";
import { DetectWavesUseCase } from "../domain/detect-waves.use-case";
import { CreateTasksUseCase } from "./create-tasks.use-case";
import { isOk, isErr } from "@kernel";

function setup() {
  const taskRepo = new InMemoryTaskRepository();
  const waveDetection = new DetectWavesUseCase();
  const fixedNow = new Date("2026-03-27T12:00:00Z");
  const dateProvider = { now: () => fixedNow };
  const useCase = new CreateTasksUseCase(taskRepo, waveDetection, dateProvider);
  return { useCase, taskRepo, waveDetection, fixedNow };
}

describe("CreateTasksUseCase", () => {
  it("should create tasks, resolve deps, detect waves, assign waveIndex", async () => {
    const { useCase, taskRepo } = setup();
    const sliceId = crypto.randomUUID();
    const result = await useCase.createTasks({
      sliceId,
      tasks: [
        { label: "T01", title: "First", description: "desc", acceptanceCriteria: "AC1",
          filePaths: ["a.ts"], blockedBy: [] },
        { label: "T02", title: "Second", description: "desc", acceptanceCriteria: "AC2",
          filePaths: ["b.ts"], blockedBy: ["T01"] },
      ],
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.taskCount).toBe(2);
      expect(result.data.waveCount).toBe(2);
    }
    // Verify tasks persisted with correct waveIndex
    const tasks = await taskRepo.findBySliceId(sliceId);
    if (isOk(tasks)) {
      const t01 = tasks.data.find(t => t.label === "T01");
      const t02 = tasks.data.find(t => t.label === "T02");
      expect(t01?.waveIndex).toBe(0);
      expect(t02?.waveIndex).toBe(1);
      expect(t02?.blockedBy).toHaveLength(1);
    }
  });

  it("should return CyclicDependencyError when deps have cycles", async () => {
    const { useCase } = setup();
    const result = await useCase.createTasks({
      sliceId: crypto.randomUUID(),
      tasks: [
        { label: "T01", title: "A", description: "", acceptanceCriteria: "",
          filePaths: [], blockedBy: ["T02"] },
        { label: "T02", title: "B", description: "", acceptanceCriteria: "",
          filePaths: [], blockedBy: ["T01"] },
      ],
    });
    expect(isErr(result)).toBe(true);
  });
});
```
- **Run:** `npx vitest run src/hexagons/task/application/create-tasks.use-case.spec.ts`
- **Expect:** FAIL — module not found

2. **GREEN** — Create `create-tasks.use-case.ts`:
```typescript
import type { DateProviderPort, PersistenceError, Result } from "@kernel";
import { err, isErr, ok } from "@kernel";
import type { CyclicDependencyError } from "../domain/errors/cyclic-dependency.error";
import type { CreateTasksPort, CreateTasksResult, TaskInput } from "../domain/ports/create-tasks.port";
import type { TaskRepositoryPort } from "../domain/ports/task-repository.port";
import type { WaveDetectionPort } from "../domain/ports/wave-detection.port";
import { Task } from "../domain/task.aggregate";
import type { TaskDependencyInput } from "../domain/wave.schemas";

export class CreateTasksUseCase implements CreateTasksPort {
  constructor(
    private readonly taskRepo: TaskRepositoryPort,
    private readonly waveDetection: WaveDetectionPort,
    private readonly dateProvider: DateProviderPort,
  ) {}

  async createTasks(params: {
    sliceId: string;
    tasks: TaskInput[];
  }): Promise<Result<CreateTasksResult, PersistenceError | CyclicDependencyError>> {
    const now = this.dateProvider.now();
    const labelToId = new Map<string, string>();

    // Pre-pass: generate UUIDs, build label->ID map
    for (const t of params.tasks) {
      labelToId.set(t.label, crypto.randomUUID());
    }

    // Create all tasks with resolved blockedBy
    const tasks: Task[] = [];
    for (const t of params.tasks) {
      const resolvedBlockedBy = t.blockedBy.map(label => labelToId.get(label)!);
      const task = Task.createNew({
        id: labelToId.get(t.label)!,
        sliceId: params.sliceId,
        label: t.label,
        title: t.title,
        description: t.description,
        acceptanceCriteria: t.acceptanceCriteria,
        filePaths: t.filePaths,
        blockedBy: resolvedBlockedBy,
        now,
      });
      const saveResult = await this.taskRepo.save(task);
      if (isErr(saveResult)) return saveResult;
      tasks.push(task);
    }

    // Wave detection
    const depInputs: TaskDependencyInput[] = tasks.map(t => ({
      id: t.id,
      blockedBy: [...t.blockedBy],
    }));
    const wavesResult = this.waveDetection.detectWaves(depInputs);
    if (isErr(wavesResult)) return wavesResult;

    // Assign waves
    for (const wave of wavesResult.data) {
      for (const taskId of wave.taskIds) {
        const task = tasks.find(t => t.id === taskId)!;
        task.assignToWave(wave.index, now);
        const saveResult = await this.taskRepo.save(task);
        if (isErr(saveResult)) return saveResult;
      }
    }

    return ok({ taskCount: tasks.length, waveCount: wavesResult.data.length });
  }
}
```
- **Run:** `npx vitest run src/hexagons/task/application/create-tasks.use-case.spec.ts`
- **Expect:** PASS

3. **Barrel export** deferred to T09.

4. **Commit:** `feat(S07/T04): add CreateTasksUseCase with single-pass creation + wave detection`

---

### T05: Create `WritePlanUseCase` + tests

**Files:** Create `src/hexagons/workflow/use-cases/write-plan.use-case.ts`, Create `src/hexagons/workflow/use-cases/write-plan.use-case.spec.ts`
**Traces to:** AC5, AC7, AC15
**Deps:** T02 (setPlanPath), T03 (CreateTasksPort)

#### TDD

1. **RED** — Create `write-plan.use-case.spec.ts` following write-research.spec.ts pattern:
```typescript
import { SliceBuilder } from "@hexagons/slice/domain/slice.builder";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { err, isErr, isOk, ok, PersistenceError } from "@kernel";
import { describe, expect, it } from "vitest";
import { CreateTasksPort } from "@hexagons/task";
import { InMemoryArtifactFileAdapter } from "../infrastructure/in-memory-artifact-file.adapter";
import { WritePlanUseCase } from "./write-plan.use-case";

function setup() {
  const sliceRepo = new InMemorySliceRepository();
  const artifactFile = new InMemoryArtifactFileAdapter();
  const fixedNow = new Date("2026-03-27T12:00:00Z");
  const dateProvider = { now: () => fixedNow };
  const createTasksPort = Object.assign(Object.create(CreateTasksPort.prototype), {
    createTasks: async () => ok({ taskCount: 2, waveCount: 1 }),
  });
  const useCase = new WritePlanUseCase(artifactFile, sliceRepo, createTasksPort, dateProvider);
  return { useCase, sliceRepo, artifactFile, createTasksPort, dateProvider, fixedNow };
}

describe("WritePlanUseCase", () => {
  it("should write PLAN.md, create tasks, update slice planPath", async () => {
    const { useCase, sliceRepo, artifactFile } = setup();
    const sliceId = crypto.randomUUID();
    const slice = new SliceBuilder().withId(sliceId).build();
    sliceRepo.seed(slice);

    const result = await useCase.execute({
      milestoneLabel: "M03", sliceLabel: "M03-S07", sliceId,
      content: "# Plan", tasks: [
        { label: "T01", title: "First", description: "d", acceptanceCriteria: "AC1",
          filePaths: ["a.ts"], blockedBy: [] },
      ],
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.path).toContain("PLAN.md");
      expect(result.data.taskCount).toBe(2);
    }

    const updated = await sliceRepo.findById(sliceId);
    if (isOk(updated) && updated.data) expect(updated.data.planPath).toContain("PLAN.md");
  });

  // + FileIOError, SliceNotFoundError, PersistenceError, CyclicDependencyError tests
});
```
- **Run:** `npx vitest run src/hexagons/workflow/use-cases/write-plan.use-case.spec.ts`
- **Expect:** FAIL

2. **GREEN** — Create `write-plan.use-case.ts`:
```typescript
import type { SliceRepositoryPort } from "@hexagons/slice";
import { SliceNotFoundError } from "@hexagons/slice";
import type { CyclicDependencyError } from "@hexagons/task";
import type { DateProviderPort, PersistenceError } from "@kernel";
import { err, isErr, ok, type Result } from "@kernel";
import type { CreateTasksPort, TaskInput } from "@hexagons/task";
import type { FileIOError } from "../domain/errors/file-io.error";
import type { ArtifactFilePort } from "../domain/ports/artifact-file.port";

export interface WritePlanInput {
  milestoneLabel: string;
  sliceLabel: string;
  sliceId: string;
  content: string;
  tasks: TaskInput[];
}

export class WritePlanUseCase {
  constructor(
    private readonly artifactFilePort: ArtifactFilePort,
    private readonly sliceRepo: SliceRepositoryPort,
    private readonly createTasksPort: CreateTasksPort,
    private readonly dateProvider: DateProviderPort,
  ) {}

  async execute(input: WritePlanInput): Promise<Result<
    { path: string; taskCount: number; waveCount: number },
    FileIOError | SliceNotFoundError | PersistenceError | CyclicDependencyError
  >> {
    const writeResult = await this.artifactFilePort.write(
      input.milestoneLabel, input.sliceLabel, "plan", input.content,
    );
    if (isErr(writeResult)) return writeResult;

    const sliceResult = await this.sliceRepo.findById(input.sliceId);
    if (isErr(sliceResult)) return sliceResult;
    if (!sliceResult.data) return err(new SliceNotFoundError(input.sliceId));

    const tasksResult = await this.createTasksPort.createTasks({
      sliceId: input.sliceId, tasks: input.tasks,
    });
    if (isErr(tasksResult)) return tasksResult;

    sliceResult.data.setPlanPath(writeResult.data, this.dateProvider.now());
    const saveResult = await this.sliceRepo.save(sliceResult.data);
    if (isErr(saveResult)) return saveResult;

    return ok({
      path: writeResult.data,
      taskCount: tasksResult.data.taskCount,
      waveCount: tasksResult.data.waveCount,
    });
  }
}
```
- **Run:** `npx vitest run src/hexagons/workflow/use-cases/write-plan.use-case.spec.ts`
- **Expect:** PASS

3. **Commit:** `feat(S07/T05): add WritePlanUseCase`

---

## Wave 2 (depends on Wave 1)

### T06: Create `tff_write_plan` tool

**Files:** Create `src/hexagons/workflow/infrastructure/pi/write-plan.tool.ts`
**Traces to:** AC8
**Deps:** T05 (WritePlanUseCase)

1. **Create** `write-plan.tool.ts` following write-research.tool.ts pattern:
```typescript
import { MilestoneLabelSchema } from "@hexagons/milestone";
import { SliceLabelSchema } from "@hexagons/slice";
import { createZodTool, textResult } from "@infrastructure/pi";
import { IdSchema, isErr } from "@kernel";
import { z } from "zod";
import type { WritePlanUseCase } from "../../use-cases/write-plan.use-case";

const WritePlanSchema = z.object({
  milestoneLabel: MilestoneLabelSchema.describe("Milestone label, e.g. M03"),
  sliceLabel: SliceLabelSchema.describe("Slice label, e.g. M03-S07"),
  sliceId: IdSchema.describe("Slice UUID"),
  content: z.string().describe("Markdown plan content"),
  tasks: z.array(z.object({
    label: z.string().describe("Task label, e.g. T01"),
    title: z.string().describe("Task title"),
    description: z.string().describe("Task description with TDD steps"),
    acceptanceCriteria: z.string().describe("Joined AC refs, e.g. 'AC1, AC3'"),
    filePaths: z.array(z.string()).describe("Exact file paths"),
    blockedBy: z.array(z.string()).default([]).describe("Labels of blocking tasks"),
  })).describe("Task definitions"),
});

export function createWritePlanTool(useCase: WritePlanUseCase) {
  return createZodTool({
    name: "tff_write_plan",
    label: "TFF Write Plan",
    description: "Write PLAN.md, create task entities with wave detection, update slice.",
    schema: WritePlanSchema,
    execute: async (params) => {
      const result = await useCase.execute(params);
      if (isErr(result)) return textResult(`Error: ${result.error.message}`);
      return textResult(JSON.stringify({
        ok: true, path: result.data.path,
        taskCount: result.data.taskCount, waveCount: result.data.waveCount,
      }));
    },
  });
}
```
- **Run:** `npx vitest run` (compilation check)
- **Commit:** `feat(S07/T06): add tff_write_plan tool`

---

### T07: Create plan protocol template + builder

**Files:** Create `src/hexagons/workflow/infrastructure/pi/plan-protocol.ts`, Create `src/hexagons/workflow/infrastructure/pi/templates/protocols/plan.md`
**Traces to:** AC10, AC11
**Deps:** T05 (conceptual — protocol references tool)

1. **Create** `templates/protocols/plan.md` (compressed notation):
```markdown
You are now in the PLANNING phase for slice {{sliceLabel}}: {{sliceTitle}}.

## Context
- Slice ID: {{sliceId}}
- Milestone: {{milestoneLabel}} (ID: {{milestoneId}})
- Description: {{sliceDescription}}
- Autonomy mode: {{autonomyMode}}

## SPEC.md

{{specContent}}

{{researchSection}}

## Instructions — Plan Decomposition

∀ task in plan: exact file path, AC refs, TDD steps. ¬"add to the service" ¬"implement X".

### P1 — Decompose
1. Read SPEC.md + RESEARCH.md (if present)
2. Break spec → tasks (2-5 min each)
3. ∀ task: label (T01...), title, description, exact file paths (create/modify/test), AC refs, TDD steps, blockedBy labels
4. TDD ∀ task: RED (failing test) → GREEN (minimal impl) → REFACTOR → commit

### P2 — Structure
5. Arrange tasks → dependency graph (blockedBy labels)
6. Validate ¬cycles
7. Format PLAN.md:
   - Summary (2-3 lines)
   - Task table: | # | Title | Files | Deps | Wave |
   - ∀ task: detailed section w/ TDD steps

### P3 — Write
8. Call `tff_write_plan` with:
   - milestoneLabel="{{milestoneLabel}}", sliceLabel="{{sliceLabel}}", sliceId="{{sliceId}}"
   - content: full PLAN.md markdown
   - tasks: array of {label, title, description, acceptanceCriteria, filePaths, blockedBy}
9. Report result: wave count, task count

### P4 — Human Gate
10. Present plan summary to user: waves, tasks, files affected
11. Ask: "Plan written to PLAN.md. **Approve** to proceed to execution, or **reject** to revise?"
12. reject ⇒ revise based on feedback, rewrite via `tff_write_plan` (max 2 iterations), ask again
13. approve ⇒ call `tff_workflow_transition` with milestoneId="{{milestoneId}}", trigger="approve"
14. {{autonomyInstruction}}
```

2. **Create** `plan-protocol.ts`:
```typescript
import { readFileSync } from "node:fs";

export interface PlanProtocolParams {
  sliceId: string;
  sliceLabel: string;
  sliceTitle: string;
  sliceDescription: string;
  milestoneLabel: string;
  milestoneId: string;
  specContent: string;
  researchContent: string | null;
  autonomyMode: string;
}

const template = readFileSync(
  new URL("./templates/protocols/plan.md", import.meta.url), "utf-8",
);

function render(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

export function buildPlanProtocolMessage(params: PlanProtocolParams): string {
  const autonomyInstruction = params.autonomyMode === "plan-to-pr"
    ? `After approval, invoke the next phase: \`/tff:execute ${params.sliceLabel}\`.`
    : `After approval, suggest: "Next: \`/tff:execute ${params.sliceLabel}\`."`;

  const researchSection = params.researchContent
    ? `## RESEARCH.md\n\n${params.researchContent}`
    : "";

  return render(template, { ...params, autonomyInstruction, researchSection });
}
```
- **Run:** `npx vitest run` (compilation check)
- **Commit:** `feat(S07/T07): add plan protocol template with compressed notation`

---

## Wave 3 (depends on Wave 2)

### T08: Create plan command handler + tests

**Files:** Create `src/hexagons/workflow/infrastructure/pi/plan.command.ts`, Create `src/hexagons/workflow/infrastructure/pi/plan.command.spec.ts`
**Traces to:** AC1, AC2, AC3, AC4
**Deps:** T07 (protocol builder)

#### TDD

1. **RED** — Create `plan.command.spec.ts` following research.command.spec.ts pattern:
```typescript
import { describe, expect, it, vi } from "vitest";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { InMemoryMilestoneRepository } from "@hexagons/milestone/infrastructure/in-memory-milestone.repository";
import { SliceBuilder } from "@hexagons/slice/domain/slice.builder";
import { MilestoneBuilder } from "@hexagons/milestone/domain/milestone.builder";
import { ok } from "@kernel";
import { registerPlanCommand } from "./plan.command";
import { InMemoryArtifactFileAdapter } from "../in-memory-artifact-file.adapter";

// Reuse the mock ExtensionAPI/ctx pattern from research.command.spec.ts

describe("registerPlanCommand", () => {
  it("should send protocol when phase is planning and SPEC.md exists", async () => {
    // Setup: slice in planning phase, SPEC.md artifact seeded, session exists
    // Assert: ctx.sendUserMessage called with protocol content
  });

  it("should error when session phase is not planning", async () => {
    // Setup: session in 'discussing' phase
    // Assert: returns error "not planning"
  });

  it("should error when no workflow session exists", async () => {
    // Setup: no session for milestone
    // Assert: returns "No workflow session found"
  });

  it("should error when SPEC.md does not exist", async () => {
    // Setup: planning phase, no spec artifact
    // Assert: returns "No SPEC.md found"
  });

  it("should proceed without RESEARCH.md when not present", async () => {
    // Setup: planning phase, SPEC.md present, no RESEARCH.md
    // Assert: protocol sent with null researchContent
  });
});
```
- **Run:** `npx vitest run src/hexagons/workflow/infrastructure/pi/plan.command.spec.ts`
- **Expect:** FAIL

2. **GREEN** — Create `plan.command.ts` following research.command.ts pattern:
```typescript
import type { MilestoneRepositoryPort } from "@hexagons/milestone";
import type { SliceRepositoryPort } from "@hexagons/slice";
import type { ExtensionAPI, ExtensionCommandContext } from "@infrastructure/pi";
import { isErr } from "@kernel";
import type { ArtifactFilePort } from "../../domain/ports/artifact-file.port";
import type { WorkflowSessionRepositoryPort } from "../../domain/ports/workflow-session.repository.port";
import { buildPlanProtocolMessage } from "./plan-protocol";

export interface PlanCommandDeps {
  sliceRepo: SliceRepositoryPort;
  milestoneRepo: MilestoneRepositoryPort;
  sessionRepo: WorkflowSessionRepositoryPort;
  artifactFile: ArtifactFilePort;
}

export function registerPlanCommand(api: ExtensionAPI, deps: PlanCommandDeps): void {
  api.registerCommand("tff:plan", {
    description: "Start the planning phase — decompose spec into tasks with wave detection",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      // Same pattern as research.command.ts:
      // 1. Resolve slice, 2. Load milestone, 3. Load session,
      // 4. Validate phase=planning, 5. Read SPEC.md, 6. Read RESEARCH.md (optional),
      // 7. Send protocol
    },
  });
}
```
- **Run:** `npx vitest run src/hexagons/workflow/infrastructure/pi/plan.command.spec.ts`
- **Expect:** PASS

3. **Commit:** `feat(S07/T08): add tff:plan command handler`

---

### T09: Wire WorkflowExtension + barrel exports

**Files:** Modify `src/hexagons/workflow/infrastructure/pi/workflow.extension.ts`, Modify `src/hexagons/workflow/index.ts`, Modify `src/hexagons/task/index.ts`, Modify `src/hexagons/workflow/infrastructure/pi/workflow.extension.spec.ts`
**Traces to:** AC14
**Deps:** T04, T05, T06, T07, T08

1. **Modify** `workflow.extension.ts`:
   - Add `createTasksPort: CreateTasksPort` to `WorkflowExtensionDeps` (import `CreateTasksPort` from `@hexagons/task`)
   - Instantiate `WritePlanUseCase(deps.artifactFile, deps.sliceRepo, deps.createTasksPort, deps.dateProvider)`
   - Register `createWritePlanTool(writePlan)`
   - Register `registerPlanCommand(api, { sliceRepo, milestoneRepo, sessionRepo, artifactFile })`

2. **Modify** `workflow/index.ts` — add exports:
   - `WritePlanUseCase` from use-cases
   - `createWritePlanTool` from infrastructure/pi
   - `registerPlanCommand`, `PlanCommandDeps` from infrastructure/pi
   - `buildPlanProtocolMessage`, `PlanProtocolParams` from infrastructure/pi

3. **Modify** `task/index.ts` — add exports:
   - `CreateTasksPort`, `TaskInput`, `CreateTasksResult` from domain/ports/create-tasks.port
   - `CreateTasksUseCase` from application/create-tasks.use-case

4. **Update** workflow.extension.spec.ts if needed for new dep

4. **Run:** `npx vitest run src/hexagons/workflow/`
- **Expect:** PASS

5. **Commit:** `feat(S07/T09): wire plan command into WorkflowExtension + barrel exports`

---

## Dependency Graph

```
Wave 0:  T01  T02  T03
           \   |   /
Wave 1:    T04  T05
             |   |
Wave 2:    T06  T07
              \ /
Wave 3:    T08  T09
```

T04 depends on T01, T03
T05 depends on T02, T03
T06 depends on T05
T07 depends on — (conceptual only)
T08 depends on T07
T09 depends on T04, T05, T06, T07, T08
