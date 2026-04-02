import type { MergeSettingsUseCase } from "@hexagons/settings";
import type { ExtensionAPI } from "@infrastructure/pi";
import { createZodTool } from "@infrastructure/pi";
import type { DateProviderPort, EventBusPort } from "@kernel";
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
}

export function registerProjectExtension(api: ExtensionAPI, deps: ProjectExtensionDeps): void {
  api.registerCommand("tff:new", {
    description: "Initialize a new TFF project in the current directory",
    handler: async (_args, ctx) => {
      api.sendUserMessage(
        "I'll initialize a TFF project. Please provide a project name and vision, then I'll call the tff_init_project tool.",
      );
    },
  });

  api.registerTool(
    createZodTool({
      name: "tff_init_project",
      label: "Initialize TFF Project",
      description:
        "Create .tff/ directory structure, PROJECT.md, settings.yaml, and Project aggregate",
      schema: InitProjectParamsSchema,
      execute: async (params) => {
        const useCase = new InitProjectUseCase(
          deps.projectRepo,
          deps.projectFs,
          deps.mergeSettings,
          deps.eventBus,
          deps.dateProvider,
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
              text: `Project "${params.name}" initialized at ${params.projectRoot}/.tff/`,
            },
          ],
          details: undefined,
        };
      },
    }),
  );
}
