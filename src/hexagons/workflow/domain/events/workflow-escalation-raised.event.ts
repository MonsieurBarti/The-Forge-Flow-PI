import { DomainEvent, DomainEventPropsSchema, EVENT_NAMES, type EventName } from "@kernel";
import { z } from "zod";
import { EscalationPropsSchema } from "../workflow-session.schemas";

const WorkflowEscalationRaisedEventPropsSchema = DomainEventPropsSchema.extend({
  escalation: EscalationPropsSchema,
});

type WorkflowEscalationRaisedEventProps = z.infer<typeof WorkflowEscalationRaisedEventPropsSchema>;

export class WorkflowEscalationRaisedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.WORKFLOW_ESCALATION_RAISED;
  readonly escalation: z.infer<typeof EscalationPropsSchema>;

  constructor(props: WorkflowEscalationRaisedEventProps) {
    const parsed = WorkflowEscalationRaisedEventPropsSchema.parse(props);
    super(parsed);
    this.escalation = parsed.escalation;
  }
}
