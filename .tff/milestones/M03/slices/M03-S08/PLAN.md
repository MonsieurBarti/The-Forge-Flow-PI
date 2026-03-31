# M03-S08: Next-Step Suggestions — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Declarative `NextStepSuggestion` VO + `SuggestNextStepUseCase` replacing ad-hoc `buildAutonomyInstruction()` in protocol builders. Central state-to-suggestion map covering all 11 workflow phases.
**Architecture:** Domain VO in workflow hexagon, use case wrapping session+slice ports, protocol builder retrofit, extension wiring.
**Tech Stack:** TypeScript, Zod, Vitest, hexagonal architecture.

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/hexagons/workflow/domain/next-step-suggestion.vo.ts` | VO: schemas, suggestion map, `build()` factory |
| Create | `src/hexagons/workflow/domain/next-step-suggestion.vo.spec.ts` | VO tests: all phase/mode combos, S-tier guard, edge cases |
| Create | `src/hexagons/workflow/use-cases/suggest-next-step.use-case.ts` | Use case: load session+slice, compute context, call VO |
| Create | `src/hexagons/workflow/use-cases/suggest-next-step.use-case.spec.ts` | Use case tests: happy path, errors, allSlicesClosed |
| Modify | `src/hexagons/workflow/infrastructure/pi/templates/protocols/discuss.md` | `{{autonomyInstruction}}` -> `{{nextStep}}` |
| Modify | `src/hexagons/workflow/infrastructure/pi/templates/protocols/research.md` | `{{autonomyInstruction}}` -> `{{nextStep}}` |
| Modify | `src/hexagons/workflow/infrastructure/pi/templates/protocols/plan.md` | `{{autonomyInstruction}}` -> `{{nextStep}}` |
| Modify | `src/hexagons/workflow/infrastructure/pi/discuss-protocol.ts` | Remove autonomyInstruction, add `nextStep` param |
| Modify | `src/hexagons/workflow/infrastructure/pi/research-protocol.ts` | Remove autonomyInstruction, add `nextStep` param |
| Modify | `src/hexagons/workflow/infrastructure/pi/research-protocol.spec.ts` | Update tests for `nextStep` param |
| Modify | `src/hexagons/workflow/infrastructure/pi/plan-protocol.ts` | Remove autonomyInstruction, add `nextStep` param |
| Modify | `src/hexagons/workflow/infrastructure/pi/plan.command.spec.ts` | Add `suggestNextStep` to deps |
| Modify | `src/hexagons/workflow/infrastructure/pi/discuss.command.ts` | Add `suggestNextStep` dep, call use case, pass to protocol |
| Modify | `src/hexagons/workflow/infrastructure/pi/research.command.ts` | Add `suggestNextStep` dep, call use case, pass to protocol |
| Modify | `src/hexagons/workflow/infrastructure/pi/research.command.spec.ts` | Add `suggestNextStep` to deps |
| Modify | `src/hexagons/workflow/infrastructure/pi/plan.command.ts` | Add `suggestNextStep` dep, call use case, pass to protocol |
| Modify | `src/hexagons/workflow/infrastructure/pi/workflow.extension.ts` | Create use case, pass to commands, add to status handler |
| Modify | `src/hexagons/workflow/infrastructure/pi/workflow.extension.spec.ts` | No structural change (same tool/command registration count) |
| Modify | `src/hexagons/workflow/index.ts` | Export VO, types, use case |

---

## Wave 0 (parallel tracks: T01->T02 || T05)

### T01: Write failing test for NextStepSuggestion VO
**Files:** Create `src/hexagons/workflow/domain/next-step-suggestion.vo.spec.ts`
**Traces to:** AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC9, AC13

```typescript
import { describe, expect, it } from "vitest";
import {
  NextStepSuggestion,
  type NextStepContext,
} from "./next-step-suggestion.vo";

