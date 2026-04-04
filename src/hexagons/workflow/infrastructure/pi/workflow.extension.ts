import type { MilestoneRepositoryPort } from "@hexagons/milestone";
import type { ProjectRepositoryPort } from "@hexagons/project";
import type { ReviewUIPort } from "@hexagons/review";
import type { SliceRepositoryPort } from "@hexagons/slice";
import type { CreateTasksPort, TaskRepositoryPort } from "@hexagons/task";
import type { ExtensionAPI } from "@infrastructure/pi";
import { createZodTool } from "@infrastructure/pi";
import type { DateProviderPort, EventBusPort } from "@kernel";
import { z } from "zod";
import type { NextStepSuggestionProps } from "../../domain/next-step-suggestion.vo";
import type { ArtifactFilePort } from "../../domain/ports/artifact-file.port";
import type { AutonomyModeProvider } from "../../domain/ports/autonomy-mode.provider";
import type { ContextStagingPort } from "../../domain/ports/context-staging.port";
import type { SliceTransitionPort } from "../../domain/ports/slice-transition.port";
import type { WorkflowSessionRepositoryPort } from "../../domain/ports/workflow-session.repository.port";
import { ClassifyComplexityUseCase } from "../../use-cases/classify-complexity.use-case";
import { GetStatusUseCase, type StatusReport } from "../../use-cases/get-status.use-case";
import { OrchestratePhaseTransitionUseCase } from "../../use-cases/orchestrate-phase-transition.use-case";
import { StartDiscussUseCase } from "../../use-cases/start-discuss.use-case";
import { SuggestNextStepUseCase } from "../../use-cases/suggest-next-step.use-case";
import { WritePlanUseCase } from "../../use-cases/write-plan.use-case";
import { WriteResearchUseCase } from "../../use-cases/write-research.use-case";
import { WriteSpecUseCase } from "../../use-cases/write-spec.use-case";
import { createClassifyComplexityTool } from "./classify-complexity.tool";
import { registerDiscussCommand } from "./discuss.command";
import { registerPlanCommand } from "./plan.command";
import { registerResearchCommand } from "./research.command";
import { createWorkflowTransitionTool } from "./workflow-transition.tool";
import { createWritePlanTool } from "./write-plan.tool";
import { createWriteResearchTool } from "./write-research.tool";
import { createWriteSpecTool } from "./write-spec.tool";

export interface WorkflowExtensionDeps {
  projectRepo: ProjectRepositoryPort;
  milestoneRepo: MilestoneRepositoryPort;
  sliceRepo: SliceRepositoryPort;
  taskRepo: TaskRepositoryPort;
  createTasksPort: CreateTasksPort;
  sliceTransitionPort: SliceTransitionPort;
  eventBus: EventBusPort;
  dateProvider: DateProviderPort;
  contextStaging: ContextStagingPort;
  artifactFile: ArtifactFilePort;
  workflowSessionRepo: WorkflowSessionRepositoryPort;
  autonomyModeProvider: AutonomyModeProvider;
  reviewUI: ReviewUIPort;
  maxRetries: number;
  resolveActiveTffDir?: (sliceId?: string) => Promise<string>;
  withGuard?: () => Promise<void>;
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
      lines.push(
        `| ${s.label}: ${s.title} | ${s.status} | ${s.completedTaskCount}/${s.taskCount} |`,
      );
    }
    lines.push("");
  }

  const t = report.totals;
  lines.push(
    `Slices: ${t.completedSlices}/${t.totalSlices} | Tasks: ${t.completedTasks}/${t.totalTasks}`,
  );
  return lines.join("\n");
}

