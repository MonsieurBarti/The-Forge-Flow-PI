import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TUI } from "@mariozechner/pi-tui";
import type { MarkdownTheme } from "@mariozechner/pi-tui";
import type { OverlayDataPort, OverlayProjectSnapshot } from "@kernel/ports/overlay-data.port";
import type { BudgetTrackingPort } from "@hexagons/settings/domain/ports/budget-tracking.port";
import type { SliceStatus } from "@hexagons/slice/domain/slice.schemas";
import { ok, err } from "@kernel/result";
import {
  DashboardComponent,
  buildMarkdown,
  progressBar,
  NEXT_ACTION,
} from "./dashboard.component";

// --- Test helpers ---

function identityTheme(): MarkdownTheme {
  const id = (text: string) => text;
  return {
    heading: id,
    link: id,
    linkUrl: id,
    code: id,
    codeBlock: id,
    codeBlockBorder: id,
    quote: id,
    quoteBorder: id,
    hr: id,
    listBullet: id,
    bold: id,
    italic: id,
    strikethrough: id,
    underline: id,
  };
}

function mockTui(): Pick<TUI, "requestRender"> & { requestRender: ReturnType<typeof vi.fn> } {
  return { requestRender: vi.fn() };
}

function mockOverlayDataPort(): OverlayDataPort {
  return {
    getProjectSnapshot: vi.fn(),
    getSliceSnapshot: vi.fn(),
  } as unknown as OverlayDataPort;
}

function mockBudgetTrackingPort(): BudgetTrackingPort {
  return {
    getUsagePercent: vi.fn(),
  } as unknown as BudgetTrackingPort;
}

function fullSnapshot(): OverlayProjectSnapshot {
  const taskCounts = new Map<string, { done: number; total: number }>();
  taskCounts.set("slice-1", { done: 2, total: 5 });
  taskCounts.set("slice-2", { done: 3, total: 3 });

  return {
    project: { name: "Forge Flow" },
    milestone: { label: "M06", title: "TUI Overlays" },
    slices: [
      { label: "M06-S01", title: "Setup", status: "executing" as SliceStatus, complexity: "S", id: "slice-1" },
      { label: "M06-S02", title: "Dashboard", status: "closed" as SliceStatus, complexity: "F-lite", id: "slice-2" },
    ],
    taskCounts,
  };
}

function allClosedSnapshot(): OverlayProjectSnapshot {
  const taskCounts = new Map<string, { done: number; total: number }>();
  taskCounts.set("slice-1", { done: 3, total: 3 });

  return {
    project: { name: "Forge Flow" },
    milestone: { label: "M06", title: "TUI Overlays" },
    slices: [
      { label: "M06-S01", title: "Setup", status: "closed" as SliceStatus, complexity: "S", id: "slice-1" },
    ],
    taskCounts,
  };
}

// --- Tests ---

describe("progressBar", () => {
  it("renders 0%", () => {
    expect(progressBar(0)).toBe("[░░░░░░░░░░░░░░░░] 0%");
  });

  it("renders 50%", () => {
    expect(progressBar(50)).toBe("[████████░░░░░░░░] 50%");
  });

  it("renders 100%", () => {
    expect(progressBar(100)).toBe("[████████████████] 100%");
  });

  it("clamps values above 100", () => {
    expect(progressBar(150)).toBe("[████████████████] 100%");
  });

  it("clamps values below 0", () => {
    expect(progressBar(-10)).toBe("[░░░░░░░░░░░░░░░░] 0%");
  });

  it("accepts custom width", () => {
    const result = progressBar(50, 8);
    expect(result).toBe("[████░░░░] 50%");
  });
});

describe("NEXT_ACTION", () => {
  it.each<[SliceStatus, string]>([
    ["discussing", "/tff:research"],
    ["researching", "/tff:plan"],
    ["planning", "/tff:execute"],
    ["executing", "/tff:verify"],
    ["verifying", "/tff:ship"],
    ["reviewing", "/tff:ship"],
    ["completing", "/tff:complete-milestone"],
    ["closed", "/tff:status"],
  ])("maps %s to %s", (status, expectedCmd) => {
    expect(NEXT_ACTION[status].cmd).toBe(expectedCmd);
  });
});

