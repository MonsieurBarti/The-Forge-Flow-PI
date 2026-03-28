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
import type { ResearchCommandDeps } from "./research.command";
import { registerResearchCommand } from "./research.command";

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

describe("registerResearchCommand", () => {
  it("registers tff:research command", () => {
    const api = makeMockApi();
    const sessionRepo = new InMemoryWorkflowSessionRepository();
    const sliceRepo = new InMemorySliceRepository();
    const deps: ResearchCommandDeps = {
      sliceRepo,
      milestoneRepo: new InMemoryMilestoneRepository(),
      sessionRepo,
      artifactFile: new InMemoryArtifactFileAdapter(),
      suggestNextStep: new SuggestNextStepUseCase(sessionRepo, sliceRepo),
    };
    registerResearchCommand(api, deps);
    expect(api.registerCommand).toHaveBeenCalledWith(
      "tff:research",
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
      registerResearchCommand(api, deps);
      const [, options] = api.registerCommand.mock.calls[0];
      const ctx = makeMockCtx();
      await options.handler(args, ctx);
      return ctx;
    }

    it("returns error if no args provided", async () => {
      const deps = makeDeps();
      const ctx = await invokeHandler(deps, "  ");
      expect(ctx.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("Usage"));
    });

    it("returns error if slice not found", async () => {
      const deps = makeDeps();
      const ctx = await invokeHandler(deps, "M03-S99");
      expect(ctx.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("Slice not found"));
    });

    it("returns error if no workflow session exists for the milestone", async () => {
      const milestone = new MilestoneBuilder().withLabel("M03").build();
      const slice = new SliceBuilder().withLabel("M03-S06").withMilestoneId(milestone.id).build();
      const deps = makeDeps();
      deps.milestoneRepo.seed(milestone);
      deps.sliceRepo.seed(slice);

      const ctx = await invokeHandler(deps, "M03-S06");
      expect(ctx.sendUserMessage).toHaveBeenCalledWith(
        "No workflow session found, run /tff:discuss first",
      );
    });

    it("returns error if session phase is not researching", async () => {
      const milestone = new MilestoneBuilder().withLabel("M03").build();
      const slice = new SliceBuilder().withLabel("M03-S06").withMilestoneId(milestone.id).build();
      const session = new WorkflowSessionBuilder()
        .withMilestoneId(milestone.id)
        .withCurrentPhase("discussing")
        .build();
      const deps = makeDeps();
      deps.milestoneRepo.seed(milestone);
      deps.sliceRepo.seed(slice);
      deps.sessionRepo.seed(session);

      const ctx = await invokeHandler(deps, "M03-S06");
      expect(ctx.sendUserMessage).toHaveBeenCalledWith("not researching, run /tff:discuss first");
    });

    it("returns error if SPEC.md not found", async () => {
      const milestone = new MilestoneBuilder().withLabel("M03").build();
      const slice = new SliceBuilder().withLabel("M03-S06").withMilestoneId(milestone.id).build();
      const session = new WorkflowSessionBuilder()
        .withMilestoneId(milestone.id)
        .withCurrentPhase("researching")
        .build();
      const deps = makeDeps();
      deps.milestoneRepo.seed(milestone);
      deps.sliceRepo.seed(slice);
      deps.sessionRepo.seed(session);
      // artifactFile is empty — no SPEC.md written

      const ctx = await invokeHandler(deps, "M03-S06");
      expect(ctx.sendUserMessage).toHaveBeenCalledWith("No SPEC.md found, run /tff:discuss first");
    });

    it("returns error if ArtifactFilePort.read returns FileIOError", async () => {
      const milestone = new MilestoneBuilder().withLabel("M03").build();
      const slice = new SliceBuilder().withLabel("M03-S06").withMilestoneId(milestone.id).build();
      const session = new WorkflowSessionBuilder()
        .withMilestoneId(milestone.id)
        .withCurrentPhase("researching")
        .build();
      const deps = makeDeps();
      deps.milestoneRepo.seed(milestone);
      deps.sliceRepo.seed(slice);
      deps.sessionRepo.seed(session);
      // Override read to simulate FileIOError
      deps.artifactFile.read = vi.fn().mockResolvedValue(err(new FileIOError("disk read failed")));

      const ctx = await invokeHandler(deps, "M03-S06");
      expect(ctx.sendUserMessage).toHaveBeenCalledWith("Failed to read SPEC.md");
    });

    it("sends research protocol message when session is in researching phase with SPEC.md", async () => {
      const milestone = new MilestoneBuilder().withLabel("M03").build();
      const slice = new SliceBuilder()
        .withLabel("M03-S06")
        .withTitle("Research Command")
        .withDescription("Implements research command")
        .withMilestoneId(milestone.id)
        .build();
      const session = new WorkflowSessionBuilder()
        .withMilestoneId(milestone.id)
        .withCurrentPhase("researching")
        .withAutonomyMode("guided")
        .build();
      const deps = makeDeps();
      deps.milestoneRepo.seed(milestone);
      deps.sliceRepo.seed(slice);
      deps.sessionRepo.seed(session);
      await deps.artifactFile.write("M03", "M03-S06", "spec", "# SPEC\n\nsome content");

      const ctx = await invokeHandler(deps, "M03-S06");
      expect(ctx.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("RESEARCH phase"));
    });

    it("resolves slice by UUID when label lookup returns null", async () => {
      const milestone = new MilestoneBuilder().withLabel("M03").build();
      const slice = new SliceBuilder().withLabel("M03-S06").withMilestoneId(milestone.id).build();
      const session = new WorkflowSessionBuilder()
        .withMilestoneId(milestone.id)
        .withCurrentPhase("researching")
        .withAutonomyMode("guided")
        .build();
      const deps = makeDeps();
      deps.milestoneRepo.seed(milestone);
      deps.sliceRepo.seed(slice);
      deps.sessionRepo.seed(session);
      await deps.artifactFile.write("M03", "M03-S06", "spec", "# SPEC content");

      const ctx = await invokeHandler(deps, slice.id);
      expect(ctx.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("RESEARCH phase"));
    });
  });
});
