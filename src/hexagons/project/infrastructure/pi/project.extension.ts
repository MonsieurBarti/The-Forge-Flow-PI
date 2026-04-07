import type { DiscoverStackUseCase, MergeSettingsUseCase } from "@hexagons/settings";
import type { ExtensionAPI } from "@infrastructure/pi";
import { createZodTool } from "@infrastructure/pi";
import type { DateProviderPort, EventBusPort } from "@kernel";
import type { GitHookPort } from "@kernel/ports/git-hook.port";
import type { ProjectFileSystemPort } from "../../domain/ports/project-filesystem.port";
import type { ProjectRepositoryPort } from "../../domain/ports/project-repository.port";
import { InitProjectParamsSchema, InitProjectUseCase } from "../../use-cases/init-project.use-case";

export interface ProjectExtensionDeps {
  projectRoot: string;
  projectRepo: ProjectRepositoryPort;
  projectFs: ProjectFileSystemPort;
  mergeSettings: MergeSettingsUseCase;
  eventBus: EventBusPort;
  dateProvider: DateProviderPort;
  gitHookPort?: GitHookPort;
  discoverStack?: DiscoverStackUseCase;
  withGuard?: () => Promise<void>;
  /** Called after init creates .tff/ — triggers lazy DB initialization. */
  onBeforeProjectSave?: () => void;
}

export function registerProjectExtension(api: ExtensionAPI, deps: ProjectExtensionDeps): void {
  api.registerCommand("tff:new", {
    description: "Initialize a new TFF project in the current directory",
    handler: async (_args, _ctx) => {
      // No withGuard here — this command creates the project, so there's nothing to guard yet.
      api.sendUserMessage(
        [
          "## New Project Workflow",
          "",
          "Follow these steps in order:",
          "",
          "**Step 1 — Understand the project**",
          "Ask the user about their project: what are they building? What's the tech stack?",
          "If there's existing code in the repo, read key files to understand the codebase.",
          "",
          "**Step 2 — Propose name and vision**",
          "Based on the discussion, propose a project name and a 1-2 sentence vision statement.",
          "Ask the user to confirm or adjust.",
          "",
          "**Step 3 — Initialize**",
          "Once confirmed, call `tff_init_project` with the approved name and vision.",
          "",
          "**Step 4 — Next**",
          "After init, suggest `/tff:new-milestone` to create the first milestone.",
          "Do NOT create milestones automatically — wait for the user to invoke the command.",
        ].join("\n"),
      );
    },
  });

  api.registerTool(
    createZodTool({
      name: "tff_init_project",
      label: "Initialize TFF Project",
      description:
        "Initialize a new The Forge Flow (TFF) project — creates .tff/ directory structure, PROJECT.md, settings.yaml, and Project aggregate. Artifacts (specs, plans, research) are Markdown files, not YAML.",
      schema: InitProjectParamsSchema,
      execute: async (params) => {
        const useCase = new InitProjectUseCase(
          deps.projectRepo,
          deps.projectFs,
          deps.mergeSettings,
          deps.eventBus,
          deps.dateProvider,
          deps.gitHookPort,
          deps.discoverStack,
          deps.onBeforeProjectSave,
        );
        const result = await useCase.execute(params);
        if (!result.ok) {
          return {
            content: [{ type: "text", text: `Init failed: ${result.error.message}` }],
            details: undefined,
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `Project "${params.name}" initialized at ${params.projectRoot}/.tff/\n\nNext step: run /tff:new-milestone to create your first milestone.`,
            },
          ],
          details: undefined,
        };
      },
    }),
  );
}
