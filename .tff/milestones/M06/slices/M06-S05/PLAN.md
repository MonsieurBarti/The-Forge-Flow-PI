# M06-S05: Workflow Visualizer Overlay — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Persistent TUI overlay showing the FSM pipeline for all active slices in the current milestone. Phase indicators, metadata (time in phase, artifact status), event-driven refresh.

**Architecture:** `WorkflowComponent` implements `Component` from pi-tui, delegates rendering to internal `Markdown` component. Wired into `overlay.extension.ts` following the `DashboardComponent` pattern.

**Tech Stack:** TypeScript, Vitest, pi-tui (`Markdown`, `Component`), `OverlayDataPort`

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/cli/components/workflow.component.ts` | Create | WorkflowComponent + helpers |
| `src/cli/components/workflow.component.spec.ts` | Create | Unit tests |
| `src/cli/overlay.extension.ts` | Modify | Replace placeholder, wire events |
| `src/cli/overlay.extension.spec.ts` | Modify | Update assertions |

---

### Task 1: Pipeline rendering helpers
**Files:** Create `src/cli/components/workflow.component.ts`
**Traces to:** AC1, AC2

Pure functions — no component class yet.

- [ ] Step 1: Write failing tests for `PHASE_ORDER`, `PHASE_DISPLAY_NAMES`, and `renderPipeline()`

  ```typescript
  // src/cli/components/workflow.component.spec.ts
  import { describe, expect, it } from "vitest";
  import {
    PHASE_ORDER,
    PHASE_DISPLAY_NAMES,
    renderPipeline,
  } from "./workflow.component";

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
  ```

- [ ] Step 2: Run `npx vitest run src/cli/components/workflow.component.spec.ts`, verify FAIL (module not found)

- [ ] Step 3: Implement `PHASE_ORDER`, `PHASE_DISPLAY_NAMES`, and `renderPipeline()`

  ```typescript
  // src/cli/components/workflow.component.ts
  import type { SliceStatus } from "@hexagons/slice/domain/slice.schemas";

  export const PHASE_ORDER: SliceStatus[] = [
    "discussing", "researching", "planning", "executing",
    "verifying", "reviewing", "completing", "closed",
  ];

  export const PHASE_DISPLAY_NAMES: Record<SliceStatus, string> = {
    discussing: "discuss",
    researching: "research",
    planning: "plan",
    executing: "execute",
    verifying: "verify",
    reviewing: "review",
    completing: "ship",
    closed: "closed",
  };

  export function renderPipeline(currentStatus: SliceStatus): string {
    const currentIndex = PHASE_ORDER.indexOf(currentStatus);
    const parts = PHASE_ORDER.map((phase, i) => {
      const name = PHASE_DISPLAY_NAMES[phase];
      if (i < currentIndex) return `● ${name}`;
      if (i === currentIndex) return `**▶ ${name}**`;
      return `○ ${name}`;
    });
    return parts.join(" ── ");
  }
  ```

- [ ] Step 4: Run `npx vitest run src/cli/components/workflow.component.spec.ts`, verify PASS
- [ ] Step 5: `git add src/cli/components/workflow.component.ts src/cli/components/workflow.component.spec.ts && git commit -m "feat(S05/T01): pipeline rendering helpers — PHASE_ORDER, PHASE_DISPLAY_NAMES, renderPipeline()"`

---

### Task 2: Metadata helpers (formatDuration + artifact status)
**Files:** Modify `src/cli/components/workflow.component.ts`
**Traces to:** AC3, AC4

- [ ] Step 1: Write failing tests for `formatDuration()` and `renderMetadata()`

  ```typescript
  // Add to workflow.component.spec.ts
  import { formatDuration, renderMetadata } from "./workflow.component";

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
  ```

- [ ] Step 2: Run `npx vitest run src/cli/components/workflow.component.spec.ts`, verify FAIL

- [ ] Step 3: Implement `formatDuration()` and `renderMetadata()`

  ```typescript
  // Add to workflow.component.ts

  export function formatDuration(ms: number): string {
    const totalMinutes = Math.floor(ms / 60_000);
    const totalHours = Math.floor(totalMinutes / 60);
    const totalDays = Math.floor(totalHours / 24);

    if (totalMinutes < 60) return `${totalMinutes}m`;
    if (totalHours < 24) return `${totalHours}h ${totalMinutes % 60}m`;
    return `${totalDays}d ${totalHours % 24}h`;
  }

  export function renderMetadata(
    status: SliceStatus,
    durationMs: number,
    artifacts: { specPath: string | null; planPath: string | null; researchPath: string | null },
  ): string {
    const spec = artifacts.specPath ? "SPEC.md ✓" : "SPEC.md …";
    const plan = artifacts.planPath ? "PLAN.md ✓" : "PLAN.md …";
    const research = artifacts.researchPath ? "RESEARCH.md ✓" : "RESEARCH.md …";

    return [
      `**Phase:** ${status} (${formatDuration(durationMs)})`,
      `**Artifacts:** ${spec}  ${plan}  ${research}`,
    ].join("\n");
  }
  ```

- [ ] Step 4: Run `npx vitest run src/cli/components/workflow.component.spec.ts`, verify PASS
- [ ] Step 5: `git add src/cli/components/workflow.component.ts src/cli/components/workflow.component.spec.ts && git commit -m "feat(S05/T02): metadata helpers — formatDuration() and renderMetadata()"`

---

### Task 3: buildWorkflowMarkdown + WorkflowComponent class
**Files:** Modify `src/cli/components/workflow.component.ts`, `src/cli/components/workflow.component.spec.ts`
**Traces to:** AC1, AC3, AC4, AC5, AC8

- [ ] Step 1: Write failing tests for `buildWorkflowMarkdown()` and `WorkflowComponent`

  ```typescript
  // Add to workflow.component.spec.ts
  import { vi, beforeEach } from "vitest";
  import type { TUI } from "@mariozechner/pi-tui";
  import type { MarkdownTheme } from "@mariozechner/pi-tui";
  import type { OverlayDataPort, OverlayProjectSnapshot } from "@kernel/ports/overlay-data.port";
  import { ok, err } from "@kernel/result";
  import { buildWorkflowMarkdown, WorkflowComponent } from "./workflow.component";

  // Reuse identityTheme, mockTui, mockOverlayDataPort from dashboard.component.spec.ts pattern

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

  describe("buildWorkflowMarkdown", () => {
    it("renders pipeline and metadata for each active slice", () => {
      const snapshot: OverlayProjectSnapshot = {
        project: { name: "Test" },
        milestone: { label: "M01", title: "First" },
        slices: [
          { label: "M01-S01", title: "Slice A", status: "planning", complexity: "F-lite",
            specPath: "/spec", planPath: null, researchPath: "/research",
            updatedAt: new Date(Date.now() - 90 * 60_000) },
          { label: "M01-S02", title: "Slice B", status: "closed", complexity: "S",
            specPath: "/spec", planPath: "/plan", researchPath: null,
            updatedAt: new Date(Date.now() - 60_000) },
        ],
        taskCounts: new Map(),
      };
      const md = buildWorkflowMarkdown(snapshot);
      // Should include active slice A but not closed slice B
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
          { label: "M01-S01", title: "Done", status: "closed", complexity: null,
            specPath: null, planPath: null, researchPath: null,
            updatedAt: new Date() },
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
          { label: "M01-S01", title: "Only", status: "executing", complexity: null,
            specPath: null, planPath: null, researchPath: null,
            updatedAt: new Date() },
        ],
        taskCounts: new Map(),
      };
      const md = buildWorkflowMarkdown(snapshot);
      expect(md).toContain("**▶ execute**");
      // No horizontal rule separator for single slice
      expect(md).not.toContain("───");
    });

    it("sorts active slices by updatedAt descending", () => {
      const now = Date.now();
      const snapshot: OverlayProjectSnapshot = {
        project: { name: "Test" },
        milestone: { label: "M01", title: "First" },
        slices: [
          { label: "M01-S01", title: "Older", status: "discussing", complexity: null,
            specPath: null, planPath: null, researchPath: null,
            updatedAt: new Date(now - 120_000) },
          { label: "M01-S02", title: "Newer", status: "planning", complexity: null,
            specPath: null, planPath: null, researchPath: null,
            updatedAt: new Date(now - 10_000) },
        ],
        taskCounts: new Map(),
      };
      const md = buildWorkflowMarkdown(snapshot);
      const idx1 = md.indexOf("Newer");
      const idx2 = md.indexOf("Older");
      expect(idx1).toBeLessThan(idx2);
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
          { label: "M01-S01", title: "Active", status: "executing", complexity: null,
            specPath: null, planPath: null, researchPath: null,
            updatedAt: new Date() },
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
          { label: "M01-S01", title: "Active", status: "planning", complexity: null,
            specPath: "/spec", planPath: null, researchPath: null,
            updatedAt: new Date() },
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
  });
  ```

- [ ] Step 2: Run `npx vitest run src/cli/components/workflow.component.spec.ts`, verify FAIL

- [ ] Step 3: Implement `buildWorkflowMarkdown()` and `WorkflowComponent`

  **Important:** Merge these imports with the existing `SliceStatus` import from Task 1. The complete import block at the top of `workflow.component.ts` should be:

  ```typescript
  // workflow.component.ts — complete import block (replaces existing imports)
  import type { Component, TUI } from "@mariozechner/pi-tui";
  import { Markdown } from "@mariozechner/pi-tui";
  import type { MarkdownTheme } from "@mariozechner/pi-tui";
  import type { OverlayDataPort, OverlayProjectSnapshot } from "@kernel/ports/overlay-data.port";
  import type { SliceStatus } from "@hexagons/slice/domain/slice.schemas";
  ```

  Then add below the existing helpers:

  ```typescript
  interface WorkflowSlice {
    label: string;
    title: string;
    status: SliceStatus;
    complexity: string | null;
    specPath: string | null;
    planPath: string | null;
    researchPath: string | null;
    updatedAt: Date;
  }

  export function buildWorkflowMarkdown(snapshot: OverlayProjectSnapshot): string {
    const project = snapshot.project as { name: string } | null;
    if (!project) return "# No project data\n\nRun `/tff:new` to initialize a project.";
    if (!snapshot.milestone) return "# No active milestone\n\nRun `/tff:new-milestone` to start a new milestone.";

    const allSlices = snapshot.slices as WorkflowSlice[];
    const active = allSlices
      .filter((s) => s.status !== "closed")
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    if (active.length === 0) {
      return "# All slices closed\n\nRun `/tff:status` for overview.";
    }

    const blocks = active.map((slice) => {
      const tierSuffix = slice.complexity ? ` (${slice.complexity})` : "";
      const header = `**${slice.label} — ${slice.title}${tierSuffix}**`;
      const pipeline = renderPipeline(slice.status);
      const durationMs = Date.now() - new Date(slice.updatedAt).getTime();
      const metadata = renderMetadata(slice.status, durationMs, slice);
      return [header, "", pipeline, "", metadata].join("\n");
    });

    if (active.length === 1) {
      return blocks[0];
    }

    return blocks.join("\n\n───\n\n");
  }

  export class WorkflowComponent implements Component {
    private readonly markdown: Markdown;
    private readonly tui: TUI;
    private readonly overlayData: OverlayDataPort;

    constructor(
      tui: TUI,
      overlayData: OverlayDataPort,
      markdownTheme: MarkdownTheme,
      paddingX: number,
      paddingY: number,
    ) {
      this.tui = tui;
      this.overlayData = overlayData;
      this.markdown = new Markdown("Loading workflow...", paddingX, paddingY, markdownTheme);
      void this.refresh();
    }

    async refresh(): Promise<void> {
      const result = await this.overlayData.getProjectSnapshot();
      const fallback: OverlayProjectSnapshot = {
        project: null, milestone: null, slices: [], taskCounts: new Map(),
      };
      const snapshot = result.ok ? result.data : fallback;
      const md = buildWorkflowMarkdown(snapshot);
      this.markdown.setText(md);
      this.markdown.invalidate();
      this.tui.requestRender();
    }

    invalidate(): void {
      this.markdown.invalidate();
    }

    render(width: number): string[] {
      return this.markdown.render(width);
    }
  }
  ```

- [ ] Step 4: Run `npx vitest run src/cli/components/workflow.component.spec.ts`, verify PASS
- [ ] Step 5: `git add src/cli/components/workflow.component.ts src/cli/components/workflow.component.spec.ts && git commit -m "feat(S05/T03): WorkflowComponent class + buildWorkflowMarkdown()"`

---

### Task 4: Overlay extension integration + event subscriptions
**Files:** Modify `src/cli/overlay.extension.ts`, `src/cli/overlay.extension.spec.ts`
**Traces to:** AC6, AC7, AC8, AC9

- [ ] Step 1: Update existing test and add new test for workflow integration

  **Important:** The existing test `"registers 4 EventBus subscriptions with correct event names"` at line 184 of `overlay.extension.spec.ts` must be updated — change `toHaveBeenCalledTimes(4)` to `toHaveBeenCalledTimes(7)` since we're adding 3 workflow subscriptions. Also add `SLICE_CREATED` to the event name assertions.

  ```typescript
  // In overlay.extension.spec.ts — REPLACE the existing test at line 184-201:

  it("registers 7 EventBus subscriptions (4 dashboard + 3 workflow)", () => {
    const api = mockApi();
    const eventBus = mockEventBus();

    registerOverlayExtension(api, {
      overlayDataPort: mockOverlayDataPort(),
      budgetTrackingPort: { getUsagePercent: vi.fn() } as unknown as BudgetTrackingPort,
      eventBus,
      hotkeys: DEFAULT_HOTKEYS,
      logger: mockLogger(),
    });

    // Dashboard: SLICE_STATUS_CHANGED, TASK_COMPLETED, TASK_CREATED, MILESTONE_CLOSED
    // Workflow: SLICE_STATUS_CHANGED, SLICE_CREATED, MILESTONE_CLOSED
    expect(eventBus.subscribe).toHaveBeenCalledTimes(7);

    const subscribedEvents = [...eventBus.handlers.keys()];
    expect(subscribedEvents).toContain(EVENT_NAMES.SLICE_STATUS_CHANGED);
    expect(subscribedEvents).toContain(EVENT_NAMES.TASK_COMPLETED);
    expect(subscribedEvents).toContain(EVENT_NAMES.TASK_CREATED);
    expect(subscribedEvents).toContain(EVENT_NAMES.MILESTONE_CLOSED);
    expect(subscribedEvents).toContain(EVENT_NAMES.SLICE_CREATED);

    // SLICE_STATUS_CHANGED and MILESTONE_CLOSED should have 2 handlers each (dashboard + workflow)
    expect(eventBus.handlers.get(EVENT_NAMES.SLICE_STATUS_CHANGED)?.length).toBe(2);
    expect(eventBus.handlers.get(EVENT_NAMES.MILESTONE_CLOSED)?.length).toBe(2);
    expect(eventBus.handlers.get(EVENT_NAMES.SLICE_CREATED)?.length).toBe(1);
  });
  ```

- [ ] Step 2: Run `npx vitest run src/cli/overlay.extension.spec.ts`, verify FAIL (count is still 4, SLICE_CREATED not subscribed)

- [ ] Step 3: Implement workflow integration in `overlay.extension.ts`

  ```typescript
  // Add import at top of overlay.extension.ts (alongside existing imports):
  import { WorkflowComponent } from "./components/workflow.component";

  // Replace the workflow section (lines 109-121) with:

  // --- Workflow ---
  let workflowComponent: WorkflowComponent | undefined;

  const toggleWorkflow = async (ctx: ExtensionContext): Promise<void> => {
    if (!ctx.hasUI) return;
    if (workflowHandle) {
      workflowHandle.setHidden(!workflowHandle.isHidden());
    } else {
      void ctx.ui.custom(
        (tui, _theme, _kb, _done) => {
          workflowComponent = new WorkflowComponent(
            tui,
            deps.overlayDataPort,
            getMarkdownTheme(),
            2,
            1,
          );
          return workflowComponent;
        },
        {
          overlay: true,
          overlayOptions: { anchor: "center", width: "80%" },
          onHandle: (h) => {
            workflowHandle = h;
          },
        },
      );
    }
  };

  // After the existing DASHBOARD_EVENTS subscription block, add:

  const WORKFLOW_EVENTS: EventName[] = [
    EVENT_NAMES.SLICE_STATUS_CHANGED,
    EVENT_NAMES.SLICE_CREATED,
    EVENT_NAMES.MILESTONE_CLOSED,
  ];

  for (const eventName of WORKFLOW_EVENTS) {
    deps.eventBus.subscribe(eventName, async () => {
      if (workflowComponent) {
        await workflowComponent.refresh();
      }
    });
  }
  ```

- [ ] Step 4: Run `npx vitest run src/cli/overlay.extension.spec.ts`, verify PASS

- [ ] Step 5: Run full test suite `npx vitest run` to verify no regressions (AC9)

- [ ] Step 6: `git add src/cli/overlay.extension.ts src/cli/overlay.extension.spec.ts && git commit -m "feat(S05/T04): wire WorkflowComponent into overlay extension + event subscriptions"`
