import type { ExtensionAPI } from "@infrastructure/pi";
import { createZodTool } from "@infrastructure/pi";
import { ProjectRepositoryPort } from "@hexagons/project";
import { MilestoneRepositoryPort } from "@hexagons/milestone";
import { SliceRepositoryPort } from "@hexagons/slice";
import { TaskRepositoryPort } from "@hexagons/task";
import { GetStatusUseCase, type StatusReport } from "../../use-cases/get-status.use-case";
import { z } from "zod";

export interface WorkflowExtensionDeps {
  projectRepo: ProjectRepositoryPort;
  milestoneRepo: MilestoneRepositoryPort;
  sliceRepo: SliceRepositoryPort;
  taskRepo: TaskRepositoryPort;
}

function formatStatusReport(report: StatusReport): string {
  const lines: string[] = [];

  if (!report.project) {
    lines.push("No TFF project found. Run /tff:new to initialize.");
    return lines.join("\n");
  }

  lines.push(`# ${report.project.name}`);
  lines.push(`Vision: ${report.project.vision}`);
  lines.push("");

  if (!report.activeMilestone) {
    lines.push("No active milestone. Run /tff:new-milestone to create one.");
    return lines.join("\n");
  }

  const ms = report.activeMilestone;
  lines.push(`## ${ms.label}: ${ms.title} (${ms.status})`);
  lines.push("");

  if (report.slices.length > 0) {
    lines.push("| Slice | Status | Tasks |");
    lines.push("|---|---|---|");
    for (const s of report.slices) {
      lines.push(`| ${s.label}: ${s.title} | ${s.status} | ${s.completedTaskCount}/${s.taskCount} |`);
    }
    lines.push("");
  }

  const t = report.totals;
  lines.push(`Slices: ${t.completedSlices}/${t.totalSlices} | Tasks: ${t.completedTasks}/${t.totalTasks}`);
  return lines.join("\n");
}

export function registerWorkflowExtension(
  api: ExtensionAPI,
  deps: WorkflowExtensionDeps,
): void {
  const useCase = new GetStatusUseCase(
    deps.projectRepo,
    deps.milestoneRepo,
    deps.sliceRepo,
    deps.taskRepo,
  );

  api.registerCommand("tff:status", {
    description: "Show current TFF project status",
    handler: async (_args, ctx) => {
      ctx.sendUserMessage("Fetching project status...");
    },
  });

  api.registerTool(
    createZodTool({
      name: "tff_status",
      label: "TFF Project Status",
      description:
        "Show project status including milestone progress, slice states, and task counts",
      schema: z.object({}),
      execute: async () => {
        const result = await useCase.execute();
        if (!result.ok) {
          return {
            content: [{ type: "text", text: `Status failed: ${result.error.message}` }],
          };
        }
        return {
          content: [{ type: "text", text: formatStatusReport(result.data) }],
        };
      },
    }),
  );
}
