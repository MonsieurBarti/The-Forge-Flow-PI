import { MilestoneBuilder } from "@hexagons/milestone/domain/milestone.builder";
import { InMemoryMilestoneRepository } from "@hexagons/milestone/infrastructure/in-memory-milestone.repository";
import { SliceBuilder } from "@hexagons/slice/domain/slice.builder";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { EVENT_NAMES, InProcessEventBus, SilentLoggerAdapter, SyncError } from "@kernel";
import { DomainEvent, type DomainEventProps } from "@kernel/domain-event.base";
import type { EventName } from "@kernel/event-names";
import type { StateSyncPort } from "@kernel/ports/state-sync.port";
import { err, ok } from "@kernel/result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StateBranchCreationHandler } from "./state-branch-creation.handler";

class TestEvent extends DomainEvent {
  readonly eventName: EventName;
  constructor(name: EventName, props: DomainEventProps) {
    super(props);
    this.eventName = name;
  }
}

function makeEvent(name: EventName, aggregateId: string): TestEvent {
  return new TestEvent(name, {
    id: crypto.randomUUID(),
    aggregateId,
    occurredAt: new Date(),
  });
}

describe("StateBranchCreationHandler", () => {
  let milestoneRepo: InMemoryMilestoneRepository;
  let sliceRepo: InMemorySliceRepository;
  let mockStateSync: StateSyncPort;
  let logger: SilentLoggerAdapter;
  let eventBus: InProcessEventBus;
  let handler: StateBranchCreationHandler;

  beforeEach(() => {
    milestoneRepo = new InMemoryMilestoneRepository();
    sliceRepo = new InMemorySliceRepository();
    logger = new SilentLoggerAdapter();
    eventBus = new InProcessEventBus(logger);

    mockStateSync = {
      createStateBranch: vi.fn().mockResolvedValue(ok(undefined)),
      deleteStateBranch: vi.fn().mockResolvedValue(ok(undefined)),
      syncToStateBranch: vi.fn().mockResolvedValue(ok(undefined)),
      restoreFromStateBranch: vi
        .fn()
        .mockResolvedValue(ok({ pulled: 0, conflicts: [], timestamp: new Date() })),
      mergeStateBranches: vi.fn().mockResolvedValue(ok(undefined)),
    } as unknown as StateSyncPort;

    handler = new StateBranchCreationHandler(mockStateSync, milestoneRepo, sliceRepo, logger);
    handler.register(eventBus);
  });

  it("creates state branch on MILESTONE_CREATED", async () => {
    const milestoneId = crypto.randomUUID();
    const milestone = new MilestoneBuilder().withId(milestoneId).withLabel("M07").build();
    milestoneRepo.seed(milestone);

    const event = makeEvent(EVENT_NAMES.MILESTONE_CREATED, milestoneId);
    await eventBus.publish(event);

    expect(mockStateSync.createStateBranch).toHaveBeenCalledWith("milestone/M07", "tff-state/main");
  });

  it("creates state branch on SLICE_CREATED with correct parent", async () => {
    const milestoneId = crypto.randomUUID();
    const sliceId = crypto.randomUUID();

    const milestone = new MilestoneBuilder().withId(milestoneId).withLabel("M07").build();
    milestoneRepo.seed(milestone);

    const slice = new SliceBuilder()
      .withId(sliceId)
      .withMilestoneId(milestoneId)
      .withLabel("M07-S02")
      .build();
    sliceRepo.seed(slice);

    const event = makeEvent(EVENT_NAMES.SLICE_CREATED, sliceId);
    await eventBus.publish(event);

    expect(mockStateSync.createStateBranch).toHaveBeenCalledWith(
      "slice/M07-S02",
      "tff-state/milestone/M07",
    );
  });

  it("logs warning on failure without throwing", async () => {
    const milestoneId = crypto.randomUUID();
    const milestone = new MilestoneBuilder().withId(milestoneId).withLabel("M07").build();
    milestoneRepo.seed(milestone);

    (mockStateSync.createStateBranch as ReturnType<typeof vi.fn>).mockResolvedValue(
      err(new SyncError("BRANCH_NOT_FOUND", "branch not found")),
    );

    const event = makeEvent(EVENT_NAMES.MILESTONE_CREATED, milestoneId);
    // Should not throw
    await eventBus.publish(event);
  });

  it("logs warning when milestone not found", async () => {
    const event = makeEvent(EVENT_NAMES.MILESTONE_CREATED, crypto.randomUUID());
    // Should not throw
    await eventBus.publish(event);
  });
});
