import { createMockExtensionAPI } from "@infrastructure/pi/testing";
import { describe, expect, it } from "vitest";
import { TffDispatcher } from "../../../../cli/tff-dispatcher";
import { registerHelpCommand } from "./help.command";

function makeDispatcherWithCommands(
  commands: { name: string; description: string }[],
): TffDispatcher {
  const dispatcher = new TffDispatcher();
  for (const cmd of commands) {
    dispatcher.register({
      name: cmd.name,
      description: cmd.description,
      handler: async () => {},
    });
  }
  return dispatcher;
}

async function invokeHandler(subcommands: { name: string; description: string }[]) {
  const { api, fns } = createMockExtensionAPI();
  const dispatcher = makeDispatcherWithCommands(subcommands);
  registerHelpCommand(dispatcher, api);
  // biome-ignore lint/style/noNonNullAssertion: test helper — command is always registered
  const handler = dispatcher.getSubcommands().find((s) => s.name === "help")!.handler;
  await handler("", undefined as never);
  return { fns };
}

describe("registerHelpCommand", () => {
  it("registers help subcommand", () => {
    const { api } = createMockExtensionAPI();
    const dispatcher = new TffDispatcher();
    registerHelpCommand(dispatcher, api);
    expect(dispatcher.getSubcommands().find((s) => s.name === "help")).toBeDefined();
  });

  it("lists registered subcommands", async () => {
    const { fns } = await invokeHandler([
      { name: "discuss", description: "Start discuss phase" },
      { name: "quick", description: "Quick-start a slice" },
      { name: "health", description: "Health check" },
    ]);

    const msg = fns.sendUserMessage.mock.calls[0][0];
    expect(msg).toContain("discuss");
    expect(msg).toContain("health");
    expect(msg).toContain("quick");
  });

  it("sorts commands alphabetically", async () => {
    const { fns } = await invokeHandler([
      { name: "quick", description: "Quick-start a slice" },
      { name: "discuss", description: "Start discuss phase" },
      { name: "health", description: "Health check" },
    ]);

    const msg: string = fns.sendUserMessage.mock.calls[0][0];
    const discussIdx = msg.indexOf("discuss");
    const quickIdx = msg.indexOf("quick");
    expect(discussIdx).toBeLessThan(quickIdx);
  });

  it("renders markdown table", async () => {
    const { fns } = await invokeHandler([{ name: "discuss", description: "Start discuss phase" }]);

    const msg: string = fns.sendUserMessage.mock.calls[0][0];
    expect(msg).toContain("| Command | Description |");
    expect(msg).toContain("|---|---|");
    expect(msg).toContain("| /tff discuss | Start discuss phase |");
  });

  it("renders empty table when no other subcommands exist", async () => {
    const { fns } = await invokeHandler([]);

    const msg: string = fns.sendUserMessage.mock.calls[0][0];
    expect(msg).toContain("| Command | Description |");
    // Only the help command itself should be present
  });
});