describe("NextStepSuggestion", () => {
  const label = "M03-S08";

  describe("build() — guided mode", () => {
    const base: NextStepContext = {
      phase: "idle",
      autonomyMode: "guided",
      sliceLabel: label,
      allSlicesClosed: false,
    };

    it("idle (slices open) suggests /tff:discuss", () => {
      const s = NextStepSuggestion.build(base);
      expect(s).not.toBeNull();
      expect(s!.command).toBe("/tff:discuss");
      expect(s!.displayText).toBe("Next: /tff:discuss");
      expect(s!.autoInvoke).toBe(false);
      expect(s!.args).toBeUndefined();
    });

    it("idle (all closed) suggests /tff:complete-milestone", () => {
      const s = NextStepSuggestion.build({ ...base, allSlicesClosed: true });
      expect(s).not.toBeNull();
      expect(s!.command).toBe("/tff:complete-milestone");
      expect(s!.displayText).toBe("Next: /tff:complete-milestone");
      expect(s!.autoInvoke).toBe(false);
    });

    it("discussing suggests /tff:research <label>", () => {
      const s = NextStepSuggestion.build({ ...base, phase: "discussing" });
      expect(s!.command).toBe("/tff:research");
      expect(s!.args).toBe(label);
      expect(s!.displayText).toBe(`Next: /tff:research ${label}`);
      expect(s!.autoInvoke).toBe(false);
    });

    it("discussing + S-tier suggests /tff:plan <label>", () => {
      const s = NextStepSuggestion.build({
        ...base,
        phase: "discussing",
        tier: "S",
      });
      expect(s!.command).toBe("/tff:plan");
      expect(s!.args).toBe(label);
      expect(s!.displayText).toBe(`Next: /tff:plan ${label}`);
    });

    it("discussing + tier undefined defaults to /tff:research", () => {
      const s = NextStepSuggestion.build({ ...base, phase: "discussing" });
      expect(s!.command).toBe("/tff:research");
    });

    it("researching suggests /tff:plan <label>", () => {
      const s = NextStepSuggestion.build({ ...base, phase: "researching" });
      expect(s!.command).toBe("/tff:plan");
      expect(s!.displayText).toBe(`Next: /tff:plan ${label}`);
      expect(s!.autoInvoke).toBe(false);
    });

    it("planning shows awaiting approval", () => {
      const s = NextStepSuggestion.build({ ...base, phase: "planning" });
      expect(s!.displayText).toBe("Awaiting plan approval");
      expect(s!.autoInvoke).toBe(false);
    });

    it("executing suggests /tff:verify <label>", () => {
      const s = NextStepSuggestion.build({ ...base, phase: "executing" });
      expect(s!.command).toBe("/tff:verify");
      expect(s!.displayText).toBe(`Next: /tff:verify ${label}`);
      expect(s!.autoInvoke).toBe(false);
    });

    it("verifying suggests /tff:review <label>", () => {
      const s = NextStepSuggestion.build({ ...base, phase: "verifying" });
      expect(s!.displayText).toBe(`Next: /tff:review ${label}`);
      expect(s!.autoInvoke).toBe(false);
    });

    it("reviewing shows awaiting approval", () => {
      const s = NextStepSuggestion.build({ ...base, phase: "reviewing" });
      expect(s!.displayText).toBe("Awaiting review approval");
      expect(s!.autoInvoke).toBe(false);
    });

    it("shipping shows awaiting approval", () => {
      const s = NextStepSuggestion.build({ ...base, phase: "shipping" });
      expect(s!.displayText).toBe("Awaiting ship approval");
      expect(s!.autoInvoke).toBe(false);
    });

    it("completing-milestone returns null", () => {
      const s = NextStepSuggestion.build({
        ...base,
        phase: "completing-milestone",
      });
      expect(s).toBeNull();
    });

    it("paused includes previousPhase", () => {
      const s = NextStepSuggestion.build({
        ...base,
        phase: "paused",
        previousPhase: "executing",
      });
      expect(s!.command).toBe("/tff:resume");
      expect(s!.displayText).toBe(
        `Resume: /tff:resume ${label} (was: executing)`,
      );
      expect(s!.autoInvoke).toBe(false);
    });

    it("blocked shows escalation message", () => {
      const s = NextStepSuggestion.build({ ...base, phase: "blocked" });
      expect(s!.displayText).toBe("Blocked -- resolve escalation");
      expect(s!.autoInvoke).toBe(false);
    });

    it("autoInvoke is false for ALL guided phases", () => {
      const phases = [
        "idle", "discussing", "researching", "planning",
        "executing", "verifying", "reviewing", "shipping",
        "paused", "blocked",
      ] as const;
      for (const phase of phases) {
        const s = NextStepSuggestion.build({
          ...base,
          phase,
          previousPhase: phase === "paused" ? "executing" : undefined,
        });
        expect(s?.autoInvoke).toBe(false);
      }
    });
  });

  describe("build() — plan-to-pr mode", () => {
    const base: NextStepContext = {
      phase: "idle",
      autonomyMode: "plan-to-pr",
      sliceLabel: label,
      allSlicesClosed: false,
    };

    it("autoInvoke=true for active non-gate phases", () => {
      const autoInvokePhases = [
        "discussing",
        "researching",
        "executing",
        "verifying",
      ] as const;
      for (const phase of autoInvokePhases) {
        const s = NextStepSuggestion.build({ ...base, phase });
        expect(s!.autoInvoke).toBe(true);
      }
    });

    it("autoInvoke=false for gate phases", () => {
      const gatePhases = ["planning", "reviewing", "shipping"] as const;
      for (const phase of gatePhases) {
        const s = NextStepSuggestion.build({ ...base, phase });
        expect(s!.autoInvoke).toBe(false);
      }
    });

    it("autoInvoke=false for idle, paused, blocked", () => {
      expect(
        NextStepSuggestion.build({ ...base, phase: "idle" })!.autoInvoke,
      ).toBe(false);
      expect(
        NextStepSuggestion.build({
          ...base,
          phase: "paused",
          previousPhase: "executing",
        })!.autoInvoke,
      ).toBe(false);
      expect(
        NextStepSuggestion.build({ ...base, phase: "blocked" })!.autoInvoke,
      ).toBe(false);
    });

    it("S-tier discussing still autoInvokes but targets /tff:plan", () => {
      const s = NextStepSuggestion.build({
        ...base,
        phase: "discussing",
        tier: "S",
      });
      expect(s!.command).toBe("/tff:plan");
      expect(s!.autoInvoke).toBe(true);
    });

    it("paused returns same suggestion regardless of mode", () => {
      const guided = NextStepSuggestion.build({
        phase: "paused",
        autonomyMode: "guided",
        sliceLabel: label,
        previousPhase: "executing",
        allSlicesClosed: false,
      });
      const p2pr = NextStepSuggestion.build({
        ...base,
        phase: "paused",
        previousPhase: "executing",
      });
      expect(guided!.displayText).toBe(p2pr!.displayText);
      expect(guided!.autoInvoke).toBe(p2pr!.autoInvoke);
    });

    it("blocked returns same suggestion regardless of mode", () => {
      const guided = NextStepSuggestion.build({
        phase: "blocked",
        autonomyMode: "guided",
        sliceLabel: label,
        allSlicesClosed: false,
      });
      const p2pr = NextStepSuggestion.build({ ...base, phase: "blocked" });
      expect(guided!.displayText).toBe(p2pr!.displayText);
    });
  });

  describe("displayText interpolation", () => {
    it("interpolates actual sliceLabel, not placeholder", () => {
      const s = NextStepSuggestion.build({
        phase: "researching",
        autonomyMode: "guided",
        sliceLabel: "M05-S12",
        allSlicesClosed: false,
      });
      expect(s!.displayText).toContain("M05-S12");
      expect(s!.displayText).not.toContain("<label>");
    });
  });
});
```

- **Run**: `npx vitest run src/hexagons/workflow/domain/next-step-suggestion.vo.spec.ts`
- **Expect**: FAIL — `Cannot find module './next-step-suggestion.vo'`
- **AC**: AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC9, AC13

---

### T02: Implement NextStepSuggestion VO
**Files:** Create `src/hexagons/workflow/domain/next-step-suggestion.vo.ts`
**Traces to:** AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC9
**Blocked by:** T01

```typescript
import { ComplexityTierSchema, ValueObject } from "@kernel";
import { z } from "zod";
import { WorkflowPhaseSchema, type WorkflowPhase } from "./workflow-session.schemas";

