import {
  createMockExtensionAPI,
  createMockExtensionCommandContext,
} from "@infrastructure/pi/testing";
import { err, ok } from "@kernel";
import { describe, expect, it, vi } from "vitest";
import { TffDispatcher } from "../../../../cli/tff-dispatcher";
import type { QuickStartOutput } from "../../use-cases/quick-start.use-case";
import type { QuickCommandDeps } from "./quick.command";
import { registerQuickCommand } from "./quick.command";

function makeOutput(overrides: Partial<QuickStartOutput> = {}): QuickStartOutput {
  return {
    sliceId: "slice-uuid-1",
    sliceLabel: "Q-01",
    sessionId: "session-uuid-1",
    currentPhase: "planning",
    autonomyMode: "guided",
    complexity: "S",
    ...overrides,
  };
}

function makeDeps(overrides: Partial<QuickCommandDeps> = {}): QuickCommandDeps {
  return {
    quickStart: {
      execute: vi.fn().mockResolvedValue(ok(makeOutput())),
    } as unknown as QuickCommandDeps["quickStart"],
    tffDir: "/tmp/.tff",
    ...overrides,
  };
}

async function invokeHandler(deps: QuickCommandDeps, args: string) {
  const { api, fns } = createMockExtensionAPI();
  const dispatcher = new TffDispatcher();
  registerQuickCommand(dispatcher, api, deps);
  // biome-ignore lint/style/noNonNullAssertion: test helper — command is always registered
  const handler = dispatcher.getSubcommands().find((s) => s.name === "quick")!.handler;
  const ctx = createMockExtensionCommandContext();
  await handler(args, ctx);
  return { fns };
}

describe("registerQuickCommand", () => {
  it("registers quick subcommand", () => {
    const { api } = createMockExtensionAPI();
    const dispatcher = new TffDispatcher();
    registerQuickCommand(dispatcher, api, makeDeps());
    expect(dispatcher.getSubcommands().find((s) => s.name === "quick")).toBeDefined();
  });

  it("shows usage when no title provided", async () => {
    const deps = makeDeps();
    const { fns } = await invokeHandler(deps, "  ");
    expect(fns.sendUserMessage).toHaveBeenCalledWith(
      "Usage: /tff quick <title> [--complexity S|F-lite|F-full]",
    );
  });

  it("parses title from args", async () => {
    const deps = makeDeps();
    await invokeHandler(deps, "Fix login bug");
    expect(deps.quickStart.execute).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Fix login bug" }),
    );
  });

  it("parses --complexity flag", async () => {
    const deps = makeDeps();
    await invokeHandler(deps, "Fix login bug --complexity F-lite");
    expect(deps.quickStart.execute).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Fix login bug", complexity: "F-lite" }),
    );
  });

  it("defaults complexity to S when flag is absent", async () => {
    const deps = makeDeps();
    await invokeHandler(deps, "Add feature");
    expect(deps.quickStart.execute).toHaveBeenCalledWith(
      expect.objectContaining({ complexity: "S" }),
    );
  });

  it("calls QuickStartUseCase with correct params", async () => {
    const deps = makeDeps();
    await invokeHandler(deps, "My quick task --complexity F-full");
    expect(deps.quickStart.execute).toHaveBeenCalledWith({
      title: "My quick task",
      description: "My quick task",
      complexity: "F-full",
      tffDir: "/tmp/.tff",
    });
  });

  it("sends protocol message on success", async () => {
    const output = makeOutput({
      sliceLabel: "Q-02",
      currentPhase: "planning",
      autonomyMode: "plan-to-pr",
      complexity: "S",
    });
    const deps = makeDeps({
      quickStart: {
        execute: vi.fn().mockResolvedValue(ok(output)),
      } as unknown as QuickCommandDeps["quickStart"],
    });
    const { fns } = await invokeHandler(deps, "Some task");
    expect(fns.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("Q-02"));
    expect(fns.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("planning"));
  });

  it("sends protocol message indicating auto-approved when phase is executing", async () => {
    const output = makeOutput({
      currentPhase: "executing",
      autonomyMode: "plan-to-pr",
      complexity: "S",
    });
    const deps = makeDeps({
      quickStart: {
        execute: vi.fn().mockResolvedValue(ok(output)),
      } as unknown as QuickCommandDeps["quickStart"],
    });
    const { fns } = await invokeHandler(deps, "Some task");
    expect(fns.sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("Auto-approved for execution."),
    );
  });

  it("sends error message on failure", async () => {
    const deps = makeDeps({
      quickStart: {
        execute: vi.fn().mockResolvedValue(err(new Error("workspace creation failed"))),
      } as unknown as QuickCommandDeps["quickStart"],
    });
    const { fns } = await invokeHandler(deps, "Failing task");
    expect(fns.sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("workspace creation failed"),
    );
  });
});
