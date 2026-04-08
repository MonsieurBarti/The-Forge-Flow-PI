import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    // Create the protocol file required by ExecuteSliceUseCase wiring
    const protocolDir = join(projectRoot, "src/resources/protocols");
    mkdirSync(protocolDir, { recursive: true });
    writeFileSync(join(protocolDir, "execute.md"), "# Execute Protocol\n", "utf-8");
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("registers single tff command via dispatcher", () => {
    const { api, fns } = createMockExtensionAPI();
    createTffExtension(api, { projectRoot });

    const commandNames = fns.registerCommand.mock.calls.map((call: unknown[]) => call[0]);
    expect(commandNames).toContain("tff");
    // Individual commands are now subcommands of "tff", not separate top-level commands
    expect(commandNames).toHaveLength(1);
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

  it("registers tff_health_check, tff_progress, tff_read_settings, tff_update_setting, tff_quick_start tools", () => {
    const { api, fns } = createMockExtensionAPI();
    createTffExtension(api, { projectRoot });

    const toolNames = fns.registerTool.mock.calls.map((call: unknown[]) => {
      const tool = call[0];
      return isRecord(tool) ? tool.name : undefined;
    });
    expect(toolNames).toContain("tff_health_check");
    expect(toolNames).toContain("tff_progress");
    expect(toolNames).toContain("tff_read_settings");
    expect(toolNames).toContain("tff_update_setting");
    expect(toolNames).toContain("tff_quick_start");
  });
});
