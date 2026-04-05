import type { Milestone } from "@hexagons/milestone/domain/milestone.aggregate";
import type { MilestoneRepositoryPort } from "@hexagons/milestone/domain/ports/milestone-repository.port";
import type { ProjectRepositoryPort } from "@hexagons/project/domain/ports/project-repository.port";
import type { SliceRepositoryPort } from "@hexagons/slice/domain/ports/slice-repository.port";
import type { Slice } from "@hexagons/slice/domain/slice.aggregate";
import type { TaskRepositoryPort } from "@hexagons/task/domain/ports/task-repository.port";
import type { Task } from "@hexagons/task/domain/task.aggregate";
import {
  OverlayDataPort,
  type OverlayProjectSnapshot,
  type OverlaySliceSnapshot,
} from "@kernel/ports/overlay-data.port";
import type { Result } from "@kernel/result";
import { err, ok } from "@kernel/result";
import type { Id } from "@kernel/schemas";

export class OverlayDataAdapter extends OverlayDataPort {
  constructor(
    private readonly projectRepo: ProjectRepositoryPort,
    private readonly milestoneRepo: MilestoneRepositoryPort,
    private readonly sliceRepo: SliceRepositoryPort,
    private readonly taskRepo: TaskRepositoryPort,
  ) {
    super();
  }

  async getProjectSnapshot(): Promise<Result<OverlayProjectSnapshot, Error>> {
    const projectResult = await this.projectRepo.findSingleton();
    const project = projectResult.ok ? projectResult.data : null;

    let milestone: Milestone | null = null;
    let slices: Slice[] = [];
    const taskCounts = new Map<string, { done: number; total: number }>();

    if (project) {
      const msResult = await this.milestoneRepo.findByProjectId(project.id);
      if (msResult.ok) {
        milestone = msResult.data.find((m) => m.status !== "closed") ?? null;

        if (milestone) {
          const sliceResult = await this.sliceRepo.findByMilestoneId(milestone.id);
          if (sliceResult.ok) {
            slices = sliceResult.data;
            for (const slice of sliceResult.data) {
              const taskResult = await this.taskRepo.findBySliceId(slice.id);
              if (taskResult.ok) {
                const done = taskResult.data.filter((t: Task) => t.status === "closed").length;
                taskCounts.set(slice.id, { done, total: taskResult.data.length });
              }
            }
          }
        }
      }
    }

    return ok({ project, milestone, slices, taskCounts });
  }

  async getSliceSnapshot(sliceId: Id): Promise<Result<OverlaySliceSnapshot, Error>> {
    const sliceResult = await this.sliceRepo.findById(sliceId);
    if (!sliceResult.ok) {
      return err(new Error(`Failed to load slice: ${sliceResult.error.message}`));
    }
    if (!sliceResult.data) {
      return err(new Error(`Slice not found: ${sliceId}`));
    }

    const taskResult = await this.taskRepo.findBySliceId(sliceId);
    const tasks = taskResult.ok ? taskResult.data : [];

    return ok({ slice: sliceResult.data, tasks });
  }
}
