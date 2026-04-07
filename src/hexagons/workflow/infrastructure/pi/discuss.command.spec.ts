import { MilestoneBuilder } from "@hexagons/milestone/domain/milestone.builder";
import { InMemoryMilestoneRepository } from "@hexagons/milestone/infrastructure/in-memory-milestone.repository";
import { InMemoryProjectRepository } from "@hexagons/project/infrastructure/in-memory-project.repository";
import { SliceBuilder } from "@hexagons/slice/domain/slice.builder";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import {
  createMockExtensionAPI,
  createMockExtensionCommandContext,
} from "@infrastructure/pi/testing";
import { InProcessEventBus, SilentLoggerAdapter } from "@kernel";
import { describe, expect, it } from "vitest";
import { TffDispatcher } from "../../../../cli/tff-dispatcher";
import { WorkflowSessionBuilder } from "../../domain/workflow-session.builder";
import { StartDiscussUseCase } from "../../use-cases/start-discuss.use-case";
import { SuggestNextStepUseCase } from "../../use-cases/suggest-next-step.use-case";
import { InMemoryWorkflowSessionRepository } from "../in-memory-workflow-session.repository";
import { registerDiscussCommand } from "./discuss.command";

function makeDeps() {
  const sliceRepo = new InMemorySliceRepository();
  const sessionRepo = new InMemoryWorkflowSessionRepository();
  const eventBus = new InProcessEventBus(new SilentLoggerAdapter());
  const fixedNow = new Date("2026-04-07T12:00:00Z");
  const dateProvider = { now: () => fixedNow };
  const autonomyModeProvider = { getAutonomyMode: () => "guided" as const };

  const startDiscuss = new StartDiscussUseCase(
    sliceRepo,
    sessionRepo,
    eventBus,
    dateProvider,
    autonomyModeProvider,
  );

  return {
    startDiscuss,
    sliceRepo,
    milestoneRepo: new InMemoryMilestoneRepository(),
    projectRepo: new InMemoryProjectRepository(),
    sessionRepo,
    suggestNextStep: new SuggestNextStepUseCase(sessionRepo, sliceRepo),
    tffDir: "/tmp/.tff",
  };
}

async function invokeHandler(deps: ReturnType<typeof makeDeps>, args: string) {
  const { api, fns } = createMockExtensionAPI();
  const dispatcher = new TffDispatcher();
  registerDiscussCommand(dispatcher, api, deps);
  // biome-ignore lint/style/noNonNullAssertion: test helper — command is always registered
  const handler = dispatcher.getSubcommands().find((s) => s.name === "discuss")!.handler;
  const ctx = createMockExtensionCommandContext();
  await handler(args, ctx);
  return { fns };
}

