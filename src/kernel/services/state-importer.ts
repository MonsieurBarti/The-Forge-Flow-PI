import { Milestone } from "@hexagons/milestone/domain/milestone.aggregate";
import type { MilestoneRepositoryPort } from "@hexagons/milestone/domain/ports/milestone-repository.port";
import type { ProjectRepositoryPort } from "@hexagons/project/domain/ports/project-repository.port";
import { Project } from "@hexagons/project/domain/project.aggregate";
import { CompletionRecord } from "@hexagons/review/domain/aggregates/completion-record.aggregate";
import { Review } from "@hexagons/review/domain/aggregates/review.aggregate";
import { ShipRecord } from "@hexagons/review/domain/aggregates/ship-record.aggregate";
import { Verification } from "@hexagons/review/domain/aggregates/verification.aggregate";
import type { CompletionRecordRepositoryPort } from "@hexagons/review/domain/ports/completion-record-repository.port";
import type { ReviewRepositoryPort } from "@hexagons/review/domain/ports/review-repository.port";
import type { ShipRecordRepositoryPort } from "@hexagons/review/domain/ports/ship-record-repository.port";
import type { VerificationRepositoryPort } from "@hexagons/review/domain/ports/verification-repository.port";
import type { SliceRepositoryPort } from "@hexagons/slice/domain/ports/slice-repository.port";
import { Slice } from "@hexagons/slice/domain/slice.aggregate";
import type { TaskRepositoryPort } from "@hexagons/task/domain/ports/task-repository.port";
import { Task } from "@hexagons/task/domain/task.aggregate";
import type { WorkflowSessionRepositoryPort } from "@hexagons/workflow/domain/ports/workflow-session.repository.port";
import { WorkflowSession } from "@hexagons/workflow/domain/workflow-session.aggregate";
import { SyncError } from "@kernel/errors";
import {
  migrateSnapshot,
  type StateSnapshot,
  StateSnapshotSchema,
} from "@kernel/infrastructure/state-branch/state-snapshot.schemas";
import { err, ok, type Result } from "@kernel/result";

export interface StateImporterDeps {
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

export class StateImporter {
  constructor(private readonly deps: StateImporterDeps) {}

  async import(raw: unknown): Promise<Result<void, SyncError>> {
    try {
      // Migrate if needed
      const migrated = migrateSnapshot(raw as Record<string, unknown>);
      // Validate
      const snapshot: StateSnapshot = StateSnapshotSchema.parse(migrated);

      const {
        projectRepo,
        milestoneRepo,
        sliceRepo,
        taskRepo,
        shipRecordRepo,
        completionRecordRepo,
      } = this.deps;

      // Clear repos before import to avoid stale entity accumulation
      projectRepo.reset();
      milestoneRepo.reset();
      sliceRepo.reset();
      taskRepo.reset();
      shipRecordRepo.reset();
      completionRecordRepo.reset();
      this.deps.workflowSessionRepo.reset();
      this.deps.reviewRepo.reset();
      this.deps.verificationRepo.reset();

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

      for (const wsProps of snapshot.workflowSessions) {
        const session = WorkflowSession.reconstitute(wsProps);
        const result = await this.deps.workflowSessionRepo.save(session);
        if (!result.ok) return err(new SyncError("IMPORT_FAILED", result.error.message));
      }

      for (const rvProps of snapshot.reviews) {
        const review = Review.reconstitute(rvProps);
        const result = await this.deps.reviewRepo.save(review);
        if (!result.ok) return err(new SyncError("IMPORT_FAILED", result.error.message));
      }

      for (const vfProps of snapshot.verifications) {
        const verification = Verification.reconstitute(vfProps);
        const result = await this.deps.verificationRepo.save(verification);
        if (!result.ok) return err(new SyncError("IMPORT_FAILED", result.error.message));
      }

      return ok(undefined);
    } catch (e) {
      return err(new SyncError("IMPORT_FAILED", e instanceof Error ? e.message : String(e)));
    }
  }
}
