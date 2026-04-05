import { createMockExtensionAPI, createMockExtensionContext } from "@infrastructure/pi/testing";
import { err, ok } from "@kernel";
import { describe, expect, it, vi } from "vitest";
import type { QuickStartUseCase } from "../../use-cases/quick-start.use-case";
import type { DebugCommandDeps } from "./debug.command";
import { registerDebugCommand } from "./debug.command";

function makeQuickStartMock(overrides?: {
  failure?: boolean;
  phase?: string;
  complexity?: "S" | "F-lite" | "F-full";
}): QuickStartUseCase {
  const phase = overrides?.phase ?? "executing";
  const complexity = overrides?.complexity ?? "S";

  const execute = overrides?.failure
    ? vi.fn().mockResolvedValue(err({ message: "persistence failure" }))
    : vi.fn().mockResolvedValue(
        ok({
          sliceId: "uuid-1",
          sliceLabel: "D-01",
          sessionId: "session-uuid",
          currentPhase: phase,
          autonomyMode: "plan-to-pr" as const,
          complexity,
        }),
      );

  return { execute } as unknown as QuickStartUseCase;
}

function makeDeps(overrides?: {
  failure?: boolean;
  phase?: string;
  complexity?: "S" | "F-lite" | "F-full";
}): DebugCommandDeps {
  return {
    quickStart: makeQuickStartMock(overrides),
    tffDir: "/tmp/.tff",
  };
}

async function invokeHandler(deps: DebugCommandDeps, args: string) {
  const { api, fns } = createMockExtensionAPI();
  registerDebugCommand(api, deps);
  const [, options] = fns.registerCommand.mock.calls[0];
  const ctx = createMockExtensionContext();
  await options.handler(args, ctx);
  return { fns };
}

describe("registerDebugCommand", () => {
  it("creates slice with kind debug", async () => {
    const deps = makeDeps();
    await invokeHandler(deps, "login fails with 401");
    expect(deps.quickStart.execute).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "debug" }),
    );
  });

  it("prefixes title with Debug:", async () => {
    const deps = makeDeps();
    await invokeHandler(deps, "login fails with 401");
    expect(deps.quickStart.execute).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Debug: login fails with 401" }),
    );
  });

  it("sends debug protocol message with 4-phase structure", async () => {
    const deps = makeDeps();
    const { fns } = await invokeHandler(deps, "login fails with 401");
    const message: string = fns.sendUserMessage.mock.calls[0][0];
    expect(message).toContain("Debug slice D-01 created");
    expect(message).toContain("## Bug Description");
    expect(message).toContain("login fails with 401");
    expect(message).toContain("## Debugging Protocol");
    expect(message).toContain("Reproduce");
    expect(message).toContain("Hypothesize");
    expect(message).toContain("Test");
    expect(message).toContain("Fix");
  });

  it("sends error on failure", async () => {
    const deps = makeDeps({ failure: true });
    const { fns } = await invokeHandler(deps, "login fails with 401");
    expect(fns.sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("Error: persistence failure"),
    );
  });

  it("shows usage when no description provided", async () => {
    const deps = makeDeps();
    const { fns } = await invokeHandler(deps, "  ");
    expect(fns.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("Usage"));
    expect(deps.quickStart.execute).not.toHaveBeenCalled();
  });

  it("parses --complexity flag and passes it through", async () => {
    const deps = makeDeps({ complexity: "F-lite" });
    await invokeHandler(deps, "null pointer crash --complexity F-lite");
    expect(deps.quickStart.execute).toHaveBeenCalledWith(
      expect.objectContaining({ complexity: "F-lite" }),
    );
  });
});
