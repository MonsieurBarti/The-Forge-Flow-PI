import type { MilestoneRepositoryPort } from "@hexagons/milestone/domain/ports/milestone-repository.port";
import type { SliceRepositoryPort } from "@hexagons/slice/domain/ports/slice-repository.port";
import type { DomainEvent } from "@kernel/domain-event.base";
import { EVENT_NAMES } from "@kernel/event-names";
import type { EventBusPort } from "@kernel/ports/event-bus.port";
import type { LoggerPort } from "@kernel/ports/logger.port";
import type { StateSyncPort } from "@kernel/ports/state-sync.port";

export class StateBranchCreationHandler {
  constructor(
    private readonly stateSync: StateSyncPort,
    private readonly milestoneRepo: MilestoneRepositoryPort,
    private readonly sliceRepo: SliceRepositoryPort,
    private readonly logger: LoggerPort,
  ) {}

  register(eventBus: EventBusPort): void {
    eventBus.subscribe(EVENT_NAMES.MILESTONE_CREATED, (event) => this.onMilestoneCreated(event));
    eventBus.subscribe(EVENT_NAMES.SLICE_CREATED, (event) => this.onSliceCreated(event));
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
      const result = await this.stateSync.createStateBranch(codeBranch, "tff-state/main");

      if (!result.ok) {
        this.logger.warn(`StateBranchCreationHandler: failed to create state branch for ${codeBranch}: ${result.error.message}`);
      }
    } catch (e) {
      this.logger.warn(`StateBranchCreationHandler: error handling MILESTONE_CREATED: ${e instanceof Error ? e.message : String(e)}`);
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
      const milestoneResult = await this.milestoneRepo.findById(slice.milestoneId);
      if (!milestoneResult.ok || !milestoneResult.data) {
        this.logger.warn(`StateBranchCreationHandler: milestone ${slice.milestoneId} not found for slice ${slice.label}`);
        return;
      }

      const milestone = milestoneResult.data;
      const codeBranch = `slice/${slice.label}`;
      const parentStateBranch = `tff-state/milestone/${milestone.label}`;
      const result = await this.stateSync.createStateBranch(codeBranch, parentStateBranch);

      if (!result.ok) {
        this.logger.warn(`StateBranchCreationHandler: failed to create state branch for ${codeBranch}: ${result.error.message}`);
      }
    } catch (e) {
      this.logger.warn(`StateBranchCreationHandler: error handling SLICE_CREATED: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
