import { CompletionRecord } from "@hexagons/review/domain/aggregates/completion-record.aggregate";
import { ShipRecord } from "@hexagons/review/domain/aggregates/ship-record.aggregate";
import type { CompletionRecordRepositoryPort } from "@hexagons/review/domain/ports/completion-record-repository.port";
import type { ShipRecordRepositoryPort } from "@hexagons/review/domain/ports/ship-record-repository.port";
import { Milestone } from "@hexagons/milestone/domain/milestone.aggregate";
import type { MilestoneRepositoryPort } from "@hexagons/milestone/domain/ports/milestone-repository.port";
import { Project } from "@hexagons/project/domain/project.aggregate";
import type { ProjectRepositoryPort } from "@hexagons/project/domain/ports/project-repository.port";
import { Slice } from "@hexagons/slice/domain/slice.aggregate";
import type { SliceRepositoryPort } from "@hexagons/slice/domain/ports/slice-repository.port";
import { Task } from "@hexagons/task/domain/task.aggregate";
import type { TaskRepositoryPort } from "@hexagons/task/domain/ports/task-repository.port";
import { SyncError } from "@kernel/errors";
import { err, ok, type Result } from "@kernel/result";
import {
  migrateSnapshot,
  StateSnapshotSchema,
  type StateSnapshot,
} from "@kernel/infrastructure/state-branch/state-snapshot.schemas";

export interface StateImporterDeps {
  projectRepo: ProjectRepositoryPort;
  milestoneRepo: MilestoneRepositoryPort;
  sliceRepo: SliceRepositoryPort;
  taskRepo: TaskRepositoryPort;
  shipRecordRepo: ShipRecordRepositoryPort;
  completionRecordRepo: CompletionRecordRepositoryPort;
}

export class StateImporter {
  constructor(private readonly deps: StateImporterDeps) {}

  async import(raw: unknown): Promise<Result<void, SyncError>> {
    try {
      // Migrate if needed
      const migrated = migrateSnapshot(raw as Record<string, unknown>);
      // Validate
      const snapshot: StateSnapshot = StateSnapshotSchema.parse(migrated);

      const { projectRepo, milestoneRepo, sliceRepo, taskRepo, shipRecordRepo, completionRecordRepo } = this.deps;

      // Clear repos before import to avoid stale entity accumulation
      projectRepo.reset();
      milestoneRepo.reset();
      sliceRepo.reset();
      taskRepo.reset();
      shipRecordRepo.reset();
      completionRecordRepo.reset();

      // Import in dependency order: project → milestones → slices → tasks → records
      if (snapshot.project) {
        const project = Project.reconstitute(snapshot.project);
        const result = await projectRepo.save(project);
        if (!result.ok) return err(new SyncError("IMPORT_FAILED", result.error.message));
      }

      for (const msProps of snapshot.milestones) {
        const milestone = Milestone.reconstitute(msProps);
        const result = await milestoneRepo.save(milestone);
        if (!result.ok) return err(new SyncError("IMPORT_FAILED", result.error.message));
      }

      for (const sliceProps of snapshot.slices) {
        const slice = Slice.reconstitute(sliceProps);
        const result = await sliceRepo.save(slice);
        if (!result.ok) return err(new SyncError("IMPORT_FAILED", result.error.message));
      }

      for (const taskProps of snapshot.tasks) {
        const task = Task.reconstitute(taskProps);
        const result = await taskRepo.save(task);
        if (!result.ok) return err(new SyncError("IMPORT_FAILED", result.error.message));
      }

      for (const srProps of snapshot.shipRecords) {
        const record = ShipRecord.reconstitute(srProps);
        const result = await shipRecordRepo.save(record);
        if (!result.ok) return err(new SyncError("IMPORT_FAILED", result.error.message));
      }

      for (const crProps of snapshot.completionRecords) {
        const record = CompletionRecord.reconstitute(crProps);
        const result = await completionRecordRepo.save(record);
        if (!result.ok) return err(new SyncError("IMPORT_FAILED", result.error.message));
      }

      return ok(undefined);
    } catch (e) {
      return err(new SyncError("IMPORT_FAILED", e instanceof Error ? e.message : String(e)));
    }
  }
}
