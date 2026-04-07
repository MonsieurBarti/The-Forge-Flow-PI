import { createMockExtensionAPI } from "@infrastructure/pi/testing";
import { ok } from "@kernel";
import type { HealthCheckReport } from "@kernel/services/health-check.service";
import { describe, expect, it, vi } from "vitest";
import { TffDispatcher } from "../../../../cli/tff-dispatcher";
import type { HealthCommandDeps } from "./health.command";
import { formatHealthReport, registerHealthCommand } from "./health.command";

function makeReport(overrides: Partial<HealthCheckReport> = {}): HealthCheckReport {
  return {
    fixed: [],
    warnings: [],
    driftDetails: [],
    ...overrides,
  };
}

function makeDeps(report: HealthCheckReport = makeReport()): HealthCommandDeps {
  return {
    healthCheck: {
      runAll: vi.fn().mockResolvedValue(ok(report)),
    } as unknown as HealthCommandDeps["healthCheck"],
    tffDir: "/tmp/.tff",
  };
}

describe("registerHealthCommand", () => {
  it("registers health subcommand", () => {
    const { api } = createMockExtensionAPI();
    const dispatcher = new TffDispatcher();
    const deps = makeDeps();
    registerHealthCommand(dispatcher, api, deps);
    expect(dispatcher.getSubcommands().find((s) => s.name === "health")).toBeDefined();
  });

  it("calls runAll and sends formatted report", async () => {
    const report = makeReport({ fixed: ["Post-checkout hook installed"] });
    const deps = makeDeps(report);
    const { api, fns } = createMockExtensionAPI();
    const dispatcher = new TffDispatcher();
    registerHealthCommand(dispatcher, api, deps);

    // biome-ignore lint/style/noNonNullAssertion: test helper — command is always registered
    const handler = dispatcher.getSubcommands().find((s) => s.name === "health")!.handler;
    await handler("", undefined as never);

    expect(deps.healthCheck.runAll).toHaveBeenCalledWith("/tmp/.tff");
    expect(fns.sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("Post-checkout hook installed"),
    );
  });

  it("sends error message when runAll fails", async () => {
    const { api, fns } = createMockExtensionAPI();
    const dispatcher = new TffDispatcher();
    const deps: HealthCommandDeps = {
      healthCheck: {
        runAll: vi.fn().mockResolvedValue({ ok: false, error: new Error("disk error") }),
      } as unknown as HealthCommandDeps["healthCheck"],
      tffDir: "/tmp/.tff",
    };
    registerHealthCommand(dispatcher, api, deps);

    // biome-ignore lint/style/noNonNullAssertion: test helper — command is always registered
    const handler = dispatcher.getSubcommands().find((s) => s.name === "health")!.handler;
    await handler("", undefined as never);

    expect(fns.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("disk error"));
  });
});

describe("formatHealthReport", () => {
  it("shows fixed items", () => {
    const report = makeReport({ fixed: ["Hook installed", ".gitignore updated"] });
    const output = formatHealthReport(report);
    expect(output).toContain("### Fixed");
    expect(output).toContain("- Hook installed");
    expect(output).toContain("- .gitignore updated");
  });

  it("shows warnings", () => {
    const report = makeReport({ warnings: ["Orphaned worktree detected"] });
    const output = formatHealthReport(report);
    expect(output).toContain("### Warnings");
    expect(output).toContain("- Orphaned worktree detected");
  });

  it("shows drift details table", () => {
    const report = makeReport({
      driftDetails: [
        { sliceId: "id1", sliceLabel: "M01-S01", journalCompleted: 3, sqliteCompleted: 2 },
      ],
    });
    const output = formatHealthReport(report);
    expect(output).toContain("### Journal / SQLite Drift");
    expect(output).toContain("M01-S01");
    expect(output).toContain("| 3 | 2 |");
  });

  it("shows clean state when no issues", () => {
    const report = makeReport();
    const output = formatHealthReport(report);
    expect(output).toContain("No issues found.");
  });
});
