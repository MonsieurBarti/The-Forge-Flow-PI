import type { Component, TUI } from "@mariozechner/pi-tui";
import { Markdown } from "@mariozechner/pi-tui";
import type { MarkdownTheme } from "@mariozechner/pi-tui";
import type { OverlayDataPort, OverlayProjectSnapshot } from "@kernel/ports/overlay-data.port";
import type { BudgetTrackingPort } from "@hexagons/settings/domain/ports/budget-tracking.port";
import type { SliceStatus } from "@hexagons/slice/domain/slice.schemas";

// --- Exported helpers ---

export const NEXT_ACTION: Record<SliceStatus, { cmd: string; desc: string }> = {
  discussing: { cmd: "/tff:research", desc: "Research the current slice" },
  researching: { cmd: "/tff:plan", desc: "Plan the current slice" },
  planning: { cmd: "/tff:execute", desc: "Execute the current slice" },
  executing: { cmd: "/tff:verify", desc: "Verify acceptance criteria" },
  verifying: { cmd: "/tff:ship", desc: "Ship the slice PR" },
  reviewing: { cmd: "/tff:ship", desc: "Complete the review" },
  completing: { cmd: "/tff:complete-milestone", desc: "Complete the milestone" },
  closed: { cmd: "/tff:status", desc: "All slices closed" },
};

export function progressBar(percent: number, width = 16): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  const displayPercent = Math.max(0, Math.min(100, Math.round(percent)));
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${displayPercent}%`;
}

export function buildMarkdown(snapshot: OverlayProjectSnapshot, budgetPercent: number): string {
  const project = snapshot.project as { name: string } | null;
  const milestone = snapshot.milestone as { label: string; title: string } | null;
  const slices = snapshot.slices as Array<{
    id?: string;
    label: string;
    title: string;
    status: SliceStatus;
    complexity: string | null;
  }>;

  if (!project) {
    return "# No project data\n\nRun `/tff:new` to initialize a project.";
  }

  // Compute totals
  let totalDone = 0;
  let totalAll = 0;
  for (const [, counts] of snapshot.taskCounts) {
    totalDone += counts.done;
    totalAll += counts.total;
  }

  const milestoneLabel = milestone?.label ?? "—";
  const milestoneTitle = milestone?.title ?? "Unknown milestone";
  const milestonePercent = totalAll > 0 ? Math.round((totalDone / totalAll) * 100) : 0;

  // Build slice table rows
  const tableRows = slices.map((s) => {
    const sliceId = (s as { id?: string }).id;
    const counts = sliceId ? snapshot.taskCounts.get(sliceId) : undefined;
    const taskStr = counts ? `${counts.done}/${counts.total}` : "—";
    return `| ${s.label} | ${s.status} | ${taskStr} | ${s.complexity ?? "—"} |`;
  });

  // Next action heuristic
  const activeSlice = slices.find((s) => s.status !== "closed");
  const nextAction = activeSlice
    ? NEXT_ACTION[activeSlice.status]
    : NEXT_ACTION.completing;

  const lines = [
    `# ${project.name}`,
    "",
    `## ${milestoneLabel} — ${milestoneTitle}  ${progressBar(milestonePercent)} ${totalDone}/${totalAll} tasks`,
    "",
    "| Slice | Phase | Tasks | Complexity |",
    "|-------|-------|-------|------------|",
    ...tableRows,
    "",
    `**Budget:** ${progressBar(budgetPercent)} ${budgetPercent}%`,
    "",
    `**Next:** \`${nextAction.cmd}\` — ${nextAction.desc}`,
  ];

  return lines.join("\n");
}

// --- Component class ---

export class DashboardComponent implements Component {
  private readonly markdown: Markdown;
  private readonly tui: TUI;
  private readonly overlayData: OverlayDataPort;
  private readonly budgetTracking: BudgetTrackingPort;

  private snapshot: OverlayProjectSnapshot | null = null;
  private budgetPercent = 0;

  constructor(
    tui: TUI,
    overlayData: OverlayDataPort,
    budgetTracking: BudgetTrackingPort,
    markdownTheme: MarkdownTheme,
    paddingX: number,
    paddingY: number,
  ) {
    this.tui = tui;
    this.overlayData = overlayData;
    this.budgetTracking = budgetTracking;
    this.markdown = new Markdown("Loading dashboard...", paddingX, paddingY, markdownTheme);

    // Fire-and-forget initial load
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const [snapshotResult, budgetResult] = await Promise.all([
      this.overlayData.getProjectSnapshot(),
      this.budgetTracking.getUsagePercent(),
    ]);

    if (snapshotResult.ok) {
      this.snapshot = snapshotResult.data;
    } else {
      this.snapshot = null;
    }

    if (budgetResult.ok) {
      this.budgetPercent = budgetResult.data;
    }

    const fallbackSnapshot: OverlayProjectSnapshot = {
      project: null,
      milestone: null,
      slices: [],
      taskCounts: new Map(),
    };

    const md = buildMarkdown(this.snapshot ?? fallbackSnapshot, this.budgetPercent);
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
