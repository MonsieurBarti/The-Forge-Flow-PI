import type { DiscoverStackUseCase, MergeSettingsUseCase } from "@hexagons/settings";
import {
  type DateProviderPort,
  type EventBusPort,
  err,
  isErr,
  ok,
  type PersistenceError,
  type Result,
} from "@kernel";
import type { GitHookPort } from "@kernel/ports/git-hook.port";
import { stringify } from "yaml";
import { z } from "zod";
import { ProjectAlreadyExistsError } from "../domain/errors/project-already-exists.error";
import type { ProjectFileSystemPort } from "../domain/ports/project-filesystem.port";
import type { ProjectRepositoryPort } from "../domain/ports/project-repository.port";
import { Project } from "../domain/project.aggregate";
import type { ProjectDTO } from "../domain/project.schemas";

export const InitProjectParamsSchema = z.object({
  name: z.string().min(1),
  vision: z.string().min(1),
  projectRoot: z.string().min(1),
});
export type InitProjectParams = z.infer<typeof InitProjectParamsSchema>;

export type InitProjectError = ProjectAlreadyExistsError | PersistenceError;

export class InitProjectUseCase {
  constructor(
    private readonly projectRepo: ProjectRepositoryPort,
    private readonly projectFs: ProjectFileSystemPort,
    private readonly mergeSettings: MergeSettingsUseCase,
    private readonly eventBus: EventBusPort,
    private readonly dateProvider: DateProviderPort,
    private readonly gitHookPort?: GitHookPort,
    private readonly discoverStack?: DiscoverStackUseCase,
    private readonly onBeforeProjectSave?: () => void,
  ) {}

  async execute(params: InitProjectParams): Promise<Result<ProjectDTO, InitProjectError>> {
    const tffDir = `${params.projectRoot}/.tff`;

    // 1. Guard: project already exists
    const existsResult = await this.projectFs.exists(tffDir);
    if (isErr(existsResult)) return existsResult;
    if (existsResult.data) {
      return err(new ProjectAlreadyExistsError(params.projectRoot));
    }

    // 2. Create directory structure
    for (const dir of [`${tffDir}/milestones`, `${tffDir}/skills`, `${tffDir}/observations`]) {
      const mkdirResult = await this.projectFs.createDirectory(dir, {
        recursive: true,
      });
      if (isErr(mkdirResult)) return mkdirResult;
    }

    // 2b. Ensure .tff/ is in .gitignore
    const gitignorePath = `${params.projectRoot}/.gitignore`;
    const gitignoreExists = await this.projectFs.exists(gitignorePath);
    if (isErr(gitignoreExists)) return gitignoreExists;

    if (!gitignoreExists.data) {
      // Create .gitignore with .tff/ entry
      const writeGitignoreResult = await this.projectFs.writeFile(
        gitignorePath,
        ".tff/\n.tff.backup.*\n",
      );
      if (isErr(writeGitignoreResult)) return writeGitignoreResult;
    } else {
      // We can't append with the current port, but the health check will handle it on first run
      // The important case is when .gitignore doesn't exist at all
    }

    // 3. Write PROJECT.md
    const projectMd = `# ${params.name}\n\n${params.vision}\n`;
    const writeProjResult = await this.projectFs.writeFile(`${tffDir}/PROJECT.md`, projectMd);
    if (isErr(writeProjResult)) return writeProjResult;

    // 4. Generate + write settings.yaml (with optional stack discovery)
    const settingsResult = this.mergeSettings.execute({
      team: null,
      local: null,
      env: {},
    });
    if (isErr(settingsResult)) return settingsResult;
    const settingsJson = settingsResult.data.toJSON();

    if (this.discoverStack) {
      const stackResult = await this.discoverStack.execute(params.projectRoot);
      if (stackResult.ok) {
        settingsJson.stack = { detected: stackResult.data, overrides: {} };
      }
    }

    const settingsYaml = stringify(settingsJson);
    const writeSettingsResult = await this.projectFs.writeFile(
      `${tffDir}/settings.yaml`,
      settingsYaml,
    );
    if (isErr(writeSettingsResult)) return writeSettingsResult;

    // 5. Activate database now that .tff/ exists
    this.onBeforeProjectSave?.();

    // 6. Create + save Project aggregate
    const now = this.dateProvider.now();
    const project = Project.init({
      id: crypto.randomUUID(),
      name: params.name,
      vision: params.vision,
      now,
    });

    const saveResult = await this.projectRepo.save(project);
    if (isErr(saveResult)) return saveResult;

    // 6. Publish domain events
    for (const event of project.pullEvents()) {
      await this.eventBus.publish(event);
    }

    // 7. Install post-checkout hook (optional — skipped if no port provided)
    if (this.gitHookPort) {
      const hookScript = [
        'if [ "$3" = "1" ]; then',
        "  node -e \"require('./node_modules/.tff-restore.js')\" 2>/dev/null || true",
        "fi",
      ].join("\n");
      await this.gitHookPort.installPostCheckoutHook(hookScript);
    }

    return ok(project.toJSON());
  }
}