export const NextStepContextSchema = z.object({
  phase: WorkflowPhaseSchema,
  autonomyMode: z.enum(["guided", "plan-to-pr"]),
  tier: ComplexityTierSchema.optional(),
  sliceLabel: z.string().optional(),
  previousPhase: WorkflowPhaseSchema.optional(),
  allSlicesClosed: z.boolean().default(false),
});
export type NextStepContext = z.infer<typeof NextStepContextSchema>;

export const NextStepSuggestionPropsSchema = z.object({
  command: z.string(),
  args: z.string().optional(),
  displayText: z.string(),
  autoInvoke: z.boolean(),
});
export type NextStepSuggestionProps = z.infer<typeof NextStepSuggestionPropsSchema>;

type SuggestionFactory = (ctx: NextStepContext) => NextStepSuggestionProps | null;

function cmd(command: string, label: string | undefined, auto: boolean): NextStepSuggestionProps {
  return {
    command,
    args: label,
    displayText: `Next: ${command}${label ? ` ${label}` : ""}`,
    autoInvoke: auto,
  };
}

function gate(text: string): NextStepSuggestionProps {
  return { command: "", displayText: text, autoInvoke: false };
}

const PHASE_SUGGESTIONS: Record<string, SuggestionFactory> = {
  idle: (ctx) =>
    ctx.allSlicesClosed
      ? cmd("/tff:complete-milestone", undefined, false)
      : cmd("/tff:discuss", undefined, false),

  discussing: (ctx) => {
    const target = ctx.tier === "S" ? "/tff:plan" : "/tff:research";
    const auto = ctx.autonomyMode === "plan-to-pr";
    return cmd(target, ctx.sliceLabel, auto);
  },

  researching: (ctx) => cmd("/tff:plan", ctx.sliceLabel, ctx.autonomyMode === "plan-to-pr"),

  planning: () => gate("Awaiting plan approval"),

  executing: (ctx) => cmd("/tff:verify", ctx.sliceLabel, ctx.autonomyMode === "plan-to-pr"),

  verifying: (ctx) => cmd("/tff:review", ctx.sliceLabel, ctx.autonomyMode === "plan-to-pr"),

  reviewing: () => gate("Awaiting review approval"),

  shipping: () => gate("Awaiting ship approval"),

  "completing-milestone": () => null,

  paused: (ctx) => ({
    command: "/tff:resume",
    args: ctx.sliceLabel,
    displayText: `Resume: /tff:resume ${ctx.sliceLabel ?? ""} (was: ${ctx.previousPhase ?? "unknown"})`,
    autoInvoke: false,
  }),

  blocked: () => ({
    command: "",
    displayText: "Blocked -- resolve escalation",
    autoInvoke: false,
  }),
};

