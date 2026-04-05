import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@infrastructure/pi";
import { isErr } from "@kernel";
import type { GetStatusUseCase, StatusReport } from "../../use-cases/get-status.use-case";

export interface ProgressCommandDeps {
  getStatus: GetStatusUseCase;
  tffDir: string;
}

export function formatDashboard(report: StatusReport): string {
  const ms = report.activeMilestone;
  const title = ms ? `${ms.label}: ${ms.title}` : "No active milestone";

  let md = `# State — ${title}\n\n`;
  md += `## Progress\n`;
  md += `- Slices: ${report.totals.completedSlices}/${report.totals.totalSlices} completed\n`;
  md += `- Tasks: ${report.totals.completedTasks}/${report.totals.totalTasks} completed\n\n`;
  md += `## Slices\n`;
  md += `| Slice | Status | Tasks | Progress |\n`;
  md += `|---|---|---|---|\n`;

  for (const s of report.slices) {
    const pct = s.taskCount > 0 ? Math.round((s.completedTaskCount / s.taskCount) * 100) : 0;
    md += `| ${s.title} | ${s.status} | ${s.completedTaskCount}/${s.taskCount} | ${pct}% |\n`;
  }

  return md;
}

export function registerProgressCommand(api: ExtensionAPI, deps: ProgressCommandDeps): void {
  api.registerCommand("tff:progress", {
    description: "Show project dashboard and auto-fix STATE.md",
    handler: async () => {
      const result = await deps.getStatus.execute();
      if (isErr(result)) {
        api.sendUserMessage(`Error: ${result.error.message}`);
        return;
      }

      const dashboard = formatDashboard(result.data);

      const statePath = join(deps.tffDir, "STATE.md");
      let wasStale = false;
      try {
        const existing = readFileSync(statePath, "utf-8");
        if (existing !== dashboard) {
          writeFileSync(statePath, dashboard, "utf-8");
          wasStale = true;
        }
      } catch {
        writeFileSync(statePath, dashboard, "utf-8");
        wasStale = true;
      }

      const status = wasStale ? "\n\nSTATE.md: auto-fixed — was stale" : "\n\nSTATE.md: up-to-date";
      api.sendUserMessage(dashboard + status);
    },
  });
}
