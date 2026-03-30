# M03-S06: Research Command — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Implement `/tff:research` command — protocol-driven research agent dispatch producing RESEARCH.md.
**Architecture:** Workflow hexagon, S05 mirror pattern (read-only dispatcher + protocol message + WriteResearchUseCase).
**Tech Stack:** TypeScript, Zod, Vitest, hexagonal architecture.

## File Structure

### New Files
- `src/hexagons/workflow/use-cases/write-research.use-case.ts` — WriteResearchUseCase
- `src/hexagons/workflow/use-cases/write-research.use-case.spec.ts` — Use case tests
- `src/hexagons/workflow/infrastructure/pi/write-research.tool.ts` — tff_write_research tool
- `src/hexagons/workflow/infrastructure/pi/research.command.ts` — Command handler + ResearchCommandDeps
- `src/hexagons/workflow/infrastructure/pi/research-protocol.ts` — Protocol message builder

### Modified Files
- `src/hexagons/slice/domain/slice.aggregate.ts` — +setResearchPath()
- `src/hexagons/slice/domain/slice.aggregate.spec.ts` — +setResearchPath tests
- `src/hexagons/workflow/infrastructure/pi/write-spec.tool.ts` — Retrofit IdSchema
- `src/hexagons/workflow/infrastructure/pi/workflow.extension.ts` — Register tool + command
- `src/hexagons/workflow/index.ts` — Barrel exports

---

## Wave 0 (parallel — no dependencies)

### T01: Slice.setResearchPath() + tests
**Files:** Modify `src/hexagons/slice/domain/slice.aggregate.ts`, Modify `src/hexagons/slice/domain/slice.aggregate.spec.ts`
**Traces to:** AC8

- [ ] Step 1: Write failing test

```typescript
// In src/hexagons/slice/domain/slice.aggregate.spec.ts
// Add after the "setComplexity" describe block:

describe("setResearchPath", () => {
  it("should set researchPath and update updatedAt", () => {
    const s = Slice.createNew({ id, milestoneId, label: "M01-S01", title: "Schemas", now });

    s.setResearchPath("/path/to/RESEARCH.md", later);

    expect(s.researchPath).toBe("/path/to/RESEARCH.md");
    expect(s.updatedAt).toEqual(later);
  });
});
```

- [ ] Step 2: Run `npx vitest run src/hexagons/slice/domain/slice.aggregate.spec.ts`, verify FAIL — `s.setResearchPath is not a function`

- [ ] Step 3: Implement in `src/hexagons/slice/domain/slice.aggregate.ts`

```typescript
// Add after setComplexity method (line 137):

setResearchPath(path: string, now: Date): void {
  this.props.researchPath = path;
  this.props.updatedAt = now;
}
```

- [ ] Step 4: Run `npx vitest run src/hexagons/slice/domain/slice.aggregate.spec.ts`, verify PASS
- [ ] Step 5: Commit `feat(S06/T01): add Slice.setResearchPath() method`

---

### T02: Retrofit tff_write_spec to use IdSchema
**Files:** Modify `src/hexagons/workflow/infrastructure/pi/write-spec.tool.ts`
**Traces to:** AC13

- [ ] Step 1: Write failing test — run existing tests to confirm they pass as baseline

```bash
npx vitest run src/hexagons/workflow/use-cases/write-spec.use-case.spec.ts
```

- [ ] Step 2: Modify `src/hexagons/workflow/infrastructure/pi/write-spec.tool.ts`

```typescript
// Change line 1 to add IdSchema import:
import { MilestoneLabelSchema } from "@hexagons/milestone";
import { SliceLabelSchema } from "@hexagons/slice";
import { createZodTool, textResult } from "@infrastructure/pi";
import { IdSchema, isErr } from "@kernel";
import { z } from "zod";
import type { WriteSpecUseCase } from "../../use-cases/write-spec.use-case";

const WriteSpecSchema = z.object({
  milestoneLabel: MilestoneLabelSchema.describe("Milestone label, e.g. M03"),
  sliceLabel: SliceLabelSchema.describe("Slice label, e.g. M03-S05"),
  sliceId: IdSchema.describe("Slice UUID"),
  content: z.string().describe("Markdown spec content"),
});
```

- [ ] Step 3: Run `npx vitest run src/hexagons/workflow/use-cases/write-spec.use-case.spec.ts`, verify PASS (existing behavior preserved)
- [ ] Step 4: Commit `refactor(S06/T02): retrofit tff_write_spec to use IdSchema for sliceId`

