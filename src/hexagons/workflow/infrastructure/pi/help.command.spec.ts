import { createMockExtensionAPI } from "@infrastructure/pi/testing";
import { describe, expect, it } from "vitest";
import { registerHelpCommand } from "./help.command";

async function invokeHandler(commands: { name: string; description?: string }[]) {
  const { api, fns } = createMockExtensionAPI();
  fns.getCommands.mockReturnValue(commands);
  registerHelpCommand(api);
  const [, options] = fns.registerCommand.mock.calls[0];
  await options.handler("");
  return { fns };
}

describe("registerHelpCommand", () => {
  it("registers tff:help command", () => {
    const { api, fns } = createMockExtensionAPI();
    fns.getCommands.mockReturnValue([]);
    registerHelpCommand(api);
    expect(fns.registerCommand).toHaveBeenCalledWith(
      "tff:help",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });

  it("calls api.getCommands()", async () => {
    const { fns } = await invokeHandler([
      { name: "tff:discuss", description: "Start discuss phase" },
      { name: "tff:quick", description: "Quick-start a slice" },
      { name: "other:command", description: "Not TFF" },
      { name: "tff:health", description: "Health check" },
    ]);

    const msg = fns.sendUserMessage.mock.calls[0][0];
    expect(msg).toContain("tff:discuss");
    expect(msg).toContain("tff:health");
    expect(msg).toContain("tff:quick");
    expect(msg).not.toContain("other:command");
  });

  it("sorts commands alphabetically", async () => {
    const { fns } = await invokeHandler([
      { name: "tff:quick", description: "Quick-start a slice" },
      { name: "tff:discuss", description: "Start discuss phase" },
      { name: "tff:health", description: "Health check" },
    ]);

    const msg: string = fns.sendUserMessage.mock.calls[0][0];
    const discussIdx = msg.indexOf("tff:discuss");
    const quickIdx = msg.indexOf("tff:quick");
    expect(discussIdx).toBeLessThan(quickIdx);
  });

  it("renders markdown table", async () => {
    const { fns } = await invokeHandler([
      { name: "tff:discuss", description: "Start discuss phase" },
    ]);

    const msg: string = fns.sendUserMessage.mock.calls[0][0];
    expect(msg).toContain("| Command | Description |");
    expect(msg).toContain("|---|---|");
    expect(msg).toContain("| /tff:discuss | Start discuss phase |");
  });

  it("handles missing description gracefully", async () => {
    const { fns } = await invokeHandler([{ name: "tff:discuss" }]);

    const msg: string = fns.sendUserMessage.mock.calls[0][0];
    expect(msg).toContain("| /tff:discuss |  |");
  });

  it("renders empty table when no tff commands exist", async () => {
    const { fns } = await invokeHandler([{ name: "other:command", description: "Not TFF" }]);

    const msg: string = fns.sendUserMessage.mock.calls[0][0];
    expect(msg).toContain("| Command | Description |");
    expect(msg).not.toContain("other:command");
  });
});
