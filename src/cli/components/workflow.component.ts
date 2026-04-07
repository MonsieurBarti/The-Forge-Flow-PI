import type { SliceStatus } from "@hexagons/slice/domain/slice.schemas";
import type { OverlayDataPort, OverlayProjectSnapshot } from "@kernel/ports/overlay-data.port";
import type { Component, MarkdownTheme, TUI } from "@mariozechner/pi-tui";
import { Markdown } from "@mariozechner/pi-tui";
import { PHASE_DISPLAY_NAMES, PHASE_ORDER } from "./slice-display.constants";

export { PHASE_DISPLAY_NAMES, PHASE_ORDER };

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
  artifacts: {
    specPath: string | null;
    planPath: string | null;
    researchPath: string | null;
  },
): string {
  const spec = artifacts.specPath ? "SPEC.md ✓" : "SPEC.md …";
  const plan = artifacts.planPath ? "PLAN.md ✓" : "PLAN.md …";
  const research = artifacts.researchPath ? "RESEARCH.md ✓" : "RESEARCH.md …";

  return [
    `**Phase:** ${status} (${formatDuration(durationMs)})`,
    `**Artifacts:** ${spec}  ${plan}  ${research}`,
  ].join("\n");
}

// --- buildWorkflowMarkdown ---

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
  if (!project) return "# No project data\n\nRun `/tff new` to initialize a project.";
  if (!snapshot.milestone)
    return "# No active milestone\n\nRun `/tff new-milestone` to start a new milestone.";

  const allSlices = snapshot.slices as WorkflowSlice[];
  const active = allSlices
    .filter((s) => s.status !== "closed")
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  if (active.length === 0) {
    return "# All slices closed\n\nRun `/tff status` for overview.";
  }

  const blocks = active.map((slice) => {
    const tierSuffix = slice.complexity ? ` (${slice.complexity})` : "";
    const header = `**${slice.label} — ${slice.title}${tierSuffix}**`;
    const pipeline = renderPipeline(slice.status);
    const durationMs = Date.now() - new Date(slice.updatedAt).getTime();
    const metadata = renderMetadata(slice.status, durationMs, slice);
    return [header, "", pipeline, "", metadata].join("\n");
  });

  if (active.length === 1) return blocks[0];
  return blocks.join("\n\n───\n\n");
}

// --- WorkflowComponent ---

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
      project: null,
      milestone: null,
      slices: [],
      taskCounts: new Map(),
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
