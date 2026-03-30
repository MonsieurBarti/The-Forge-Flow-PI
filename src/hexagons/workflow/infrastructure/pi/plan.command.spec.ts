import { MilestoneBuilder } from "@hexagons/milestone/domain/milestone.builder";
import { InMemoryMilestoneRepository } from "@hexagons/milestone/infrastructure/in-memory-milestone.repository";
import { SliceBuilder } from "@hexagons/slice/domain/slice.builder";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { err } from "@kernel";
import { describe, expect, it, vi } from "vitest";
import { FileIOError } from "../../domain/errors/file-io.error";
import { WorkflowSessionBuilder } from "../../domain/workflow-session.builder";
import { SuggestNextStepUseCase } from "../../use-cases/suggest-next-step.use-case";
import { InMemoryArtifactFileAdapter } from "../in-memory-artifact-file.adapter";
import { InMemoryWorkflowSessionRepository } from "../in-memory-workflow-session.repository";
import type { PlanCommandDeps } from "./plan.command";
import { registerPlanCommand } from "./plan.command";

function makeMockApi() {
  return {
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
  };
}

function makeMockCtx() {
  return {
    cwd: "/tmp",
    isIdle: vi.fn(() => true),
    abort: vi.fn(),
    sendUserMessage: vi.fn(),
  };
}

