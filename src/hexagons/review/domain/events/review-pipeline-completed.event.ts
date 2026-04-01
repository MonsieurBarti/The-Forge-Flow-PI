import {
  DomainEvent,
  DomainEventPropsSchema,
  EVENT_NAMES,
  type EventName,
  IdSchema,
} from "@kernel";
import { z } from "zod";
import { ReviewRoleSchema, ReviewVerdictSchema } from "../review.schemas";

const ReviewPipelineCompletedEventPropsSchema = DomainEventPropsSchema.extend({
  sliceId: IdSchema,
  verdict: ReviewVerdictSchema,
  reviewCount: z.number().int().min(0),
  findingsCount: z.number().int().min(0),
  blockerCount: z.number().int().min(0),
  conflictCount: z.number().int().min(0),
  fixCyclesUsed: z.number().int().min(0),
  timedOutRoles: z.array(ReviewRoleSchema),
  retriedRoles: z.array(ReviewRoleSchema),
});
type ReviewPipelineCompletedEventProps = z.infer<typeof ReviewPipelineCompletedEventPropsSchema>;

export class ReviewPipelineCompletedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.REVIEW_PIPELINE_COMPLETED;
  readonly sliceId: string;
  readonly verdict: string;
  readonly reviewCount: number;
  readonly findingsCount: number;
  readonly blockerCount: number;
  readonly conflictCount: number;
  readonly fixCyclesUsed: number;
  readonly timedOutRoles: string[];
  readonly retriedRoles: string[];

  constructor(props: ReviewPipelineCompletedEventProps) {
    const parsed = ReviewPipelineCompletedEventPropsSchema.parse(props);
    super(parsed);
    this.sliceId = parsed.sliceId;
    this.verdict = parsed.verdict;
    this.reviewCount = parsed.reviewCount;
    this.findingsCount = parsed.findingsCount;
    this.blockerCount = parsed.blockerCount;
    this.conflictCount = parsed.conflictCount;
    this.fixCyclesUsed = parsed.fixCyclesUsed;
    this.timedOutRoles = [...parsed.timedOutRoles];
    this.retriedRoles = [...parsed.retriedRoles];
  }
}
