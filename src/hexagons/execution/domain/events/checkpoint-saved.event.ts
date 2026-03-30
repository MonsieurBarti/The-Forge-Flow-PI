import {
  DomainEvent,
  DomainEventPropsSchema,
  EVENT_NAMES,
  type EventName,
  IdSchema,
} from "@kernel";
import { z } from "zod";

const CheckpointSavedEventPropsSchema = DomainEventPropsSchema.extend({
  sliceId: IdSchema,
  waveIndex: z.number().int().min(0),
  completedTaskCount: z.number().int().min(0),
});

type CheckpointSavedEventProps = z.infer<typeof CheckpointSavedEventPropsSchema>;

export class CheckpointSavedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.CHECKPOINT_SAVED;
  readonly sliceId: string;
  readonly waveIndex: number;
  readonly completedTaskCount: number;

  constructor(props: CheckpointSavedEventProps) {
    const parsed = CheckpointSavedEventPropsSchema.parse(props);
    super(parsed);
    this.sliceId = parsed.sliceId;
    this.waveIndex = parsed.waveIndex;
    this.completedTaskCount = parsed.completedTaskCount;
  }
}