describe("registerPlanCommand", () => {
  it("registers tff:plan command", () => {
    const api = makeMockApi();
    const sessionRepo = new InMemoryWorkflowSessionRepository();
    const sliceRepo = new InMemorySliceRepository();
    const deps: PlanCommandDeps = {
      sliceRepo,
      milestoneRepo: new InMemoryMilestoneRepository(),
      sessionRepo,
      artifactFile: new InMemoryArtifactFileAdapter(),
      suggestNextStep: new SuggestNextStepUseCase(sessionRepo, sliceRepo),
    };
    registerPlanCommand(api, deps);
    expect(api.registerCommand).toHaveBeenCalledWith(
      "tff:plan",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });

  describe("command handler", () => {
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

    async function invokeHandler(deps: ReturnType<typeof makeDeps>, args: string) {
      const api = makeMockApi();
      registerPlanCommand(api, deps);
      const [, options] = api.registerCommand.mock.calls[0];
      const ctx = makeMockCtx();
      await options.handler(args, ctx);
      return ctx;
    }

    it("returns error if no args provided", async () => {
      const deps = makeDeps();
      const ctx = await invokeHandler(deps, "  ");
      expect(ctx.sendUserMessage).toHaveBeenCalledWith("Usage: /tff:plan <slice-label-or-id>");
    });

    it("returns error if slice not found", async () => {
      const deps = makeDeps();
      const ctx = await invokeHandler(deps, "M03-S99");
      expect(ctx.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("Slice not found"));
    });

    it("returns error if no workflow session exists", async () => {
      const milestone = new MilestoneBuilder().withLabel("M03").build();
      const slice = new SliceBuilder().withLabel("M03-S07").withMilestoneId(milestone.id).build();
      const deps = makeDeps();
      deps.milestoneRepo.seed(milestone);
      deps.sliceRepo.seed(slice);

      const ctx = await invokeHandler(deps, "M03-S07");
      expect(ctx.sendUserMessage).toHaveBeenCalledWith(
        "No workflow session found. Run /tff:discuss first.",
      );
    });

    it("returns error if session phase is not planning", async () => {
      const milestone = new MilestoneBuilder().withLabel("M03").build();
      const slice = new SliceBuilder().withLabel("M03-S07").withMilestoneId(milestone.id).build();
      const session = new WorkflowSessionBuilder()
        .withMilestoneId(milestone.id)
        .withCurrentPhase("researching")
        .build();
      const deps = makeDeps();
      deps.milestoneRepo.seed(milestone);
      deps.sliceRepo.seed(slice);
      deps.sessionRepo.seed(session);

      const ctx = await invokeHandler(deps, "M03-S07");
      expect(ctx.sendUserMessage).toHaveBeenCalledWith("not planning");
    });

    it("returns error if SPEC.md not found", async () => {
      const milestone = new MilestoneBuilder().withLabel("M03").build();
      const slice = new SliceBuilder().withLabel("M03-S07").withMilestoneId(milestone.id).build();
      const session = new WorkflowSessionBuilder()
        .withMilestoneId(milestone.id)
        .withCurrentPhase("planning")
        .build();
      const deps = makeDeps();
      deps.milestoneRepo.seed(milestone);
      deps.sliceRepo.seed(slice);
      deps.sessionRepo.seed(session);
      // artifactFile is empty — no SPEC.md written

      const ctx = await invokeHandler(deps, "M03-S07");
      expect(ctx.sendUserMessage).toHaveBeenCalledWith("No SPEC.md found. Run /tff:discuss first.");
    });

    it("returns error if reading SPEC.md returns FileIOError", async () => {
      const milestone = new MilestoneBuilder().withLabel("M03").build();
      const slice = new SliceBuilder().withLabel("M03-S07").withMilestoneId(milestone.id).build();
      const session = new WorkflowSessionBuilder()
        .withMilestoneId(milestone.id)
        .withCurrentPhase("planning")
        .build();
      const deps = makeDeps();
      deps.milestoneRepo.seed(milestone);
      deps.sliceRepo.seed(slice);
      deps.sessionRepo.seed(session);
      // Override read to simulate FileIOError
      deps.artifactFile.read = vi.fn().mockResolvedValue(err(new FileIOError("disk read failed")));

      const ctx = await invokeHandler(deps, "M03-S07");
      expect(ctx.sendUserMessage).toHaveBeenCalledWith("Failed to read SPEC.md");
    });

    it("sends plan protocol when phase is planning and SPEC.md exists", async () => {
      const milestone = new MilestoneBuilder().withLabel("M03").build();
      const slice = new SliceBuilder()
        .withLabel("M03-S07")
        .withTitle("Plan Command")
        .withDescription("Implements plan command")
        .withMilestoneId(milestone.id)
        .build();
      const session = new WorkflowSessionBuilder()
        .withMilestoneId(milestone.id)
        .withCurrentPhase("planning")
        .withAutonomyMode("guided")
        .build();
      const deps = makeDeps();
      deps.milestoneRepo.seed(milestone);
      deps.sliceRepo.seed(slice);
      deps.sessionRepo.seed(session);
      await deps.artifactFile.write("M03", "M03-S07", "spec", "# SPEC\n\nsome content");
      await deps.artifactFile.write("M03", "M03-S07", "research", "# RESEARCH\n\nsome research");

      const ctx = await invokeHandler(deps, "M03-S07");
      expect(ctx.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("PLANNING —"));
    });

    it("proceeds without RESEARCH.md when not present", async () => {
      const milestone = new MilestoneBuilder().withLabel("M03").build();
      const slice = new SliceBuilder()
        .withLabel("M03-S07")
        .withTitle("Plan Command")
        .withDescription("Implements plan command")
        .withMilestoneId(milestone.id)
        .build();
      const session = new WorkflowSessionBuilder()
        .withMilestoneId(milestone.id)
        .withCurrentPhase("planning")
        .withAutonomyMode("guided")
        .build();
      const deps = makeDeps();
      deps.milestoneRepo.seed(milestone);
      deps.sliceRepo.seed(slice);
      deps.sessionRepo.seed(session);
      await deps.artifactFile.write("M03", "M03-S07", "spec", "# SPEC\n\nsome content");
      // No RESEARCH.md written

      const ctx = await invokeHandler(deps, "M03-S07");
      expect(ctx.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("PLANNING —"));
    });

    it("resolves slice by UUID when label lookup returns null", async () => {
      const milestone = new MilestoneBuilder().withLabel("M03").build();
      const slice = new SliceBuilder().withLabel("M03-S07").withMilestoneId(milestone.id).build();
      const session = new WorkflowSessionBuilder()
        .withMilestoneId(milestone.id)
        .withCurrentPhase("planning")
        .withAutonomyMode("guided")
        .build();
      const deps = makeDeps();
      deps.milestoneRepo.seed(milestone);
      deps.sliceRepo.seed(slice);
      deps.sessionRepo.seed(session);
      await deps.artifactFile.write("M03", "M03-S07", "spec", "# SPEC content");

      const ctx = await invokeHandler(deps, slice.id);
      expect(ctx.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("PLANNING —"));
    });
  });
});