export class NextStepSuggestion extends ValueObject<NextStepSuggestionProps> {
  private constructor(props: NextStepSuggestionProps) {
    super(props, NextStepSuggestionPropsSchema);
  }

  static build(ctx: NextStepContext): NextStepSuggestion | null {
    const parsed = NextStepContextSchema.parse(ctx);
    const factory = PHASE_SUGGESTIONS[parsed.phase];
    if (!factory) return null;
    const result = factory(parsed);
    if (!result) return null;
    return new NextStepSuggestion(result);
  }

  get command(): string {
    return this.props.command;
  }

  get args(): string | undefined {
    return this.props.args;
  }

  get displayText(): string {
    return this.props.displayText;
  }

  get autoInvoke(): boolean {
    return this.props.autoInvoke;
  }

  get toProps(): NextStepSuggestionProps {
    return { ...this.props };
  }
}
```

- **Run**: `npx vitest run src/hexagons/workflow/domain/next-step-suggestion.vo.spec.ts`
- **Expect**: PASS — all phase/mode/tier combinations green
- **Commit**: `feat(S08/T02): add NextStepSuggestion value object`

---

### T05: Refactor protocol templates + builders — replace autonomyInstruction with nextStep
**Files:**
- Modify `src/hexagons/workflow/infrastructure/pi/templates/protocols/discuss.md`
- Modify `src/hexagons/workflow/infrastructure/pi/templates/protocols/research.md`
- Modify `src/hexagons/workflow/infrastructure/pi/templates/protocols/plan.md`
- Modify `src/hexagons/workflow/infrastructure/pi/discuss-protocol.ts`
- Modify `src/hexagons/workflow/infrastructure/pi/research-protocol.ts`
- Modify `src/hexagons/workflow/infrastructure/pi/plan-protocol.ts`
- Modify `src/hexagons/workflow/infrastructure/pi/research-protocol.spec.ts`
**Traces to:** AC10, AC11

**Templates** — in each template, replace `{{autonomyInstruction}}` with `{{nextStep}}`:

`discuss.md` line 36:
```diff
-6. {{autonomyInstruction}}
+6. {{nextStep}}
```

`research.md` line 40:
```diff
-11. {{autonomyInstruction}}
+11. {{nextStep}}
```

`plan.md` line 44:
```diff
-15. {{autonomyInstruction}}
+15. {{nextStep}}
```

**Protocol builders** — add `nextStep: string` to params, remove `autonomyMode` usage for autonomyInstruction computation:

`discuss-protocol.ts`:
```typescript
import { readFileSync } from "node:fs";

export interface DiscussProtocolParams {
  sliceId: string;
  sliceLabel: string;
  sliceTitle: string;
  sliceDescription: string;
  milestoneLabel: string;
  milestoneId: string;
  autonomyMode: string;
  nextStep: string;
}

const template = readFileSync(
  new URL("./templates/protocols/discuss.md", import.meta.url),
  "utf-8",
);

