import { DomainEvent, DomainEventPropsSchema, type EventName, IdSchema } from "@kernel";
import { z } from "zod";

// Inline until T01 adds to EVENT_NAMES (parallel execution)
const VERIFICATION_COMPLETED_EVENT = "review.verification-completed" as EventName;

const VerificationVerdictSchema = z.enum(["PASS", "FAIL"]);

const VerificationCompletedEventPropsSchema = DomainEventPropsSchema.extend({
  sliceId: IdSchema,
  finalVerdict: VerificationVerdictSchema,
  criteriaCount: z.number().int().min(0),
  passCount: z.number().int().min(0),
  failCount: z.number().int().min(0),
  fixCyclesUsed: z.number().int().min(0),
  retriedVerification: z.boolean(),
});
type VerificationCompletedEventProps = z.infer<typeof VerificationCompletedEventPropsSchema>;

export class VerificationCompletedEvent extends DomainEvent {
  readonly eventName: EventName = VERIFICATION_COMPLETED_EVENT;
  readonly sliceId: string;
  readonly finalVerdict: string;
  readonly criteriaCount: number;
  readonly passCount: number;
  readonly failCount: number;
  readonly fixCyclesUsed: number;
  readonly retriedVerification: boolean;

  constructor(props: VerificationCompletedEventProps) {
    const parsed = VerificationCompletedEventPropsSchema.parse(props);
    super(parsed);
    this.sliceId = parsed.sliceId;
    this.finalVerdict = parsed.finalVerdict;
    this.criteriaCount = parsed.criteriaCount;
    this.passCount = parsed.passCount;
    this.failCount = parsed.failCount;
    this.fixCyclesUsed = parsed.fixCyclesUsed;
    this.retriedVerification = parsed.retriedVerification;
  }
}
