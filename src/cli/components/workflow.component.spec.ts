import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TUI } from "@mariozechner/pi-tui";
import type { MarkdownTheme } from "@mariozechner/pi-tui";
import type { OverlayDataPort, OverlayProjectSnapshot } from "@kernel/ports/overlay-data.port";
import type { SliceStatus } from "@hexagons/slice/domain/slice.schemas";
import { ok, err } from "@kernel/result";
import {
  PHASE_ORDER,
  PHASE_DISPLAY_NAMES,
  renderPipeline,
  formatDuration,
  renderMetadata,
  buildWorkflowMarkdown,
  WorkflowComponent,
} from "./workflow.component";

// --- Test helpers ---

function identityTheme(): MarkdownTheme {
  const id = (text: string) => text;
  return {
    heading: id, link: id, linkUrl: id, code: id, codeBlock: id,
    codeBlockBorder: id, quote: id, quoteBorder: id, hr: id,
    listBullet: id, bold: id, italic: id, strikethrough: id, underline: id,
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

describe("PHASE_ORDER", () => {
  it("contains all 8 slice statuses in order", () => {
    expect(PHASE_ORDER).toEqual([
      "discussing", "researching", "planning", "executing",
      "verifying", "reviewing", "completing", "closed",
    ]);
  });
});

describe("PHASE_DISPLAY_NAMES", () => {
  it("maps each status to a short display name", () => {
    expect(PHASE_DISPLAY_NAMES.discussing).toBe("discuss");
    expect(PHASE_DISPLAY_NAMES.completing).toBe("ship");
  });
});

describe("renderPipeline", () => {
  it("marks phases before current as completed (● marker)", () => {
    const result = renderPipeline("planning");
    expect(result).toContain("● discuss");
    expect(result).toContain("● research");
  });

  it("marks current phase with bold arrow marker", () => {
    const result = renderPipeline("planning");
    expect(result).toContain("**▶ plan**");
  });

  it("marks phases after current as future (○ marker)", () => {
    const result = renderPipeline("planning");
    expect(result).toContain("○ execute");
    expect(result).toContain("○ closed");
  });

  it("renders all 8 phases with connectors", () => {
    const result = renderPipeline("discussing");
    for (const name of Object.values(PHASE_DISPLAY_NAMES)) {
      expect(result).toContain(name);
    }
    expect(result).toContain("──");
  });

  it("handles first phase (discussing) — no completed phases", () => {
    const result = renderPipeline("discussing");
    expect(result).toContain("**▶ discuss**");
    expect(result).not.toContain("●");
  });

  it("handles last phase (closed) — all completed", () => {
    const result = renderPipeline("closed");
    expect(result).toContain("● discuss");
    expect(result).toContain("**▶ closed**");
    expect(result).not.toContain("○");
  });
});

describe("formatDuration", () => {
  it("formats < 60 minutes as Xm", () => {
    expect(formatDuration(30 * 60_000)).toBe("30m");
  });

  it("formats >= 60m and < 24h as Xh Ym", () => {
    expect(formatDuration(90 * 60_000)).toBe("1h 30m");
  });

  it("formats >= 24h as Xd Yh", () => {
    expect(formatDuration(26 * 60 * 60_000)).toBe("1d 2h");
  });

  it("formats 0ms as 0m", () => {
    expect(formatDuration(0)).toBe("0m");
  });

  it("formats exactly 60m as 1h 0m", () => {
    expect(formatDuration(60 * 60_000)).toBe("1h 0m");
  });

  it("formats exactly 24h as 1d 0h", () => {
    expect(formatDuration(24 * 60 * 60_000)).toBe("1d 0h");
  });
});

describe("renderMetadata", () => {
  it("shows phase name and duration", () => {
    const result = renderMetadata("planning", 90 * 60_000, {
      specPath: "/path/to/spec",
      planPath: null,
      researchPath: null,
    });
    expect(result).toContain("**Phase:** planning (1h 30m)");
  });

  it("shows ✓ for existing artifacts and … for missing", () => {
    const result = renderMetadata("executing", 0, {
      specPath: "/path",
      planPath: "/path",
      researchPath: null,
    });
    expect(result).toContain("SPEC.md ✓");
    expect(result).toContain("PLAN.md ✓");
    expect(result).toContain("RESEARCH.md …");
  });

  it("shows all … when no artifacts exist", () => {
    const result = renderMetadata("discussing", 0, {
      specPath: null,
      planPath: null,
      researchPath: null,
    });
    expect(result).toContain("SPEC.md …");
    expect(result).toContain("PLAN.md …");
    expect(result).toContain("RESEARCH.md …");
  });
});

describe("buildWorkflowMarkdown", () => {
  it("renders pipeline and metadata for each active slice", () => {
    const snapshot: OverlayProjectSnapshot = {
      project: { name: "Test" },
      milestone: { label: "M01", title: "First" },
      slices: [
        {
          label: "M01-S01", title: "Slice A", status: "planning" as SliceStatus,
          complexity: "F-lite", specPath: "/spec", planPath: null, researchPath: "/research",
          updatedAt: new Date(Date.now() - 90 * 60_000),
        },
        {
          label: "M01-S02", title: "Slice B", status: "closed" as SliceStatus,
          complexity: "S", specPath: "/spec", planPath: "/plan", researchPath: null,
          updatedAt: new Date(Date.now() - 60_000),
        },
      ],
      taskCounts: new Map(),
    };
    const md = buildWorkflowMarkdown(snapshot);
    expect(md).toContain("M01-S01");
    expect(md).toContain("Slice A");
    expect(md).toContain("**▶ plan**");
    expect(md).toContain("SPEC.md ✓");
    expect(md).toContain("RESEARCH.md ✓");
    expect(md).toContain("PLAN.md …");
    expect(md).not.toContain("M01-S02");
  });

  it("shows fallback when no active slices", () => {
    const snapshot: OverlayProjectSnapshot = {
      project: { name: "Test" },
      milestone: { label: "M01", title: "First" },
      slices: [
        {
          label: "M01-S01", title: "Done", status: "closed" as SliceStatus,
          complexity: null, specPath: null, planPath: null, researchPath: null,
          updatedAt: new Date(),
        },
      ],
      taskCounts: new Map(),
    };
    const md = buildWorkflowMarkdown(snapshot);
    expect(md).toContain("All slices closed");
  });

  it("shows fallback when no milestone", () => {
    const snapshot: OverlayProjectSnapshot = {
      project: { name: "Test" },
      milestone: null,
      slices: [],
      taskCounts: new Map(),
    };
    const md = buildWorkflowMarkdown(snapshot);
    expect(md).toContain("No active milestone");
  });

  it("shows fallback when no project", () => {
    const snapshot: OverlayProjectSnapshot = {
      project: null,
      milestone: null,
      slices: [],
      taskCounts: new Map(),
    };
    const md = buildWorkflowMarkdown(snapshot);
    expect(md).toContain("No project data");
  });

  it("omits separator for single active slice", () => {
    const snapshot: OverlayProjectSnapshot = {
      project: { name: "Test" },
      milestone: { label: "M01", title: "First" },
      slices: [
        {
          label: "M01-S01", title: "Only", status: "executing" as SliceStatus,
          complexity: null, specPath: null, planPath: null, researchPath: null,
          updatedAt: new Date(),
        },
      ],
      taskCounts: new Map(),
    };
    const md = buildWorkflowMarkdown(snapshot);
    expect(md).toContain("**▶ execute**");
    expect(md).not.toContain("───");
  });

  it("sorts active slices by updatedAt descending", () => {
    const now = Date.now();
    const snapshot: OverlayProjectSnapshot = {
      project: { name: "Test" },
      milestone: { label: "M01", title: "First" },
      slices: [
        {
          label: "M01-S01", title: "Older", status: "discussing" as SliceStatus,
          complexity: null, specPath: null, planPath: null, researchPath: null,
          updatedAt: new Date(now - 120_000),
        },
        {
          label: "M01-S02", title: "Newer", status: "planning" as SliceStatus,
          complexity: null, specPath: null, planPath: null, researchPath: null,
          updatedAt: new Date(now - 10_000),
        },
      ],
      taskCounts: new Map(),
    };
    const md = buildWorkflowMarkdown(snapshot);
    const idx1 = md.indexOf("Newer");
    const idx2 = md.indexOf("Older");
    expect(idx1).toBeLessThan(idx2);
  });

  it("includes complexity tier in header when available", () => {
    const snapshot: OverlayProjectSnapshot = {
      project: { name: "Test" },
      milestone: { label: "M01", title: "First" },
      slices: [
        {
          label: "M01-S01", title: "Slice A", status: "executing" as SliceStatus,
          complexity: "F-lite", specPath: null, planPath: null, researchPath: null,
          updatedAt: new Date(),
        },
      ],
      taskCounts: new Map(),
    };
    const md = buildWorkflowMarkdown(snapshot);
    expect(md).toContain("(F-lite)");
  });
});

describe("WorkflowComponent", () => {
  let tui: ReturnType<typeof mockTui>;
  let overlayData: OverlayDataPort;
  let theme: MarkdownTheme;

  beforeEach(() => {
    tui = mockTui();
    overlayData = mockOverlayDataPort();
    theme = identityTheme();
  });

  it("refresh() queries port, updates markdown, triggers render", async () => {
    const snapshot: OverlayProjectSnapshot = {
      project: { name: "Test" },
      milestone: { label: "M01", title: "First" },
      slices: [
        {
          label: "M01-S01", title: "Active", status: "executing" as SliceStatus,
          complexity: null, specPath: null, planPath: null, researchPath: null,
          updatedAt: new Date(),
        },
      ],
      taskCounts: new Map(),
    };
    (overlayData.getProjectSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue(ok(snapshot));
    const component = new WorkflowComponent(tui as unknown as TUI, overlayData, theme, 1, 0);
    await component.refresh();
    expect(overlayData.getProjectSnapshot).toHaveBeenCalled();
    expect(tui.requestRender).toHaveBeenCalled();
  });

  it("render() returns string[] containing pipeline content", async () => {
    const snapshot: OverlayProjectSnapshot = {
      project: { name: "Test" },
      milestone: { label: "M01", title: "First" },
      slices: [
        {
          label: "M01-S01", title: "Active", status: "planning" as SliceStatus,
          complexity: null, specPath: "/spec", planPath: null, researchPath: null,
          updatedAt: new Date(),
        },
      ],
      taskCounts: new Map(),
    };
    (overlayData.getProjectSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue(ok(snapshot));
    const component = new WorkflowComponent(tui as unknown as TUI, overlayData, theme, 1, 0);
    await component.refresh();
    const lines = component.render(80);
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("render() shows loading text before refresh", () => {
    (overlayData.getProjectSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue(new Promise(() => {}));
    const component = new WorkflowComponent(tui as unknown as TUI, overlayData, theme, 1, 0);
    const lines = component.render(80);
    expect(lines.join("\n")).toContain("Loading");
  });

  it("handles port error gracefully", async () => {
    (overlayData.getProjectSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue(err(new Error("fail")));
    const component = new WorkflowComponent(tui as unknown as TUI, overlayData, theme, 1, 0);
    await component.refresh();
    expect(tui.requestRender).toHaveBeenCalled();
    const lines = component.render(80);
    expect(lines.join("\n")).toContain("No project data");
  });

  it("invalidate() delegates to internal markdown", () => {
    (overlayData.getProjectSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue(new Promise(() => {}));
    const component = new WorkflowComponent(tui as unknown as TUI, overlayData, theme, 1, 0);
    expect(() => component.invalidate()).not.toThrow();
  });
});