---

## Wave 1 (depends on Wave 0)

### T03: WriteResearchUseCase + tests
**Files:** Create `src/hexagons/workflow/use-cases/write-research.use-case.ts`, Create `src/hexagons/workflow/use-cases/write-research.use-case.spec.ts`
**Traces to:** AC5, AC6, AC15
**Depends on:** T01 (Slice.setResearchPath)

- [ ] Step 1: Write failing tests

```typescript
// src/hexagons/workflow/use-cases/write-research.use-case.spec.ts
import { SliceBuilder } from "@hexagons/slice/domain/slice.builder";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { err, isErr, isOk, ok } from "@kernel";
import { describe, expect, it } from "vitest";

import { FileIOError } from "../domain/errors/file-io.error";
import { ArtifactFilePort } from "../domain/ports/artifact-file.port";
import { InMemoryArtifactFileAdapter } from "../infrastructure/in-memory-artifact-file.adapter";
import { WriteResearchUseCase } from "./write-research.use-case";

function setup() {
  const sliceRepo = new InMemorySliceRepository();
  const artifactFile = new InMemoryArtifactFileAdapter();
  const fixedNow = new Date("2026-03-27T12:00:00Z");
  const dateProvider = { now: () => fixedNow };
  const useCase = new WriteResearchUseCase(artifactFile, sliceRepo, dateProvider);
  return { useCase, sliceRepo, artifactFile, dateProvider, fixedNow };
}

describe("WriteResearchUseCase", () => {
  it("should write RESEARCH.md and update slice researchPath", async () => {
    const { useCase, sliceRepo, artifactFile } = setup();
    const sliceId = crypto.randomUUID();
    const slice = new SliceBuilder().withId(sliceId).build();
    sliceRepo.seed(slice);

    const result = await useCase.execute({
      milestoneLabel: "M03",
      sliceLabel: "M03-S06",
      sliceId,
      content: "# Research Findings",
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.data.path).toContain("RESEARCH.md");

    // Verify file was written
    const readResult = await artifactFile.read("M03", "M03-S06", "research");
    if (isOk(readResult)) expect(readResult.data).toBe("# Research Findings");

    // Verify slice researchPath updated
    const updated = await sliceRepo.findById(sliceId);
    if (isOk(updated) && updated.data) expect(updated.data.researchPath).toContain("RESEARCH.md");
  });

  it("should return FileIOError when write fails", async () => {
    const { sliceRepo, dateProvider } = setup();
    const failingAdapter = Object.assign(Object.create(ArtifactFilePort.prototype), {
      write: async () => err(new FileIOError("Disk full")),
      read: async () => ok(null),
    });
    const failUseCase = new WriteResearchUseCase(failingAdapter, sliceRepo, dateProvider);
    const sliceId = crypto.randomUUID();
    const slice = new SliceBuilder().withId(sliceId).build();
    sliceRepo.seed(slice);

    const result = await failUseCase.execute({
      milestoneLabel: "M03",
      sliceLabel: "M03-S06",
      sliceId,
      content: "# Research",
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("WORKFLOW.FILE_IO");
  });

  it("should return SliceNotFoundError when slice missing", async () => {
    const { useCase } = setup();
    const result = await useCase.execute({
      milestoneLabel: "M03",
      sliceLabel: "M03-S06",
      sliceId: crypto.randomUUID(),
      content: "# Research",
    });
    expect(isErr(result)).toBe(true);
  });
});
```

- [ ] Step 2: Run `npx vitest run src/hexagons/workflow/use-cases/write-research.use-case.spec.ts`, verify FAIL — cannot resolve module

- [ ] Step 3: Implement use case

