import type { MilestoneRepositoryPort } from "@hexagons/milestone/domain/ports/milestone-repository.port";
import type { SliceRepositoryPort } from "@hexagons/slice/domain/ports/slice-repository.port";
import type { DomainEvent } from "@kernel/domain-event.base";
import { EVENT_NAMES } from "@kernel/event-names";
import type { EventBusPort } from "@kernel/ports/event-bus.port";
import type { GitPort } from "@kernel/ports/git.port";
import type { LoggerPort } from "@kernel/ports/logger.port";
import type { StateBranchOpsPort } from "@kernel/ports/state-branch-ops.port";
import type { StateSyncPort } from "@kernel/ports/state-sync.port";

export class StateBranchCreationHandler {
  constructor(
    private readonly stateSync: StateSyncPort,
    private readonly milestoneRepo: MilestoneRepositoryPort,
    private readonly sliceRepo: SliceRepositoryPort,
    private readonly logger: LoggerPort,
    private readonly stateBranchOps?: StateBranchOpsPort,
    private readonly gitPort?: GitPort,
  ) {}

  register(eventBus: EventBusPort): void {
    eventBus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, (event) =>
      this.onProjectInitialized(event),
    );
    eventBus.subscribe(EVENT_NAMES.MILESTONE_CREATED, (event) => this.onMilestoneCreated(event));
    eventBus.subscribe(EVENT_NAMES.SLICE_CREATED, (event) => this.onSliceCreated(event));
  }

  private async onProjectInitialized(_event: DomainEvent): Promise<void> {
    if (!this.stateBranchOps) {
      this.logger.warn(
        "StateBranchCreationHandler: no stateBranchOps — cannot create tff-state/main",
      );
      return;
    }

    try {
      // Ensure at least one commit exists so branches can be forked
      if (this.gitPort) {
        const logResult = await this.gitPort.log("HEAD", 1);
        if (!logResult.ok || logResult.data.length === 0) {
          // No commits — create initial commit with .gitignore
          const commitResult = await this.gitPort.commit("chore: initial commit for TFF project", [
            ".gitignore",
          ]);
          if (!commitResult.ok) {
            this.logger.warn(
              `StateBranchCreationHandler: failed to create initial commit: ${commitResult.error.message}`,
            );
          }
        }
      }

      const existsResult = await this.stateBranchOps.branchExists("tff-state/main");
      if (existsResult.ok && existsResult.data) return; // Already exists

      const result = await this.stateBranchOps.createOrphan("tff-state/main");
      if (!result.ok) {
        this.logger.warn(
          `StateBranchCreationHandler: failed to create tff-state/main: ${result.error.message}`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `StateBranchCreationHandler: error handling PROJECT_INITIALIZED: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async onMilestoneCreated(event: DomainEvent): Promise<void> {
    try {
      const milestoneResult = await this.milestoneRepo.findById(event.aggregateId);
      if (!milestoneResult.ok || !milestoneResult.data) {
        this.logger.warn(`StateBranchCreationHandler: milestone ${event.aggregateId} not found`);
        return;
      }

      const milestone = milestoneResult.data;
      const codeBranch = `milestone/${milestone.label}`;

      // Create the code branch from main (needed for worktree creation later)
      if (this.gitPort) {
        const branchExists = await this.gitPort.branchExists(codeBranch);
        if (!branchExists.ok || !branchExists.data) {
          const createResult = await this.gitPort.createBranch(codeBranch, "main");
          if (!createResult.ok) {
            this.logger.warn(
              `StateBranchCreationHandler: failed to create code branch ${codeBranch}: ${createResult.error.message}`,
            );
          }
        }
      }

      // Create the state branch
      const result = await this.stateSync.createStateBranch(codeBranch, "tff-state/main");

      if (!result.ok) {
        this.logger.warn(
          `StateBranchCreationHandler: failed to create state branch for ${codeBranch}: ${result.error.message}`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `StateBranchCreationHandler: error handling MILESTONE_CREATED: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async onSliceCreated(event: DomainEvent): Promise<void> {
    try {
      const sliceResult = await this.sliceRepo.findById(event.aggregateId);
      if (!sliceResult.ok || !sliceResult.data) {
        this.logger.warn(`StateBranchCreationHandler: slice ${event.aggregateId} not found`);
        return;
      }

      const slice = sliceResult.data;
      if (!slice.milestoneId) {
        this.logger.warn(
          `StateBranchCreationHandler: slice ${slice.label} has no milestoneId — skipping state branch creation`,
        );
        return;
      }
      const milestoneResult = await this.milestoneRepo.findById(slice.milestoneId);
      if (!milestoneResult.ok || !milestoneResult.data) {
        this.logger.warn(
          `StateBranchCreationHandler: milestone ${slice.milestoneId} not found for slice ${slice.label}`,
        );
        return;
      }

      const milestone = milestoneResult.data;
      const codeBranch = `slice/${slice.label}`;
      const parentStateBranch = `tff-state/milestone/${milestone.label}`;
      const result = await this.stateSync.createStateBranch(codeBranch, parentStateBranch);

      if (!result.ok) {
        this.logger.warn(
          `StateBranchCreationHandler: failed to create state branch for ${codeBranch}: ${result.error.message}`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `StateBranchCreationHandler: error handling SLICE_CREATED: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
