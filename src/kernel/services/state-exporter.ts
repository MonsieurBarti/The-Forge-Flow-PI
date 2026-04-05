import type { CompletionRecordRepositoryPort } from "@hexagons/review/domain/ports/completion-record-repository.port";
import type { ReviewRepositoryPort } from "@hexagons/review/domain/ports/review-repository.port";
import type { ShipRecordRepositoryPort } from "@hexagons/review/domain/ports/ship-record-repository.port";
import type { VerificationRepositoryPort } from "@hexagons/review/domain/ports/verification-repository.port";
import type { MilestoneRepositoryPort } from "@hexagons/milestone/domain/ports/milestone-repository.port";
import type { ProjectRepositoryPort } from "@hexagons/project/domain/ports/project-repository.port";
import type { SliceRepositoryPort } from "@hexagons/slice/domain/ports/slice-repository.port";
import type { TaskRepositoryPort } from "@hexagons/task/domain/ports/task-repository.port";
import type { WorkflowSessionRepositoryPort } from "@hexagons/workflow/domain/ports/workflow-session.repository.port";
import { SyncError } from "@kernel/errors";
import { err, ok, type Result } from "@kernel/result";
import {
  SCHEMA_VERSION,
  type StateSnapshot,
} from "@kernel/infrastructure/state-branch/state-snapshot.schemas";

export interface StateExporterDeps {
  projectRepo: ProjectRepositoryPort;
  milestoneRepo: MilestoneRepositoryPort;
  sliceRepo: SliceRepositoryPort;
  taskRepo: TaskRepositoryPort;
  shipRecordRepo: ShipRecordRepositoryPort;
  completionRecordRepo: CompletionRecordRepositoryPort;
  workflowSessionRepo: WorkflowSessionRepositoryPort;
  reviewRepo: ReviewRepositoryPort;
  verificationRepo: VerificationRepositoryPort;
}

export class StateExporter {
  constructor(private readonly deps: StateExporterDeps) {}

  async export(): Promise<Result<StateSnapshot, SyncError>> {
    try {
      const { projectRepo, milestoneRepo, sliceRepo, taskRepo, shipRecordRepo, completionRecordRepo } = this.deps;

      // Project (singleton)
      const projectResult = await projectRepo.findSingleton();
      if (!projectResult.ok) return err(new SyncError("EXPORT_FAILED", projectResult.error.message));
      const project = projectResult.data;

      // Milestones
      let milestoneProps: ReturnType<typeof project.toJSON>[] extends never[] ? never : unknown[] = [];
      if (project) {
        const msResult = await milestoneRepo.findByProjectId(project.id);
        if (!msResult.ok) return err(new SyncError("EXPORT_FAILED", msResult.error.message));
        milestoneProps = msResult.data.map((m) => m.toJSON());
      }

      // Slices (for each milestone)
      const sliceProps: unknown[] = [];
      const taskProps: unknown[] = [];

      for (const ms of milestoneProps) {
        const msId = (ms as { id: string }).id;
        const sliceResult = await sliceRepo.findByMilestoneId(msId);
        if (!sliceResult.ok) return err(new SyncError("EXPORT_FAILED", sliceResult.error.message));

        for (const slice of sliceResult.data) {
          sliceProps.push(slice.toJSON());

          const taskResult = await taskRepo.findBySliceId(slice.id);
          if (!taskResult.ok) return err(new SyncError("EXPORT_FAILED", taskResult.error.message));
          taskProps.push(...taskResult.data.map((t) => t.toJSON()));
        }
      }

      // Ship records
      const shipResult = await shipRecordRepo.findAll();
      if (!shipResult.ok) return err(new SyncError("EXPORT_FAILED", shipResult.error.message));

      // Completion records
      const completionResult = await completionRecordRepo.findAll();
      if (!completionResult.ok) return err(new SyncError("EXPORT_FAILED", completionResult.error.message));

      // Workflow sessions
      const wsResult = await this.deps.workflowSessionRepo.findAll();
      if (!wsResult.ok) return err(new SyncError("EXPORT_FAILED", wsResult.error.message));

      // Reviews
      const rvResult = await this.deps.reviewRepo.findAll();
      if (!rvResult.ok) return err(new SyncError("EXPORT_FAILED", rvResult.error.message));

      // Verifications
      const vfResult = await this.deps.verificationRepo.findAll();
      if (!vfResult.ok) return err(new SyncError("EXPORT_FAILED", vfResult.error.message));

      const snapshot: StateSnapshot = {
        version: SCHEMA_VERSION,
        exportedAt: new Date(),
        project: project ? project.toJSON() : null,
        milestones: milestoneProps as StateSnapshot["milestones"],
        slices: sliceProps as StateSnapshot["slices"],
        tasks: taskProps as StateSnapshot["tasks"],
        shipRecords: shipResult.data.map((r) => r.toJSON()),
        completionRecords: completionResult.data.map((r) => r.toJSON()),
        workflowSessions: wsResult.data.map((ws) => ws.toJSON()),
        reviews: rvResult.data.map((r) => r.toJSON()),
        verifications: vfResult.data.map((v) => v.toJSON()),
      };

      return ok(snapshot);
    } catch (e) {
      return err(new SyncError("EXPORT_FAILED", e instanceof Error ? e.message : String(e)));
    }
  }
}
