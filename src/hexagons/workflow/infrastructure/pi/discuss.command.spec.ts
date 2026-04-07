import { MilestoneBuilder } from "@hexagons/milestone/domain/milestone.builder";
import { InMemoryMilestoneRepository } from "@hexagons/milestone/infrastructure/in-memory-milestone.repository";
import { SliceBuilder } from "@hexagons/slice/domain/slice.builder";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { createMockExtensionAPI, createMockExtensionContext } from "@infrastructure/pi/testing";
import { InProcessEventBus, SilentLoggerAdapter } from "@kernel";
import { describe, expect, it } from "vitest";
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
    sessionRepo,
    suggestNextStep: new SuggestNextStepUseCase(sessionRepo, sliceRepo),
    tffDir: "/tmp/.tff",
  };
}

async function invokeHandler(deps: ReturnType<typeof makeDeps>, args: string) {
  const { api, fns } = createMockExtensionAPI();
  registerDiscussCommand(api, deps);
  const [, options] = fns.registerCommand.mock.calls[0];
  const ctx = createMockExtensionContext();
  await options.handler(args, ctx);
  return { fns };
}

describe("registerDiscussCommand", () => {
  it("registers tff:discuss command", () => {
    const { api, fns } = createMockExtensionAPI();
    const deps = makeDeps();
    registerDiscussCommand(api, deps);
    expect(fns.registerCommand).toHaveBeenCalledWith(
      "tff:discuss",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });

  describe("command handler", () => {
    it("returns usage if no args provided", async () => {
      const deps = makeDeps();
      const { fns } = await invokeHandler(deps, "  ");
      expect(fns.sendUserMessage).toHaveBeenCalledWith("Usage: /tff:discuss <slice-label-or-id>");
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
      expect(fns.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("DISCUSSING"));
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
      expect(fns.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("DISCUSSING"));
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
      const message = fns.sendUserMessage.mock.calls[0][0] as string;

      expect(message).toContain("M01-S01");
      expect(message).toContain("Project Setup");
      expect(message).toContain(slice.id);
      expect(message).toContain(milestone.id);
    });
  });
});
