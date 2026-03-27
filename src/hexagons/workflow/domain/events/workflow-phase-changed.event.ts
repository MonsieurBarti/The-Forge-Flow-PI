import { DomainEvent, DomainEventPropsSchema, EVENT_NAMES, type EventName } from "@kernel";
import { z } from "zod";
import type { WorkflowPhase, WorkflowTrigger } from "../workflow-session.schemas";
import { WorkflowPhaseSchema, WorkflowTriggerSchema } from "../workflow-session.schemas";

const WorkflowPhaseChangedEventPropsSchema = DomainEventPropsSchema.extend({
  milestoneId: z.string().uuid(),
  sliceId: z.string().uuid().optional(),
  fromPhase: WorkflowPhaseSchema,
  toPhase: WorkflowPhaseSchema,
  trigger: WorkflowTriggerSchema,
  retryCount: z.number().int().min(0),
});

type WorkflowPhaseChangedEventProps = z.infer<typeof WorkflowPhaseChangedEventPropsSchema>;

export class WorkflowPhaseChangedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.WORKFLOW_PHASE_CHANGED;
  readonly milestoneId: string;
  readonly sliceId?: string;
  readonly fromPhase: WorkflowPhase;
  readonly toPhase: WorkflowPhase;
  readonly trigger: WorkflowTrigger;
  readonly retryCount: number;

  constructor(props: WorkflowPhaseChangedEventProps) {
    const parsed = WorkflowPhaseChangedEventPropsSchema.parse(props);
    super(parsed);
    this.milestoneId = parsed.milestoneId;
    this.sliceId = parsed.sliceId;
    this.fromPhase = parsed.fromPhase;
    this.toPhase = parsed.toPhase;
    this.trigger = parsed.trigger;
    this.retryCount = parsed.retryCount;
  }
}