```typescript
// src/hexagons/workflow/use-cases/write-research.use-case.ts
import type { SliceRepositoryPort } from "@hexagons/slice";
import { SliceNotFoundError } from "@hexagons/slice";
import type { DateProviderPort, PersistenceError } from "@kernel";
import { err, isErr, ok, type Result } from "@kernel";
import type { FileIOError } from "../domain/errors/file-io.error";
import type { ArtifactFilePort } from "../domain/ports/artifact-file.port";

export interface WriteResearchInput {
  milestoneLabel: string;
  sliceLabel: string;
  sliceId: string;
  content: string;
}

export class WriteResearchUseCase {
  constructor(
    private readonly artifactFilePort: ArtifactFilePort,
    private readonly sliceRepo: SliceRepositoryPort,
    private readonly dateProvider: DateProviderPort,
  ) {}

  async execute(
    input: WriteResearchInput,
  ): Promise<Result<{ path: string }, FileIOError | SliceNotFoundError | PersistenceError>> {
    const writeResult = await this.artifactFilePort.write(
      input.milestoneLabel,
      input.sliceLabel,
      "research",
      input.content,
    );
    if (isErr(writeResult)) return writeResult;

    const sliceResult = await this.sliceRepo.findById(input.sliceId);
    if (isErr(sliceResult)) return sliceResult;
    if (!sliceResult.data) return err(new SliceNotFoundError(input.sliceId));

    sliceResult.data.setResearchPath(writeResult.data, this.dateProvider.now());

    const saveResult = await this.sliceRepo.save(sliceResult.data);
    if (isErr(saveResult)) return saveResult;

    return ok({ path: writeResult.data });
  }
}
```

- [ ] Step 4: Run `npx vitest run src/hexagons/workflow/use-cases/write-research.use-case.spec.ts`, verify PASS — 3/3 tests
- [ ] Step 5: Commit `feat(S06/T03): add WriteResearchUseCase`

---

### T04: Research protocol message builder
**Files:** Create `src/hexagons/workflow/infrastructure/pi/research-protocol.ts`
**Traces to:** AC9, AC10, AC11

- [ ] Step 1: Write test

```typescript
// src/hexagons/workflow/infrastructure/pi/research-protocol.spec.ts
import { describe, expect, it } from "vitest";
import { buildResearchProtocolMessage } from "./research-protocol";

describe("buildResearchProtocolMessage", () => {
  const params = {
    sliceId: "uuid-123",
    sliceLabel: "M03-S06",
    sliceTitle: "Research command",
    sliceDescription: "Agent-dispatched research",
    milestoneLabel: "M03",
    milestoneId: "ms-uuid",
    specContent: "# Spec Content\n\nSome spec...",
    autonomyMode: "plan-to-pr",
  };

  it("should include slice context", () => {
    const msg = buildResearchProtocolMessage(params);
    expect(msg).toContain("M03-S06");
    expect(msg).toContain("Research command");
    expect(msg).toContain("uuid-123");
    expect(msg).toContain("ms-uuid");
  });

  it("should embed SPEC.md content", () => {
    const msg = buildResearchProtocolMessage(params);
    expect(msg).toContain("# Spec Content");
    expect(msg).toContain("Some spec...");
  });

  it("should contain all three phases", () => {
    const msg = buildResearchProtocolMessage(params);
    expect(msg).toContain("Phase 1");
    expect(msg).toContain("Phase 2");
    expect(msg).toContain("Phase 3");
  });

  it("should contain RESEARCH.md section structure", () => {
    const msg = buildResearchProtocolMessage(params);
    expect(msg).toContain("Questions Investigated");
    expect(msg).toContain("Codebase Findings");
    expect(msg).toContain("Technical Risks");
    expect(msg).toContain("Recommendations for Planning");
  });

  it("should reference tff_write_research tool", () => {
    const msg = buildResearchProtocolMessage(params);
    expect(msg).toContain("tff_write_research");
  });

  it("should reference tff_workflow_transition tool", () => {
    const msg = buildResearchProtocolMessage(params);
    expect(msg).toContain("tff_workflow_transition");
  });

  it("should auto-invoke next command for plan-to-pr mode", () => {
    const msg = buildResearchProtocolMessage(params);
    expect(msg).toContain("/tff:plan");
  });

  it("should suggest next step for guided mode", () => {
    const msg = buildResearchProtocolMessage({ ...params, autonomyMode: "guided" });
    expect(msg).toContain("/tff:plan");
    expect(msg).toContain("suggest");
  });
});
```

- [ ] Step 2: Run `npx vitest run src/hexagons/workflow/infrastructure/pi/research-protocol.spec.ts`, verify FAIL

- [ ] Step 3: Implement protocol builder

```typescript
// src/hexagons/workflow/infrastructure/pi/research-protocol.ts
export interface ResearchProtocolParams {
  sliceId: string;
  sliceLabel: string;
  sliceTitle: string;
  sliceDescription: string;
  milestoneLabel: string;
  milestoneId: string;
  specContent: string;
  autonomyMode: string;
}

export function buildResearchProtocolMessage(params: ResearchProtocolParams): string {
  return `You are now in the RESEARCH phase for slice ${params.sliceLabel}: ${params.sliceTitle}.