describe("buildMarkdown", () => {
  it("renders full project snapshot", () => {
    const snapshot = fullSnapshot();
    const md = buildMarkdown(snapshot, 42);

    // Project heading
    expect(md).toContain("# Forge Flow");
    // Milestone heading with progress
    expect(md).toContain("M06");
    expect(md).toContain("TUI Overlays");
    expect(md).toContain("5/8"); // total done/total across all slices
    // Slice table rows
    expect(md).toContain("M06-S01");
    expect(md).toContain("executing");
    expect(md).toContain("2/5");
    expect(md).toContain("M06-S02");
    expect(md).toContain("closed");
    expect(md).toContain("3/3");
    // Budget
    expect(md).toContain("Budget");
    expect(md).toContain("42%");
    // Next action — first non-closed slice is executing
    expect(md).toContain("/tff:verify");
  });

  it("renders empty state for null snapshot", () => {
    const snapshot: OverlayProjectSnapshot = {
      project: null,
      milestone: null,
      slices: [],
      taskCounts: new Map(),
    };
    const md = buildMarkdown(snapshot, 0);

    expect(md).toContain("No project data");
  });

  it("suggests /tff:complete-milestone when all slices closed", () => {
    const snapshot = allClosedSnapshot();
    const md = buildMarkdown(snapshot, 10);

    expect(md).toContain("/tff:complete-milestone");
  });
});

describe("DashboardComponent", () => {
  let tui: ReturnType<typeof mockTui>;
  let overlayData: OverlayDataPort;
  let budgetTracking: BudgetTrackingPort;
  let theme: MarkdownTheme;

  beforeEach(() => {
    tui = mockTui();
    overlayData = mockOverlayDataPort();
    budgetTracking = mockBudgetTrackingPort();
    theme = identityTheme();
  });

  it("refresh() queries both ports, updates markdown, and triggers render", async () => {
    const snapshot = fullSnapshot();
    (overlayData.getProjectSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue(ok(snapshot));
    (budgetTracking.getUsagePercent as ReturnType<typeof vi.fn>).mockResolvedValue(ok(75));

    const component = new DashboardComponent(
      tui as unknown as TUI,
      overlayData,
      budgetTracking,
      theme,
      1,
      0,
    );

    // Wait for constructor's fire-and-forget refresh
    await component.refresh();

    expect(overlayData.getProjectSnapshot).toHaveBeenCalled();
    expect(budgetTracking.getUsagePercent).toHaveBeenCalled();
    expect(tui.requestRender).toHaveBeenCalled();
  });

  it("render() delegates to internal Markdown and returns string[]", async () => {
    const snapshot = fullSnapshot();
    (overlayData.getProjectSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue(ok(snapshot));
    (budgetTracking.getUsagePercent as ReturnType<typeof vi.fn>).mockResolvedValue(ok(50));

    const component = new DashboardComponent(
      tui as unknown as TUI,
      overlayData,
      budgetTracking,
      theme,
      1,
      0,
    );

    await component.refresh();

    const lines = component.render(80);
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
    // Should contain project name somewhere in the rendered output
    const joined = lines.join("\n");
    expect(joined).toContain("Forge Flow");
  });

  it("render() returns loading text before refresh completes", () => {
    (overlayData.getProjectSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Promise(() => {}), // never resolves
    );
    (budgetTracking.getUsagePercent as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Promise(() => {}),
    );

    const component = new DashboardComponent(
      tui as unknown as TUI,
      overlayData,
      budgetTracking,
      theme,
      1,
      0,
    );

    const lines = component.render(80);
    const joined = lines.join("\n");
    expect(joined).toContain("Loading dashboard");
  });

  it("handles port errors gracefully in refresh()", async () => {
    (overlayData.getProjectSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue(
      err(new Error("db down")),
    );
    (budgetTracking.getUsagePercent as ReturnType<typeof vi.fn>).mockResolvedValue(ok(0));

    const component = new DashboardComponent(
      tui as unknown as TUI,
      overlayData,
      budgetTracking,
      theme,
      1,
      0,
    );

    // Should not throw
    await component.refresh();
    expect(tui.requestRender).toHaveBeenCalled();

    const lines = component.render(80);
    const joined = lines.join("\n");
    expect(joined).toContain("No project data");
  });

  it("invalidate() delegates to internal markdown", () => {
    (overlayData.getProjectSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Promise(() => {}),
    );
    (budgetTracking.getUsagePercent as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Promise(() => {}),
    );

    const component = new DashboardComponent(
      tui as unknown as TUI,
      overlayData,
      budgetTracking,
      theme,
      1,
      0,
    );

    // Should not throw
    expect(() => component.invalidate()).not.toThrow();
  });
});
