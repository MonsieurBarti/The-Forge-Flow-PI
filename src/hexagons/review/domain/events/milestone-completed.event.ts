import {
  DomainEvent,
  DomainEventPropsSchema,
  EVENT_NAMES,
  type EventName,
  IdSchema,
} from "@kernel";
import { z } from "zod";
import { AuditAgentTypeSchema, AuditVerdictSchema } from "../schemas/completion.schemas";

const AuditVerdictEntrySchema = z.object({
  agentType: AuditAgentTypeSchema,
  verdict: AuditVerdictSchema,
});

const MilestoneCompletedEventPropsSchema = DomainEventPropsSchema.extend({
  milestoneId: IdSchema,
  milestoneLabel: z.string().min(1),
  prNumber: z.number().int().positive(),
  prUrl: z.string().url(),
  fixCyclesUsed: z.number().int().nonnegative(),
  auditVerdicts: z.array(AuditVerdictEntrySchema),
});
type MilestoneCompletedEventProps = z.infer<typeof MilestoneCompletedEventPropsSchema>;

export class MilestoneCompletedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.MILESTONE_COMPLETED;
  readonly milestoneId: string;
  readonly milestoneLabel: string;
  readonly prNumber: number;
  readonly prUrl: string;
  readonly fixCyclesUsed: number;
  readonly auditVerdicts: { agentType: string; verdict: string }[];

  constructor(props: MilestoneCompletedEventProps) {
    const parsed = MilestoneCompletedEventPropsSchema.parse(props);
    super(parsed);
    this.milestoneId = parsed.milestoneId;
    this.milestoneLabel = parsed.milestoneLabel;
    this.prNumber = parsed.prNumber;
    this.prUrl = parsed.prUrl;
    this.fixCyclesUsed = parsed.fixCyclesUsed;
    this.auditVerdicts = parsed.auditVerdicts;
  }
}