## Context
- Slice ID: ${params.sliceId}
- Milestone: ${params.milestoneLabel} (ID: ${params.milestoneId})
- Description: ${params.sliceDescription}
- Autonomy mode: ${params.autonomyMode}

## SPEC.md Content

${params.specContent}

## Instructions

Conduct codebase research to inform the planning phase. Follow these three phases:

### Phase 1 — Research Dispatch
1. Review the SPEC.md content above.
2. Identify 3-5 key research questions:
   - What existing code patterns are relevant?
   - What files/modules will be affected?
   - What dependencies exist between components?
   - What technical risks need investigation?
3. Dispatch a single Explore agent via the Agent tool with these research questions. Instruct the agent to search the codebase for patterns, files, and dependencies.

### Phase 2 — Synthesis
4. Receive the agent's findings.
5. Synthesize into a structured RESEARCH.md with these sections:
   - **Questions Investigated** — the research questions and why they matter
   - **Codebase Findings** — subsections for Existing Patterns, Relevant Files, Dependencies
   - **Technical Risks** — anything that could complicate planning or execution
   - **Recommendations for Planning** — concrete suggestions for the plan phase
6. Call \`tff_write_research\` with milestoneLabel="${params.milestoneLabel}", sliceLabel="${params.sliceLabel}", sliceId="${params.sliceId}", and the full research content as markdown.

### Phase 3 — User Gate
7. Present a concise summary of key findings to the user.
8. Ask: "Research complete. Approve to proceed to planning, or request deeper investigation on specific areas?"
9. If the user requests more investigation: dispatch another Explore agent for the specific area (max 2 total investigation rounds), update RESEARCH.md via \`tff_write_research\`, and ask again.
10. On approval: call \`tff_workflow_transition\` with milestoneId="${params.milestoneId}", trigger="next".
11. ${params.autonomyMode === "plan-to-pr" ? "Invoke the next phase command automatically: `/tff:plan " + params.sliceLabel + "`." : "Suggest the next step: `/tff:plan " + params.sliceLabel + "`."}`;
}
```

- [ ] Step 4: Run `npx vitest run src/hexagons/workflow/infrastructure/pi/research-protocol.spec.ts`, verify PASS — 8/8 tests
- [ ] Step 5: Commit `feat(S06/T04): add research protocol message builder`

---

## Wave 2 (depends on Wave 1)

### T05: tff_write_research tool
**Files:** Create `src/hexagons/workflow/infrastructure/pi/write-research.tool.ts`
**Traces to:** AC7
**Depends on:** T03 (WriteResearchUseCase)

- [ ] Step 1: Write test

```typescript
// src/hexagons/workflow/infrastructure/pi/write-research.tool.spec.ts
import { SliceBuilder } from "@hexagons/slice/domain/slice.builder";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { isOk } from "@kernel";
import { describe, expect, it } from "vitest";

import { InMemoryArtifactFileAdapter } from "../../infrastructure/in-memory-artifact-file.adapter";
import { WriteResearchUseCase } from "../../use-cases/write-research.use-case";
import { createWriteResearchTool } from "./write-research.tool";

function setup() {
  const sliceRepo = new InMemorySliceRepository();
  const artifactFile = new InMemoryArtifactFileAdapter();
  const fixedNow = new Date("2026-03-27T12:00:00Z");
  const dateProvider = { now: () => fixedNow };
  const useCase = new WriteResearchUseCase(artifactFile, sliceRepo, dateProvider);
  const tool = createWriteResearchTool(useCase);
  return { tool, sliceRepo, artifactFile };
}

