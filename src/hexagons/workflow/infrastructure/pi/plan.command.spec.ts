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
import type { PlanCommandDeps } from "./plan.command";
import { registerPlanCommand } from "./plan.command";

describe("registerPlanCommand", () => {
  it("registers plan subcommand", () => {
    const { api } = createMockExtensionAPI();
    const dispatcher = new TffDispatcher();
    const sessionRepo = new InMemoryWorkflowSessionRepository();
    const sliceRepo = new InMemorySliceRepository();
    const deps: PlanCommandDeps = {
      sliceRepo,
      milestoneRepo: new InMemoryMilestoneRepository(),
      projectRepo: new InMemoryProjectRepository(),
      sessionRepo,
      artifactFile: new InMemoryArtifactFileAdapter(),
      suggestNextStep: new SuggestNextStepUseCase(sessionRepo, sliceRepo),
    };
    registerPlanCommand(dispatcher, api, deps);
    expect(dispatcher.getSubcommands().find((s) => s.name === "plan")).toBeDefined();
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
      registerPlanCommand(dispatcher, api, deps);
      // biome-ignore lint/style/noNonNullAssertion: test helper — command is always registered
      const handler = dispatcher.getSubcommands().find((s) => s.name === "plan")!.handler;
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

    it("returns error if no workflow session exists", async () => {
      const milestone = new MilestoneBuilder().withLabel("M03").build();
      const slice = new SliceBuilder().withLabel("M03-S07").withMilestoneId(milestone.id).build();
      const deps = makeDeps();
      deps.milestoneRepo.seed(milestone);
      deps.sliceRepo.seed(slice);

      const { fns } = await invokeHandler(deps, "M03-S07");
      expect(fns.sendUserMessage).toHaveBeenCalledWith(
        "No workflow session found. Run /tff discuss first.",
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

      const { fns } = await invokeHandler(deps, "M03-S07");
      expect(fns.sendUserMessage).toHaveBeenCalledWith("not planning");
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

      const { fns } = await invokeHandler(deps, "M03-S07");
      expect(fns.sendUserMessage).toHaveBeenCalledWith("No SPEC.md found. Run /tff discuss first.");
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
      deps.artifactFile.read = vi.fn().mockResolvedValue(err(new FileIOError("disk read failed")));

      const { fns } = await invokeHandler(deps, "M03-S07");
      expect(fns.sendUserMessage).toHaveBeenCalledWith("Failed to read SPEC.md");
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

      const { fns } = await invokeHandler(deps, "M03-S07");
      expect(fns.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("PLANNING —"));
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

      const { fns } = await invokeHandler(deps, "M03-S07");
      expect(fns.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("PLANNING —"));
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

      const { fns } = await invokeHandler(deps, slice.id);
      expect(fns.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("PLANNING —"));
    });
  });
});