function render(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

export function buildDiscussProtocolMessage(params: DiscussProtocolParams): string {
  return render(template, { ...params, nextStep: params.nextStep });
}
```

`research-protocol.ts`:
```typescript
import { readFileSync } from "node:fs";

export interface ResearchProtocolParams {
  sliceId: string;
  sliceLabel: string;
  sliceTitle: string;
  sliceDescription: string;
  milestoneLabel: string;
  milestoneId: string;
  specContent: string;
  autonomyMode: string;
  nextStep: string;
}

const template = readFileSync(
  new URL("./templates/protocols/research.md", import.meta.url),
  "utf-8",
);

function render(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

export function buildResearchProtocolMessage(params: ResearchProtocolParams): string {
  return render(template, { ...params, nextStep: params.nextStep });
}
```

`plan-protocol.ts`:
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
  nextStep: string;
}

const template = readFileSync(new URL("./templates/protocols/plan.md", import.meta.url), "utf-8");

function render(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

export function buildPlanProtocolMessage(params: PlanProtocolParams): string {
  const researchSection = params.researchContent
    ? `## RESEARCH.md\n\n${params.researchContent}`
    : "";

  return render(template, {
    ...params,
    researchContent: params.researchContent ?? "",
    researchSection,
    nextStep: params.nextStep,
  });
}
```

**Protocol spec update** — `research-protocol.spec.ts`:

Replace the autonomyInstruction tests (lines 55-64):
```typescript
  it("includes nextStep text in output", () => {
    const msg = buildResearchProtocolMessage({
      ...params,
      nextStep: "Next: /tff:plan M03-S06",
    });
    expect(msg).toContain("Next: /tff:plan M03-S06");
  });
```

Add `nextStep` to the base params:
```typescript
  const params = {
    sliceId: "uuid-123",
    sliceLabel: "M03-S06",
    sliceTitle: "Research command",
    sliceDescription: "Agent-dispatched research",
    milestoneLabel: "M03",
    milestoneId: "ms-uuid",
    specContent: "# Spec Content\n\nSome spec...",
    autonomyMode: "plan-to-pr",
    nextStep: "Auto-invoke /tff:plan M03-S06",
  };
```

- **Run**: `npx vitest run src/hexagons/workflow/infrastructure/pi/research-protocol.spec.ts`
- **Expect**: PASS
- **Commit**: `refactor(S08/T05): replace autonomyInstruction with nextStep in protocol builders`

---

## Wave 1 (depends on T02)

### T03: Write failing test for SuggestNextStepUseCase
**Files:** Create `src/hexagons/workflow/use-cases/suggest-next-step.use-case.spec.ts`
**Traces to:** AC12, AC13
**Blocked by:** T02

```typescript
import { Slice } from "@hexagons/slice";
import { SliceBuilder } from "@hexagons/slice/domain/slice.builder";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { isErr, isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { WorkflowSessionBuilder } from "../domain/workflow-session.builder";
import { InMemoryWorkflowSessionRepository } from "../infrastructure/in-memory-workflow-session.repository";
import { SuggestNextStepUseCase } from "./suggest-next-step.use-case";

// NOTE: SliceBuilder.build() calls Slice.createNew() which hardcodes status="discussing".
// Use Slice.reconstitute(builder.buildProps()) when custom status/complexity is needed.

describe("SuggestNextStepUseCase", () => {
  function setup() {
    const sessionRepo = new InMemoryWorkflowSessionRepository();
    const sliceRepo = new InMemorySliceRepository();
    const useCase = new SuggestNextStepUseCase(sessionRepo, sliceRepo);
    return { sessionRepo, sliceRepo, useCase };
  }

  it("returns suggestion for active session with slice", async () => {
    const { sessionRepo, sliceRepo, useCase } = setup();
    const slice = Slice.reconstitute(
      new SliceBuilder()
        .withLabel("M03-S08")
        .withMilestoneId("ms-1")
        .withStatus("researching")
        .buildProps(),
    );
    const session = new WorkflowSessionBuilder()
      .withMilestoneId("ms-1")
      .withSliceId(slice.id)
      .withCurrentPhase("researching")
      .withAutonomyMode("guided")
      .build();
    sliceRepo.seed(slice);
    sessionRepo.seed(session);

    const result = await useCase.execute({ milestoneId: "ms-1" });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.data).not.toBeNull();
    expect(result.data!.command).toBe("/tff:plan");
    expect(result.data!.displayText).toContain("M03-S08");
  });

  it("returns idle suggestion when session has no slice", async () => {
    const { sessionRepo, sliceRepo, useCase } = setup();
    const slice = new SliceBuilder()
      .withMilestoneId("ms-1")
      .build(); // build() defaults to "discussing" — fine for allSlicesClosed=false
    const session = new WorkflowSessionBuilder()
      .withMilestoneId("ms-1")
      .withCurrentPhase("idle")
      .withAutonomyMode("guided")
      .build();
    sliceRepo.seed(slice);
    sessionRepo.seed(session);

    const result = await useCase.execute({ milestoneId: "ms-1" });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.data!.command).toBe("/tff:discuss");
  });

  it("returns complete-milestone when allSlicesClosed", async () => {
    const { sessionRepo, sliceRepo, useCase } = setup();
    const slice = Slice.reconstitute(
      new SliceBuilder()
        .withMilestoneId("ms-1")
        .withStatus("closed")
        .buildProps(),
    );
    const session = new WorkflowSessionBuilder()
      .withMilestoneId("ms-1")
      .withCurrentPhase("idle")
      .withAutonomyMode("guided")
      .build();
    sliceRepo.seed(slice);
    sessionRepo.seed(session);

    const result = await useCase.execute({ milestoneId: "ms-1" });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.data!.command).toBe("/tff:complete-milestone");
  });

  it("returns error when session not found", async () => {
    const { useCase } = setup();
    const result = await useCase.execute({ milestoneId: "nonexistent" });
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.code).toBe("WORKFLOW.SESSION_NOT_FOUND");
  });

  it("returns error when sliceId present but slice not found", async () => {
    const { sessionRepo, useCase } = setup();
    const session = new WorkflowSessionBuilder()
      .withMilestoneId("ms-1")
      .withSliceId("missing-slice-id")
      .withCurrentPhase("researching")
      .withAutonomyMode("guided")
      .build();
    sessionRepo.seed(session);

    const result = await useCase.execute({ milestoneId: "ms-1" });
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.code).toBe("SLICE.NOT_FOUND");
  });

  it("converts null complexity to undefined tier", async () => {
    const { sessionRepo, sliceRepo, useCase } = setup();
    const slice = new SliceBuilder()
      .withLabel("M03-S08")
      .withMilestoneId("ms-1")
      .build(); // build() → complexity=null, status="discussing"
    const session = new WorkflowSessionBuilder()
      .withMilestoneId("ms-1")
      .withSliceId(slice.id)
      .withCurrentPhase("discussing")
      .withAutonomyMode("guided")
      .build();
    sliceRepo.seed(slice);
    sessionRepo.seed(session);

    const result = await useCase.execute({ milestoneId: "ms-1" });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    // tier=undefined => S-tier guard does NOT fire => defaults to /tff:research
    expect(result.data!.command).toBe("/tff:research");
  });

  it("returns null for completing-milestone phase", async () => {
    const { sessionRepo, sliceRepo, useCase } = setup();
    const slice = Slice.reconstitute(
      new SliceBuilder()
        .withMilestoneId("ms-1")
        .withStatus("closed")
        .buildProps(),
    );
    const session = new WorkflowSessionBuilder()
      .withMilestoneId("ms-1")
      .withCurrentPhase("completing-milestone")
      .withAutonomyMode("guided")
      .build();
    sliceRepo.seed(slice);
    sessionRepo.seed(session);

    const result = await useCase.execute({ milestoneId: "ms-1" });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.data).toBeNull();
  });
});
```

- **Run**: `npx vitest run src/hexagons/workflow/use-cases/suggest-next-step.use-case.spec.ts`
- **Expect**: FAIL — `Cannot find module './suggest-next-step.use-case'`
- **AC**: AC12, AC13

---

### T04: Implement SuggestNextStepUseCase
**Files:** Create `src/hexagons/workflow/use-cases/suggest-next-step.use-case.ts`
**Traces to:** AC12, AC13
**Blocked by:** T03

```typescript
import type { SliceRepositoryPort } from "@hexagons/slice";
import { SliceNotFoundError } from "@hexagons/slice";
import { err, isErr, ok, type PersistenceError, type Result } from "@kernel";
import type { WorkflowBaseError } from "../domain/errors/workflow-base.error";
import {
  NextStepSuggestion,
  type NextStepSuggestionProps,
} from "../domain/next-step-suggestion.vo";
import type { WorkflowSessionRepositoryPort } from "../domain/ports/workflow-session.repository.port";
import { WorkflowSessionNotFoundError } from "./orchestrate-phase-transition.use-case";