describe("tff_write_research tool", () => {
  it("should have correct name", () => {
    const { tool } = setup();
    expect(tool.name).toBe("tff_write_research");
  });

  it("should write research and return ok result", async () => {
    const { tool, sliceRepo } = setup();
    const sliceId = crypto.randomUUID();
    const slice = new SliceBuilder().withId(sliceId).build();
    sliceRepo.seed(slice);

    const result = await tool.execute(
      { milestoneLabel: "M03", sliceLabel: "M03-S06", sliceId, content: "# Research" },
      new AbortController().signal,
      () => {},
    );

    const text = result.content[0].type === "text" ? result.content[0].text : "";
    const parsed = JSON.parse(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.path).toContain("RESEARCH.md");
  });

  it("should return error for invalid UUID", async () => {
    const { tool } = setup();

    const result = await tool.execute(
      { milestoneLabel: "M03", sliceLabel: "M03-S06", sliceId: "not-uuid", content: "# R" },
      new AbortController().signal,
      () => {},
    );

    const text = result.content[0].type === "text" ? result.content[0].text : "";
    expect(text).toContain("Validation error");
  });
});
```

- [ ] Step 2: Run `npx vitest run src/hexagons/workflow/infrastructure/pi/write-research.tool.spec.ts`, verify FAIL

- [ ] Step 3: Implement tool

```typescript
// src/hexagons/workflow/infrastructure/pi/write-research.tool.ts
import { MilestoneLabelSchema } from "@hexagons/milestone";
import { SliceLabelSchema } from "@hexagons/slice";
import { createZodTool, textResult } from "@infrastructure/pi";
import { IdSchema, isErr } from "@kernel";
import { z } from "zod";
import type { WriteResearchUseCase } from "../../use-cases/write-research.use-case";

const WriteResearchSchema = z.object({
  milestoneLabel: MilestoneLabelSchema.describe("Milestone label, e.g. M03"),
  sliceLabel: SliceLabelSchema.describe("Slice label, e.g. M03-S06"),
  sliceId: IdSchema.describe("Slice UUID"),
  content: z.string().describe("Markdown research content"),
});

export function createWriteResearchTool(useCase: WriteResearchUseCase) {
  return createZodTool({
    name: "tff_write_research",
    label: "TFF Write Research",
    description: "Write RESEARCH.md for a slice and update the slice aggregate.",
    schema: WriteResearchSchema,
    execute: async (params) => {
      const result = await useCase.execute(params);
      if (isErr(result)) return textResult(`Error: ${result.error.message}`);
      return textResult(JSON.stringify({ ok: true, path: result.data.path }));
    },
  });
}
```

- [ ] Step 4: Run `npx vitest run src/hexagons/workflow/infrastructure/pi/write-research.tool.spec.ts`, verify PASS — 3/3 tests
- [ ] Step 5: Commit `feat(S06/T05): add tff_write_research tool`

---

### T06: Research command handler
**Files:** Create `src/hexagons/workflow/infrastructure/pi/research.command.ts`
**Traces to:** AC1, AC2, AC3, AC4, AC14
**Depends on:** T04 (research protocol)

- [ ] Step 1: Write test

```typescript
// src/hexagons/workflow/infrastructure/pi/research.command.spec.ts
import { MilestoneBuilder } from "@hexagons/milestone/domain/milestone.builder";
import { InMemoryMilestoneRepository } from "@hexagons/milestone/infrastructure/in-memory-milestone.repository";
import { SliceBuilder } from "@hexagons/slice/domain/slice.builder";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { isOk, ok } from "@kernel";
import { describe, expect, it, vi } from "vitest";

import { WorkflowSessionBuilder } from "../../domain/workflow-session.builder";
import { InMemoryArtifactFileAdapter } from "../../infrastructure/in-memory-artifact-file.adapter";
import { InMemoryWorkflowSessionRepository } from "../../infrastructure/in-memory-workflow-session.repository";
import { registerResearchCommand, type ResearchCommandDeps } from "./research.command";

function setup() {
  const milestoneId = crypto.randomUUID();
  const sliceId = crypto.randomUUID();

  const sliceRepo = new InMemorySliceRepository();
  const milestoneRepo = new InMemoryMilestoneRepository();
  const sessionRepo = new InMemoryWorkflowSessionRepository();
  const artifactFile = new InMemoryArtifactFileAdapter();

  const milestone = new MilestoneBuilder().withId(milestoneId).withLabel("M03").build();
  milestoneRepo.seed(milestone);

  const slice = new SliceBuilder()
    .withId(sliceId)
    .withMilestoneId(milestoneId)
    .withLabel("M03-S06")
    .withTitle("Research command")
    .build();
  sliceRepo.seed(slice);

  const session = new WorkflowSessionBuilder()
    .withMilestoneId(milestoneId)
    .withSliceId(sliceId)
    .withCurrentPhase("researching")
    .withAutonomyMode("plan-to-pr")
    .build();
  sessionRepo.seed(session);

  const deps: ResearchCommandDeps = { sliceRepo, milestoneRepo, sessionRepo, artifactFile };

  const commands: Record<string, { handler: (args: string, ctx: unknown) => Promise<void> }> = {};
  const api = {
    registerCommand: (name: string, cmd: unknown) => {
      commands[name] = cmd as { handler: (args: string, ctx: unknown) => Promise<void> };
    },
    registerTool: vi.fn(),
  };

  const messages: string[] = [];
  const ctx = { sendUserMessage: (msg: string) => messages.push(msg) };

  return { api, commands, ctx, messages, deps, milestoneId, sliceId, sliceRepo, sessionRepo, artifactFile };
}

