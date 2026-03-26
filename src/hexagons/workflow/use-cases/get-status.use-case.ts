import { type MilestoneRepositoryPort, MilestoneStatusSchema } from "@hexagons/milestone";
import type { ProjectRepositoryPort } from "@hexagons/project";
import { ComplexityTierSchema, type SliceRepositoryPort, SliceStatusSchema } from "@hexagons/slice";
import type { TaskRepositoryPort } from "@hexagons/task";
import { isErr, ok, type PersistenceError, type Result } from "@kernel";
import { z } from "zod";

export const StatusReportSchema = z.object({
  project: z
    .object({
      name: z.string(),
      vision: z.string(),
    })
    .nullable(),
  activeMilestone: z
    .object({
      label: z.string(),
      title: z.string(),
      status: MilestoneStatusSchema,
    })
    .nullable(),
  slices: z.array(
    z.object({
      label: z.string(),
      title: z.string(),
      status: SliceStatusSchema,
      complexity: ComplexityTierSchema.nullable(),
      taskCount: z.number().int(),
      completedTaskCount: z.number().int(),
    }),
  ),
  totals: z.object({
    totalSlices: z.number().int(),
    completedSlices: z.number().int(),
    totalTasks: z.number().int(),
    completedTasks: z.number().int(),
  }),
});
export type StatusReport = z.infer<typeof StatusReportSchema>;

export class GetStatusUseCase {
  constructor(
    private readonly projectRepo: ProjectRepositoryPort,
    private readonly milestoneRepo: MilestoneRepositoryPort,
    private readonly sliceRepo: SliceRepositoryPort,
    private readonly taskRepo: TaskRepositoryPort,
  ) {}

  async execute(): Promise<Result<StatusReport, PersistenceError>> {
    // 1. Load project
    const projectResult = await this.projectRepo.findSingleton();
    if (isErr(projectResult)) return projectResult;

    if (!projectResult.data) {
      return ok({
        project: null,
        activeMilestone: null,
        slices: [],
        totals: { totalSlices: 0, completedSlices: 0, totalTasks: 0, completedTasks: 0 },
      });
    }

    const project = projectResult.data;

    // 2. Find active milestone (first non-closed)
    const msResult = await this.milestoneRepo.findByProjectId(project.id);
    if (isErr(msResult)) return msResult;

    const activeMilestone = msResult.data.find((m) => m.status !== "closed") ?? null;

    if (!activeMilestone) {
      return ok({
        project: { name: project.name, vision: project.vision },
        activeMilestone: null,
        slices: [],
        totals: { totalSlices: 0, completedSlices: 0, totalTasks: 0, completedTasks: 0 },
      });
    }

    // 3. Load slices for active milestone
    const sliceResult = await this.sliceRepo.findByMilestoneId(activeMilestone.id);
    if (isErr(sliceResult)) return sliceResult;

    // 4. For each slice, load tasks and compute counts
    const slices: StatusReport["slices"] = [];
    let totalTasks = 0;
    let completedTasks = 0;
    let completedSlices = 0;

    for (const slice of sliceResult.data) {
      const taskResult = await this.taskRepo.findBySliceId(slice.id);
      if (isErr(taskResult)) return taskResult;

      const tasks = taskResult.data;
      const done = tasks.filter((t) => t.status === "closed").length;

      totalTasks += tasks.length;
      completedTasks += done;
      if (slice.status === "closed") completedSlices++;

      slices.push({
        label: slice.label,
        title: slice.title,
        status: slice.status,
        complexity: slice.complexity,
        taskCount: tasks.length,
        completedTaskCount: done,
      });
    }

    return ok({
      project: { name: project.name, vision: project.vision },
      activeMilestone: {
        label: activeMilestone.label,
        title: activeMilestone.title,
        status: activeMilestone.status,
      },
      slices,
      totals: {
        totalSlices: slices.length,
        completedSlices,
        totalTasks,
        completedTasks,
      },
    });
  }
}