export interface SuggestNextStepInput {
  milestoneId: string;
}

export type SuggestNextStepError =
  | WorkflowSessionNotFoundError
  | SliceNotFoundError
  | WorkflowBaseError
  | PersistenceError;

export class SuggestNextStepUseCase {
  constructor(
    private readonly sessionRepo: WorkflowSessionRepositoryPort,
    private readonly sliceRepo: SliceRepositoryPort,
  ) {}

  async execute(
    input: SuggestNextStepInput,
  ): Promise<Result<NextStepSuggestionProps | null, SuggestNextStepError>> {
    // 1. Load session
    const sessionResult = await this.sessionRepo.findByMilestoneId(input.milestoneId);
    if (isErr(sessionResult)) return sessionResult;
    if (!sessionResult.data) {
      return err(new WorkflowSessionNotFoundError(input.milestoneId));
    }
    const session = sessionResult.data;

    // 2. Load slice if assigned
    let sliceLabel: string | undefined;
    let tier: "S" | "F-lite" | "F-full" | undefined;
    if (session.sliceId) {
      const sliceResult = await this.sliceRepo.findById(session.sliceId);
      if (isErr(sliceResult)) return sliceResult;
      if (!sliceResult.data) {
        return err(new SliceNotFoundError(session.sliceId));
      }
      sliceLabel = sliceResult.data.label;
      tier = sliceResult.data.complexity ?? undefined;
    }

    // 3. Compute allSlicesClosed
    const allSlicesResult = await this.sliceRepo.findByMilestoneId(input.milestoneId);
    if (isErr(allSlicesResult)) return allSlicesResult;
    const allSlicesClosed =
      allSlicesResult.data.length > 0 &&
      allSlicesResult.data.every((s) => s.status === "closed");

    // 4. Build suggestion
    const suggestion = NextStepSuggestion.build({
      phase: session.currentPhase,
      autonomyMode: session.autonomyMode,
      tier,
      sliceLabel,
      previousPhase: session.previousPhase,
      allSlicesClosed,
    });

    return ok(suggestion?.toProps ?? null);
  }
}
```

- **Run**: `npx vitest run src/hexagons/workflow/use-cases/suggest-next-step.use-case.spec.ts`
- **Expect**: PASS — all 7 tests green
- **Commit**: `feat(S08/T04): add SuggestNextStepUseCase`

---

## Wave 2 (depends on T04 + T05)

### T06: Wire commands + status + extension + barrel exports
**Files:**
- Modify `src/hexagons/workflow/infrastructure/pi/discuss.command.ts`
- Modify `src/hexagons/workflow/infrastructure/pi/research.command.ts`
- Modify `src/hexagons/workflow/infrastructure/pi/research.command.spec.ts`
- Modify `src/hexagons/workflow/infrastructure/pi/plan.command.ts`
- Modify `src/hexagons/workflow/infrastructure/pi/plan.command.spec.ts`
- Modify `src/hexagons/workflow/infrastructure/pi/workflow.extension.ts`
- Modify `src/hexagons/workflow/index.ts`
**Traces to:** AC10, AC11, AC12
**Blocked by:** T04, T05

**discuss.command.ts** — add `suggestNextStep` dep, call after StartDiscussUseCase:

Add to imports:
```typescript
import { isOk } from "@kernel";
import type { SuggestNextStepUseCase } from "../../use-cases/suggest-next-step.use-case";
```

Update `DiscussCommandDeps`:
```typescript
export interface DiscussCommandDeps {
  startDiscuss: StartDiscussUseCase;
  sliceRepo: SliceRepositoryPort;
  milestoneRepo: MilestoneRepositoryPort;
  suggestNextStep: SuggestNextStepUseCase;
}
```

After `const result = await deps.startDiscuss.execute(...)` succeeds, before sending protocol message:
```typescript
      // 4. Get next-step suggestion
      const nextStepResult = await deps.suggestNextStep.execute({
        milestoneId: milestone.id,
      });
      const nextStep =
        isOk(nextStepResult) && nextStepResult.data
          ? nextStepResult.data.displayText
          : "";

      // 5. Send protocol message
      ctx.sendUserMessage(
        buildDiscussProtocolMessage({
          sliceId: slice.id,
          sliceLabel: slice.label,
          sliceTitle: slice.title,
          sliceDescription: slice.description,
          milestoneLabel: milestone.label,
          milestoneId: milestone.id,
          autonomyMode: result.data.autonomyMode,
          nextStep,
        }),
      );
