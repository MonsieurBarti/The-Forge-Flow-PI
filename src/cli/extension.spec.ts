import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockExtensionAPI } from "@infrastructure/pi/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTffExtension } from "./extension";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

describe("createTffExtension", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "tff-ext-test-"));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("registers tff:new and tff:status commands", () => {
    const { api, fns } = createMockExtensionAPI();
    createTffExtension(api, { projectRoot });

    const commandNames = fns.registerCommand.mock.calls.map((call: unknown[]) => call[0]);
    expect(commandNames).toContain("tff:new");
    expect(commandNames).toContain("tff:status");
  });

  it("registers tff_init_project and tff_status tools", () => {
    const { api, fns } = createMockExtensionAPI();
    createTffExtension(api, { projectRoot });

    const toolNames = fns.registerTool.mock.calls.map((call: unknown[]) => {
      const tool = call[0];
      return isRecord(tool) ? tool.name : undefined;
    });
    expect(toolNames).toContain("tff_init_project");
    expect(toolNames).toContain("tff_status");
  });
});
