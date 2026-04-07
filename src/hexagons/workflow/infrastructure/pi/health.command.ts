import type { ExtensionAPI, ExtensionCommandContext } from "@infrastructure/pi";
import type { HealthCheckReport, HealthCheckService } from "@kernel/services/health-check.service";
import type { TffDispatcher } from "../../../../cli/tff-dispatcher";

export interface HealthCommandDeps {
  healthCheck: HealthCheckService;
  tffDir: string;
}

export function formatHealthReport(report: HealthCheckReport): string {
  const lines: string[] = [];
  lines.push("## TFF Health Check");
  lines.push("");

  if (report.fixed.length > 0) {
    lines.push("### Fixed");
    for (const item of report.fixed) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  if (report.warnings.length > 0) {
    lines.push("### Warnings");
    for (const warning of report.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push("");
  }

  if (report.driftDetails.length > 0) {
    lines.push("### Journal / SQLite Drift");
    lines.push("");
    lines.push("| Slice | Journal Completed | SQLite Completed |");
    lines.push("|---|---|---|");
    for (const d of report.driftDetails) {
      lines.push(`| ${d.sliceLabel} | ${d.journalCompleted} | ${d.sqliteCompleted} |`);
    }
    lines.push("");
  }

  const totalIssues = report.warnings.length + report.driftDetails.length;
  if (totalIssues === 0 && report.fixed.length === 0) {
    lines.push("No issues found.");
  } else if (totalIssues === 0) {
    lines.push("All fixes applied. No remaining issues.");
  } else {
    lines.push(`${totalIssues} issue(s) detected.`);
  }

  return lines.join("\n");
}

export function registerHealthCommand(
  dispatcher: TffDispatcher,
  api: ExtensionAPI,
  deps: HealthCommandDeps,
): void {
  dispatcher.register({
    name: "health",
    description: "Run state consistency checks",
    handler: async (_args: string, _ctx: ExtensionCommandContext) => {
      const result = await deps.healthCheck.runAll(deps.tffDir);
      if (!result.ok) {
        api.sendUserMessage(`Health check failed: ${result.error.message}`);
        return;
      }
      api.sendUserMessage(formatHealthReport(result.data));
    },
  });
}