describe("registerResearchCommand", () => {
  it("should register tff:research command", () => {
    const { api, commands, deps } = setup();
    registerResearchCommand(api as never, deps);
    expect(commands["tff:research"]).toBeDefined();
  });

  it("should send protocol message when session is in researching phase", async () => {
    const { api, commands, ctx, messages, deps, artifactFile } = setup();
    // Write a spec so the command can read it
    await artifactFile.write("M03", "M03-S06", "spec", "# Spec Content");

    registerResearchCommand(api as never, deps);
    await commands["tff:research"].handler("M03-S06", ctx);

    expect(messages.length).toBe(1);
    expect(messages[0]).toContain("RESEARCH phase");
    expect(messages[0]).toContain("# Spec Content");
  });

  it("should return error if session not in researching phase", async () => {
    const { api, commands, ctx, messages, deps, sessionRepo, milestoneId } = setup();
    // Override session to discussing phase
    const session = new WorkflowSessionBuilder()
      .withMilestoneId(milestoneId)
      .withCurrentPhase("discussing")
      .build();
    sessionRepo.reset();
    sessionRepo.seed(session);

    registerResearchCommand(api as never, deps);
    await commands["tff:research"].handler("M03-S06", ctx);

    expect(messages[0]).toContain("not researching");
  });

  it("should return error if no session exists", async () => {
    const { api, commands, ctx, messages, deps, sessionRepo } = setup();
    sessionRepo.reset();

    registerResearchCommand(api as never, deps);
    await commands["tff:research"].handler("M03-S06", ctx);

    expect(messages[0]).toContain("No workflow session");
  });

  it("should return error if SPEC.md not found", async () => {
    const { api, commands, ctx, messages, deps } = setup();
    // Don't write spec — leave it missing

    registerResearchCommand(api as never, deps);
    await commands["tff:research"].handler("M03-S06", ctx);

    expect(messages[0]).toContain("No SPEC.md");
  });
});
```

- [ ] Step 2: Run `npx vitest run src/hexagons/workflow/infrastructure/pi/research.command.spec.ts`, verify FAIL

- [ ] Step 3: Implement command handler

```typescript
// src/hexagons/workflow/infrastructure/pi/research.command.ts
import type { MilestoneRepositoryPort } from "@hexagons/milestone";
import type { SliceRepositoryPort } from "@hexagons/slice";
import type { ExtensionAPI, ExtensionCommandContext } from "@infrastructure/pi";
import { isErr } from "@kernel";
import type { ArtifactFilePort } from "../../domain/ports/artifact-file.port";
import type { WorkflowSessionRepositoryPort } from "../../domain/ports/workflow-session.repository.port";
import { buildResearchProtocolMessage } from "./research-protocol";

export interface ResearchCommandDeps {
  sliceRepo: SliceRepositoryPort;
  milestoneRepo: MilestoneRepositoryPort;
  sessionRepo: WorkflowSessionRepositoryPort;
  artifactFile: ArtifactFilePort;
}

