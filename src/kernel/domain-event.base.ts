import { z } from "zod";
import type { EventName } from "./event-names";
import type { Id, Timestamp } from "./schemas";
import { IdSchema, TimestampSchema } from "./schemas";

export const DomainEventPropsSchema = z.object({
  id: IdSchema,
  aggregateId: IdSchema,
  occurredAt: TimestampSchema,
  correlationId: IdSchema.optional(),
  causationId: IdSchema.optional(),
});
export type DomainEventProps = z.infer<typeof DomainEventPropsSchema>;

export abstract class DomainEvent {
  abstract readonly eventName: EventName;
  public readonly id: Id;
  public readonly aggregateId: Id;
  public readonly occurredAt: Timestamp;
  public readonly correlationId?: Id;
  public readonly causationId?: Id;

  constructor(props: DomainEventProps) {
    const parsed = DomainEventPropsSchema.parse(props);
    this.id = parsed.id;
    this.aggregateId = parsed.aggregateId;
    this.occurredAt = parsed.occurredAt;
    this.correlationId = parsed.correlationId;
    this.causationId = parsed.causationId;
  }
}