describe("registerDiscussCommand", () => {
  it("registers discuss subcommand", () => {
    const { api } = createMockExtensionAPI();
    const dispatcher = new TffDispatcher();
    const deps = makeDeps();
    registerDiscussCommand(dispatcher, api, deps);
    expect(dispatcher.getSubcommands().find((s) => s.name === "discuss")).toBeDefined();
  });

  describe("command handler", () => {
    it("returns no-project message when no args and no project exists", async () => {
      const deps = makeDeps();
      const { fns } = await invokeHandler(deps, "  ");
      expect(fns.sendUserMessage).toHaveBeenCalledWith(
        "No TFF project found. Run /tff new to initialize.",
      );
    });

    it("returns error if slice not found", async () => {
      const deps = makeDeps();
      const { fns } = await invokeHandler(deps, "M01-S99");
      expect(fns.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("Slice not found"));
    });

    it("returns error if milestone not found", async () => {
      const missingMsId = "a0000000-0000-1000-a000-000000000099";
      const slice = new SliceBuilder().withLabel("M01-S01").withMilestoneId(missingMsId).build();
      const deps = makeDeps();
      deps.sliceRepo.seed(slice);

      const { fns } = await invokeHandler(deps, "M01-S01");
      expect(fns.sendUserMessage).toHaveBeenCalledWith(
        expect.stringContaining("Milestone not found"),
      );
    });

    it("creates session and sends discuss protocol on success", async () => {
      const milestone = new MilestoneBuilder().withLabel("M01").build();
      const slice = new SliceBuilder()
        .withLabel("M01-S01")
        .withTitle("Project Setup")
        .withDescription("Set up the project structure")
        .withMilestoneId(milestone.id)
        .build();
      const deps = makeDeps();
      deps.milestoneRepo.seed(milestone);
      deps.sliceRepo.seed(slice);

      const { fns } = await invokeHandler(deps, "M01-S01");
      expect(fns.sendMessage).toHaveBeenCalled();
    });

    it("creates a workflow session in the repository", async () => {
      const milestone = new MilestoneBuilder().withLabel("M01").build();
      const slice = new SliceBuilder()
        .withLabel("M01-S01")
        .withTitle("Project Setup")
        .withMilestoneId(milestone.id)
        .build();
      const deps = makeDeps();
      deps.milestoneRepo.seed(milestone);
      deps.sliceRepo.seed(slice);

      await invokeHandler(deps, "M01-S01");

      const sessionResult = await deps.sessionRepo.findByMilestoneId(milestone.id);
      expect(sessionResult.ok).toBe(true);
      if (!sessionResult.ok) return;
      expect(sessionResult.data).not.toBeNull();
      expect(sessionResult.data?.currentPhase).toBe("discussing");
      expect(sessionResult.data?.sliceId).toBe(slice.id);
    });

    it("resolves slice by UUID when label lookup returns null", async () => {
      const milestone = new MilestoneBuilder().withLabel("M01").build();
      const slice = new SliceBuilder()
        .withLabel("M01-S01")
        .withTitle("Project Setup")
        .withMilestoneId(milestone.id)
        .build();
      const deps = makeDeps();
      deps.milestoneRepo.seed(milestone);
      deps.sliceRepo.seed(slice);

      const { fns } = await invokeHandler(deps, slice.id);
      expect(fns.sendMessage).toHaveBeenCalled();
    });

    it("returns error if session already has an active slice", async () => {
      const milestone = new MilestoneBuilder().withLabel("M01").build();
      const slice1 = new SliceBuilder().withLabel("M01-S01").withMilestoneId(milestone.id).build();
      const slice2 = new SliceBuilder().withLabel("M01-S02").withMilestoneId(milestone.id).build();

      // Create a session with slice1 already assigned
      const session = new WorkflowSessionBuilder()
        .withMilestoneId(milestone.id)
        .withCurrentPhase("discussing")
        .withSliceId(slice1.id)
        .build();

      const deps = makeDeps();
      deps.milestoneRepo.seed(milestone);
      deps.sliceRepo.seed(slice1);
      deps.sliceRepo.seed(slice2);
      deps.sessionRepo.seed(session);

      const { fns } = await invokeHandler(deps, "M01-S02");
      expect(fns.sendUserMessage).toHaveBeenCalledWith(
        expect.stringContaining("Error starting discuss"),
      );
    });

    it("includes protocol template variables in output", async () => {
      const milestone = new MilestoneBuilder().withLabel("M01").build();
      const slice = new SliceBuilder()
        .withLabel("M01-S01")
        .withTitle("Project Setup")
        .withDescription("Set up the project structure")
        .withMilestoneId(milestone.id)
        .build();
      const deps = makeDeps();
      deps.milestoneRepo.seed(milestone);
      deps.sliceRepo.seed(slice);

      const { fns } = await invokeHandler(deps, "M01-S01");
      const payload = fns.sendMessage.mock.calls[0][0] as { content: string };
      const message = payload.content;

      expect(message).toContain("M01-S01");
      expect(message).toContain("Project Setup");
      expect(message).toContain(slice.id);
      expect(message).toContain(milestone.id);
    });
  });
});