export function registerResearchCommand(api: ExtensionAPI, deps: ResearchCommandDeps): void {
  api.registerCommand("tff:research", {
    description: "Start the research phase for a slice -- agent-dispatched codebase investigation",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      // 1. Resolve target slice from args (label or ID)
      const identifier = args.trim();
      if (!identifier) {
        ctx.sendUserMessage("Usage: /tff:research <slice-label-or-id>");
        return;
      }

      // Try findByLabel first, fall back to findById
      let sliceResult = await deps.sliceRepo.findByLabel(identifier);
      if (isErr(sliceResult)) {
        ctx.sendUserMessage(`Error loading slice: ${sliceResult.error.message}`);
        return;
      }
      if (!sliceResult.data) {
        sliceResult = await deps.sliceRepo.findById(identifier);
        if (isErr(sliceResult)) {
          ctx.sendUserMessage(`Error loading slice: ${sliceResult.error.message}`);
          return;
        }
      }
      const slice = sliceResult.data;
      if (!slice) {
        ctx.sendUserMessage(`Slice not found: ${identifier}`);
        return;
      }

      // 2. Load milestone
      const msResult = await deps.milestoneRepo.findById(slice.milestoneId);
      if (isErr(msResult)) {
        ctx.sendUserMessage(`Error loading milestone: ${msResult.error.message}`);
        return;
      }
      if (!msResult.data) {
        ctx.sendUserMessage(`Milestone not found for slice ${slice.label}`);
        return;
      }
      const milestone = msResult.data;

      // 3. Load workflow session and validate phase
      const sessionResult = await deps.sessionRepo.findByMilestoneId(milestone.id);
      if (isErr(sessionResult)) {
        ctx.sendUserMessage(`Error loading session: ${sessionResult.error.message}`);
        return;
      }
      if (!sessionResult.data) {
        ctx.sendUserMessage("No workflow session found. Run /tff:discuss first.");
        return;
      }
      const session = sessionResult.data;

      // 4. Validate phase
      if (session.currentPhase !== "researching") {
        ctx.sendUserMessage(
          `Slice ${slice.label} is in ${session.currentPhase}, not researching. Run /tff:discuss first.`,
        );
        return;
      }

      // 5. Read SPEC.md
      const specResult = await deps.artifactFile.read(milestone.label, slice.label, "spec");
      if (isErr(specResult)) {
        ctx.sendUserMessage(`Failed to read SPEC.md: ${specResult.error.message}`);
        return;
      }
      if (!specResult.data) {
        ctx.sendUserMessage("No SPEC.md found. Run /tff:discuss first.");
        return;
      }

      // 6. Send protocol message
      ctx.sendUserMessage(
        buildResearchProtocolMessage({
          sliceId: slice.id,
          sliceLabel: slice.label,
          sliceTitle: slice.title,
          sliceDescription: slice.description,
          milestoneLabel: milestone.label,
          milestoneId: milestone.id,
          specContent: specResult.data,
          autonomyMode: session.autonomyMode,
        }),
      );
    },
  });
}
```

- [ ] Step 4: Run `npx vitest run src/hexagons/workflow/infrastructure/pi/research.command.spec.ts`, verify PASS — 5/5 tests
- [ ] Step 5: Commit `feat(S06/T06): add research command handler`

---

## Wave 3 (depends on all above)

### T07: Workflow extension wiring + barrel exports
**Files:** Modify `src/hexagons/workflow/infrastructure/pi/workflow.extension.ts`, Modify `src/hexagons/workflow/index.ts`
**Traces to:** AC12
**Depends on:** T03, T04, T05, T06

- [ ] Step 1: Modify `src/hexagons/workflow/infrastructure/pi/workflow.extension.ts`

Add imports:
```typescript
import { WriteResearchUseCase } from "../../use-cases/write-research.use-case";
import { registerResearchCommand } from "./research.command";
import { createWriteResearchTool } from "./write-research.tool";
```

Add after the discuss tool registrations (after line 149):
```typescript
// --- Research use case + tool ---
const writeResearch = new WriteResearchUseCase(deps.artifactFile, deps.sliceRepo, deps.dateProvider);
api.registerTool(createWriteResearchTool(writeResearch));

// --- Research command ---
registerResearchCommand(api, {
  sliceRepo: deps.sliceRepo,
  milestoneRepo: deps.milestoneRepo,
  sessionRepo: deps.workflowSessionRepo,
  artifactFile: deps.artifactFile,
});
```

- [ ] Step 2: Update barrel exports in `src/hexagons/workflow/index.ts`

Add:
```typescript
// Use Cases
export { WriteResearchUseCase } from "./use-cases/write-research.use-case";

// Infrastructure — PI Tools & Commands
export { createWriteResearchTool } from "./infrastructure/pi/write-research.tool";
export {
  type ResearchCommandDeps,
  registerResearchCommand,
} from "./infrastructure/pi/research.command";
export {
  buildResearchProtocolMessage,
  type ResearchProtocolParams,
} from "./infrastructure/pi/research-protocol";
```

- [ ] Step 3: Run full test suite `npx vitest run src/hexagons/workflow/ src/hexagons/slice/`, verify all tests PASS
- [ ] Step 4: Commit `feat(S06/T07): wire research command and tool into workflow extension`
