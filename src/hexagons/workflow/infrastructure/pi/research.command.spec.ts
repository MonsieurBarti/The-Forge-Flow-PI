import { MilestoneBuilder } from "@hexagons/milestone/domain/milestone.builder";
import { InMemoryMilestoneRepository } from "@hexagons/milestone/infrastructure/in-memory-milestone.repository";
import { InMemoryProjectRepository } from "@hexagons/project/infrastructure/in-memory-project.repository";
import { SliceBuilder } from "@hexagons/slice/domain/slice.builder";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import {
  createMockExtensionAPI,
  createMockExtensionCommandContext,
} from "@infrastructure/pi/testing";
import { err } from "@kernel";
import { describe, expect, it, vi } from "vitest";
import { TffDispatcher } from "../../../../cli/tff-dispatcher";
import { FileIOError } from "../../domain/errors/file-io.error";
import { WorkflowSessionBuilder } from "../../domain/workflow-session.builder";
import { SuggestNextStepUseCase } from "../../use-cases/suggest-next-step.use-case";
import { InMemoryArtifactFileAdapter } from "../in-memory-artifact-file.adapter";
import { InMemoryWorkflowSessionRepository } from "../in-memory-workflow-session.repository";
import type { ResearchCommandDeps } from "./research.command";
import { registerResearchCommand } from "./research.command";

describe("registerResearchCommand", () => {
  it("registers research subcommand", () => {
    const { api } = createMockExtensionAPI();
    const dispatcher = new TffDispatcher();
    const sessionRepo = new InMemoryWorkflowSessionRepository();
    const sliceRepo = new InMemorySliceRepository();
    const deps: ResearchCommandDeps = {
      sliceRepo,
      milestoneRepo: new InMemoryMilestoneRepository(),
      projectRepo: new InMemoryProjectRepository(),
      sessionRepo,
      artifactFile: new InMemoryArtifactFileAdapter(),
      suggestNextStep: new SuggestNextStepUseCase(sessionRepo, sliceRepo),
    };
    registerResearchCommand(dispatcher, api, deps);
    expect(dispatcher.getSubcommands().find((s) => s.name === "research")).toBeDefined();
  });

  describe("command handler", () => {
    function makeDeps() {
      const sessionRepo = new InMemoryWorkflowSessionRepository();
      const sliceRepo = new InMemorySliceRepository();
      return {
        sliceRepo,
        milestoneRepo: new InMemoryMilestoneRepository(),
        projectRepo: new InMemoryProjectRepository(),
        sessionRepo,
        artifactFile: new InMemoryArtifactFileAdapter(),
        suggestNextStep: new SuggestNextStepUseCase(sessionRepo, sliceRepo),
      };
    }

    async function invokeHandler(deps: ReturnType<typeof makeDeps>, args: string) {
      const { api, fns } = createMockExtensionAPI();
      const dispatcher = new TffDispatcher();
      registerResearchCommand(dispatcher, api, deps);
      // biome-ignore lint/style/noNonNullAssertion: test helper — command is always registered
      const handler = dispatcher.getSubcommands().find((s) => s.name === "research")!.handler;
      const ctx = createMockExtensionCommandContext();
      await handler(args, ctx);
      return { fns };
    }

    it("returns no-project message when no args and no project exists", async () => {
      const deps = makeDeps();
      const { fns } = await invokeHandler(deps, "  ");
      expect(fns.sendUserMessage).toHaveBeenCalledWith(
        "No TFF project found. Run /tff new to initialize.",
      );
    });

    it("returns error if slice not found", async () => {
      const deps = makeDeps();
      const { fns } = await invokeHandler(deps, "M03-S99");
      expect(fns.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("Slice not found"));
    });

    it("returns error if no workflow session exists for the milestone", async () => {
      const milestone = new MilestoneBuilder().withLabel("M03").build();
      const slice = new SliceBuilder().withLabel("M03-S06").withMilestoneId(milestone.id).build();
      const deps = makeDeps();
      deps.milestoneRepo.seed(milestone);
      deps.sliceRepo.seed(slice);

      const { fns } = await invokeHandler(deps, "M03-S06");
      expect(fns.sendUserMessage).toHaveBeenCalledWith(
        "No workflow session found, run /tff discuss first",
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

      const { fns } = await invokeHandler(deps, "M03-S06");
      expect(fns.sendUserMessage).toHaveBeenCalledWith(
        expect.stringContaining("Cannot start research"),
      );
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

      const { fns } = await invokeHandler(deps, "M03-S06");
      expect(fns.sendUserMessage).toHaveBeenCalledWith("No SPEC.md found, run /tff discuss first");
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
      deps.artifactFile.read = vi.fn().mockResolvedValue(err(new FileIOError("disk read failed")));

      const { fns } = await invokeHandler(deps, "M03-S06");
      expect(fns.sendUserMessage).toHaveBeenCalledWith("Failed to read SPEC.md");
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

      const { fns } = await invokeHandler(deps, "M03-S06");
      expect(fns.sendMessage).toHaveBeenCalled();
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

      const { fns } = await invokeHandler(deps, slice.id);
      expect(fns.sendMessage).toHaveBeenCalled();
    });
  });
});
