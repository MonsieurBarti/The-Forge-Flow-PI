import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTffExtension } from "./extension";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function makeMockApi() {
  return {
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
  };
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
    const api = makeMockApi();
    createTffExtension(api, { projectRoot });

    const commandNames = api.registerCommand.mock.calls.map((call: unknown[]) => call[0]);
    expect(commandNames).toContain("tff:new");
    expect(commandNames).toContain("tff:status");
  });

  it("registers tff_init_project and tff_status tools", () => {
    const api = makeMockApi();
    createTffExtension(api, { projectRoot });

    const toolNames = api.registerTool.mock.calls.map((call: unknown[]) => {
      const tool = call[0];
      return isRecord(tool) ? tool.name : undefined;
    });
    expect(toolNames).toContain("tff_init_project");
    expect(toolNames).toContain("tff_status");
  });
});
