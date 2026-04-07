import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectRepositoryPort } from "@hexagons/project";
import {
  type DateProviderPort,
  type EventBusPort,
  err,
  isErr,
  ok,
  type PersistenceError,
  type Result,
} from "@kernel";
import { z } from "zod";
import { Milestone } from "../domain/milestone.aggregate";
import type { MilestoneRepositoryPort } from "../domain/ports/milestone-repository.port";

export const CreateMilestoneParamsSchema = z.object({
  title: z.string().min(1).describe("Milestone title"),
  description: z.string().default("").describe("Milestone description"),
  requirements: z
    .string()
    .min(1)
    .describe("Milestone requirements — gathered from user discussion. Written to REQUIREMENTS.md"),
});
export type CreateMilestoneParams = z.infer<typeof CreateMilestoneParamsSchema>;

export class CreateMilestoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreateMilestoneError";
  }
}

export class CreateMilestoneUseCase {
  constructor(
    private readonly projectRepo: ProjectRepositoryPort,
    private readonly milestoneRepo: MilestoneRepositoryPort,
    private readonly eventBus: EventBusPort,
    private readonly dateProvider: DateProviderPort,
    private readonly projectRoot: string,
  ) {}

  async execute(
    params: CreateMilestoneParams,
  ): Promise<
    Result<
      { milestoneId: string; label: string; requirementsPath: string },
      CreateMilestoneError | PersistenceError
    >
  > {
    // 1. Get the project (must exist)
    const projectResult = await this.projectRepo.findSingleton();
    if (isErr(projectResult)) return projectResult;
    if (!projectResult.data) {
      return err(new CreateMilestoneError("No project found. Run /tff new first."));
    }

    // 2. Count existing milestones to derive next label
    const existingResult = await this.milestoneRepo.findByProjectId(projectResult.data.id);
    if (isErr(existingResult)) return existingResult;
    const nextNumber = existingResult.data.length + 1;
    const label = `M${String(nextNumber).padStart(2, "0")}`;

    // 2b. Guard: only one milestone can be in_progress at a time
    const activeMs = existingResult.data.find((m) => m.status === "in_progress");
    if (activeMs) {
      return err(
        new CreateMilestoneError(
          `Milestone ${activeMs.label} is already in progress. Complete or close it before creating a new one.`,
        ),
      );
    }

    // 3. Check for label collision
    const labelCheck = await this.milestoneRepo.findByLabel(label);
    if (isErr(labelCheck)) return labelCheck;
    if (labelCheck.data) {
      return err(new CreateMilestoneError(`Milestone ${label} already exists`));
    }

    // Strip redundant label prefix from title (e.g., "M01 -- Foundation" → "Foundation")
    let cleanTitle = params.title;
    const prefixPatterns = [
      new RegExp(`^${label}\\s*[—–-]+\\s*`, "i"),
      new RegExp(`^${label}\\s*:\\s*`, "i"),
      new RegExp(`^${label}\\s+`, "i"),
    ];
    for (const pattern of prefixPatterns) {
      cleanTitle = cleanTitle.replace(pattern, "");
    }

    // 4. Create milestone
    const now = this.dateProvider.now();
    const milestone = Milestone.createNew({
      id: crypto.randomUUID(),
      projectId: projectResult.data.id,
      label,
      title: cleanTitle,
      description: params.description,
      now,
    });

    // 5. Auto-activate (open -> in_progress)
    const activateResult = milestone.activate(now);
    if (!activateResult.ok) {
      return err(new CreateMilestoneError(`Failed to activate: ${activateResult.error.message}`));
    }

    // 6. Save
    const saveResult = await this.milestoneRepo.save(milestone);
    if (isErr(saveResult)) return saveResult;

    // 6b. Write REQUIREMENTS.md
    const milestoneDir = join(this.projectRoot, ".tff", "milestones", label);
    mkdirSync(join(milestoneDir, "slices"), { recursive: true });
    writeFileSync(
      join(milestoneDir, "REQUIREMENTS.md"),
      `# ${label}: ${cleanTitle}\n\n${params.requirements}\n`,
    );

    // 7. Publish events
    for (const event of milestone.pullEvents()) {
      await this.eventBus.publish(event);
    }

    const requirementsPath = join(milestoneDir, "REQUIREMENTS.md");
    return ok({ milestoneId: milestone.id, label, requirementsPath });
  }
}
