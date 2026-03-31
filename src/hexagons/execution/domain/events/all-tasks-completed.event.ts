import type { EventName } from "@kernel";
import { DomainEvent, DomainEventPropsSchema, EVENT_NAMES, IdSchema } from "@kernel";
import { z } from "zod";

const AllTasksCompletedEventPropsSchema = DomainEventPropsSchema.extend({
  sliceId: IdSchema,
  milestoneId: IdSchema,
  completedTaskCount: z.number().int().nonnegative(),
  totalWaveCount: z.number().int().positive(),
});
type AllTasksCompletedEventProps = z.infer<typeof AllTasksCompletedEventPropsSchema>;

export class AllTasksCompletedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.ALL_TASKS_COMPLETED;
  readonly sliceId: string;
  readonly milestoneId: string;
  readonly completedTaskCount: number;
  readonly totalWaveCount: number;

  constructor(props: AllTasksCompletedEventProps) {
    const parsed = AllTasksCompletedEventPropsSchema.parse(props);
    super(parsed);
    this.sliceId = parsed.sliceId;
    this.milestoneId = parsed.milestoneId;
    this.completedTaskCount = parsed.completedTaskCount;
    this.totalWaveCount = parsed.totalWaveCount;
  }
}