```

**research.command.ts** — same pattern:

Add imports:
```typescript
import { isOk } from "@kernel";
import type { SuggestNextStepUseCase } from "../../use-cases/suggest-next-step.use-case";
```

Update `ResearchCommandDeps`:
```typescript
export interface ResearchCommandDeps {
  sliceRepo: SliceRepositoryPort;
  milestoneRepo: MilestoneRepositoryPort;
  sessionRepo: WorkflowSessionRepositoryPort;
  artifactFile: ArtifactFilePort;
  suggestNextStep: SuggestNextStepUseCase;
}
```

Before sending protocol message (after step 5 — Read SPEC.md):
```typescript
      // 6. Get next-step suggestion
      const nextStepResult = await deps.suggestNextStep.execute({
        milestoneId: milestone.id,
      });
      const nextStep =
        isOk(nextStepResult) && nextStepResult.data
          ? nextStepResult.data.displayText
          : "";

      // 7. Send research protocol message
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
          nextStep,
        }),
      );
```

**plan.command.ts** — same pattern:

Add imports:
```typescript
import { isOk } from "@kernel";
import type { SuggestNextStepUseCase } from "../../use-cases/suggest-next-step.use-case";
```

Update `PlanCommandDeps`:
```typescript
export interface PlanCommandDeps {
  sliceRepo: SliceRepositoryPort;
  milestoneRepo: MilestoneRepositoryPort;
  sessionRepo: WorkflowSessionRepositoryPort;
  artifactFile: ArtifactFilePort;
  suggestNextStep: SuggestNextStepUseCase;
}
```

Before sending protocol message:
```typescript
      // 7. Get next-step suggestion
      const nextStepResult = await deps.suggestNextStep.execute({
        milestoneId: milestone.id,
      });
      const nextStep =
        isOk(nextStepResult) && nextStepResult.data
          ? nextStepResult.data.displayText
          : "";

      // 8. Send plan protocol message
      ctx.sendUserMessage(
        buildPlanProtocolMessage({
          sliceId: slice.id,
          sliceLabel: slice.label,
          sliceTitle: slice.title,
          sliceDescription: slice.description,
          milestoneLabel: milestone.label,
          milestoneId: milestone.id,
          specContent: specResult.data,
          researchContent,
          autonomyMode: session.autonomyMode,
          nextStep,
        }),
      );
```

**research.command.spec.ts** — add `suggestNextStep` to `makeDeps()`:

```typescript
import { SuggestNextStepUseCase } from "../../use-cases/suggest-next-step.use-case";

// In makeDeps():
    function makeDeps() {
      const sessionRepo = new InMemoryWorkflowSessionRepository();
      const sliceRepo = new InMemorySliceRepository();
      return {
        sliceRepo,
        milestoneRepo: new InMemoryMilestoneRepository(),
        sessionRepo,
        artifactFile: new InMemoryArtifactFileAdapter(),
        suggestNextStep: new SuggestNextStepUseCase(sessionRepo, sliceRepo),
      };
    }