export function registerWorkflowExtension(api: ExtensionAPI, deps: WorkflowExtensionDeps): void {
  // --- Status use case + tool ---
  const statusUseCase = new GetStatusUseCase(
    deps.projectRepo,
    deps.milestoneRepo,
    deps.sliceRepo,
    deps.taskRepo,
  );

  const suggestNextStep = new SuggestNextStepUseCase(deps.workflowSessionRepo, deps.sliceRepo);

  api.registerCommand("tff:status", {
    description: "Show current TFF project status",
    handler: async (_args, _ctx) => {
      await deps.withGuard?.();
      api.sendUserMessage("Fetching project status...");
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
        const result = await statusUseCase.execute();
        if (!result.ok) {
          return {
            content: [{ type: "text", text: `Status failed: ${result.error.message}` }],
            details: undefined,
          };
        }

        let nextStep: NextStepSuggestionProps | null = null;
        if (result.data.activeMilestone) {
          const msLabel = result.data.activeMilestone.label;
          const msResult = await deps.milestoneRepo.findByLabel(msLabel);
          if (msResult.ok && msResult.data) {
            const nsResult = await suggestNextStep.execute({
              milestoneId: msResult.data.id,
            });
            if (nsResult.ok) nextStep = nsResult.data;
          }
        }

        const report = formatStatusReport(result.data);
        const nextStepLine = nextStep ? `\n\n**Next step:** ${nextStep.displayText}` : "";
        const nextStepJson = `\n\n<next-step>${JSON.stringify(nextStep)}</next-step>`;

        return {
          content: [{ type: "text", text: report + nextStepLine + nextStepJson }],
          details: undefined,
        };
      },
    }),
  );

  // --- Discuss use cases ---
  const startDiscuss = new StartDiscussUseCase(
    deps.sliceRepo,
    deps.workflowSessionRepo,
    deps.eventBus,
    deps.dateProvider,
    deps.autonomyModeProvider,
  );
  const writeSpec = new WriteSpecUseCase(deps.artifactFile, deps.sliceRepo, deps.dateProvider);
  const classifyComplexity = new ClassifyComplexityUseCase(deps.sliceRepo, deps.dateProvider);
  const orchestratePhaseTransition = new OrchestratePhaseTransitionUseCase(
    deps.workflowSessionRepo,
    deps.sliceTransitionPort,
    deps.eventBus,
    deps.dateProvider,
  );

  // --- Discuss tools ---
  api.registerTool(createWriteSpecTool(writeSpec, deps.reviewUI));
  api.registerTool(createClassifyComplexityTool(classifyComplexity));
  api.registerTool(
    createWorkflowTransitionTool({
      orchestratePhaseTransition,
      sessionRepo: deps.workflowSessionRepo,
      sliceRepo: deps.sliceRepo,
      maxRetries: deps.maxRetries,
    }),
  );

  // --- Discuss command ---
  registerDiscussCommand(api, {
    startDiscuss,
    sliceRepo: deps.sliceRepo,
    milestoneRepo: deps.milestoneRepo,
    suggestNextStep,
    withGuard: deps.withGuard,
  });

  // --- Research use case + tool ---
  const writeResearch = new WriteResearchUseCase(
    deps.artifactFile,
    deps.sliceRepo,
    deps.dateProvider,
  );
  api.registerTool(createWriteResearchTool(writeResearch));

  // --- Research command ---
  registerResearchCommand(api, {
    sliceRepo: deps.sliceRepo,
    milestoneRepo: deps.milestoneRepo,
    sessionRepo: deps.workflowSessionRepo,
    artifactFile: deps.artifactFile,
    suggestNextStep,
    withGuard: deps.withGuard,
  });

  // --- Plan use case + tool ---
  const writePlan = new WritePlanUseCase(
    deps.artifactFile,
    deps.sliceRepo,
    deps.createTasksPort,
    deps.dateProvider,
  );
  api.registerTool(createWritePlanTool(writePlan, deps.reviewUI));

  // --- Plan command ---
  registerPlanCommand(api, {
    sliceRepo: deps.sliceRepo,
    milestoneRepo: deps.milestoneRepo,
    sessionRepo: deps.workflowSessionRepo,
    artifactFile: deps.artifactFile,
    suggestNextStep,
    withGuard: deps.withGuard,
  });
}