```

Also update the registration test's deps:
```typescript
    const deps: ResearchCommandDeps = {
      sliceRepo: new InMemorySliceRepository(),
      milestoneRepo: new InMemoryMilestoneRepository(),
      sessionRepo: new InMemoryWorkflowSessionRepository(),
      artifactFile: new InMemoryArtifactFileAdapter(),
      suggestNextStep: new SuggestNextStepUseCase(
        new InMemoryWorkflowSessionRepository(),
        new InMemorySliceRepository(),
      ),
    };
```

**plan.command.spec.ts** — same pattern as research.command.spec.ts: add `suggestNextStep` to both `makeDeps()` and the registration test deps.

**workflow.extension.ts** — create use case, pass to commands, add to status handler:

Add import:
```typescript
import { SuggestNextStepUseCase } from "../../use-cases/suggest-next-step.use-case";
import type { NextStepSuggestionProps } from "../../domain/next-step-suggestion.vo";
```

After `const statusUseCase = new GetStatusUseCase(...)`:
```typescript
  const suggestNextStep = new SuggestNextStepUseCase(
    deps.workflowSessionRepo,
    deps.sliceRepo,
  );
```

Update status tool handler to include nextStep:
```typescript
      execute: async () => {
        const result = await statusUseCase.execute();
        if (!result.ok) {
          return {
            content: [{ type: "text", text: `Status failed: ${result.error.message}` }],
          };
        }

        let nextStep: NextStepSuggestionProps | null = null;
        if (result.data.activeMilestone) {
          const msLabel = result.data.activeMilestone.label;
          // Find milestoneId from label for the use case
          const msResult = await deps.milestoneRepo.findByLabel(msLabel);
          if (msResult.ok && msResult.data) {
            const nsResult = await suggestNextStep.execute({
              milestoneId: msResult.data.id,
            });
            if (nsResult.ok) nextStep = nsResult.data;
          }
        }

        const report = formatStatusReport(result.data);
        const nextStepLine = nextStep
          ? `\n\n**Next step:** ${nextStep.displayText}`
          : "";

        return {
          content: [{ type: "text", text: report + nextStepLine }],
        };
      },
```

Pass `suggestNextStep` to all command registrations:
```typescript
  registerDiscussCommand(api, {
    startDiscuss,
    sliceRepo: deps.sliceRepo,
    milestoneRepo: deps.milestoneRepo,
    suggestNextStep,
  });
  // ...
  registerResearchCommand(api, {
    sliceRepo: deps.sliceRepo,
    milestoneRepo: deps.milestoneRepo,
    sessionRepo: deps.workflowSessionRepo,
    artifactFile: deps.artifactFile,
    suggestNextStep,
  });
  // ...
  registerPlanCommand(api, {
    sliceRepo: deps.sliceRepo,
    milestoneRepo: deps.milestoneRepo,
    sessionRepo: deps.workflowSessionRepo,
    artifactFile: deps.artifactFile,
    suggestNextStep,
  });
```

**index.ts** — add barrel exports:

```typescript
// Domain — Next Step Suggestion
export {
  NextStepSuggestion,
  type NextStepContext,
  NextStepContextSchema,
  type NextStepSuggestionProps,
  NextStepSuggestionPropsSchema,
} from "./domain/next-step-suggestion.vo";

// Use Cases — add after existing exports
export {
  SuggestNextStepUseCase,
  type SuggestNextStepInput,
} from "./use-cases/suggest-next-step.use-case";
```

- **Run**: `npx vitest run src/hexagons/workflow/`
- **Expect**: PASS — all existing + new tests green
- **Commit**: `feat(S08/T06): wire SuggestNextStepUseCase into commands, status, and barrel exports`

---

## Task Summary

| # | Title | Files | Deps | Wave |
|---|---|---|---|---|
| T01 | Write failing test for NextStepSuggestion VO | `next-step-suggestion.vo.spec.ts` (create) | -- | 0 |
| T02 | Implement NextStepSuggestion VO | `next-step-suggestion.vo.ts` (create) | T01 | 0 |
| T05 | Refactor protocol builders + templates | 3 templates + 3 builders + 1 spec (modify) | -- | 0 |
| T03 | Write failing test for SuggestNextStepUseCase | `suggest-next-step.use-case.spec.ts` (create) | T02 | 1 |
| T04 | Implement SuggestNextStepUseCase | `suggest-next-step.use-case.ts` (create) | T03 | 1 |
| T06 | Wire commands + status + extension + barrel | 3 commands + 2 command specs + extension + index (modify) | T04, T05 | 2 |

**Waves:** 3 | **Tasks:** 6 | **Files affected:** 4 create + 14 modify = 18 total
