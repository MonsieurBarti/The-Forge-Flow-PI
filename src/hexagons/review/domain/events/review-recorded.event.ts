import {
  DomainEvent,
  DomainEventPropsSchema,
  EVENT_NAMES,
  type EventName,
  IdSchema,
} from "@kernel";
import { z } from "zod";
import { ReviewRoleSchema, ReviewVerdictSchema } from "../schemas/review.schemas";

const ReviewRecordedEventPropsSchema = DomainEventPropsSchema.extend({
  sliceId: IdSchema,
  role: ReviewRoleSchema,
  verdict: ReviewVerdictSchema,
  findingsCount: z.number().int().min(0),
  blockerCount: z.number().int().min(0),
});
type ReviewRecordedEventProps = z.infer<typeof ReviewRecordedEventPropsSchema>;

export class ReviewRecordedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.REVIEW_RECORDED;
  readonly sliceId: string;
  readonly role: string;
  readonly verdict: string;
  readonly findingsCount: number;
  readonly blockerCount: number;

  constructor(props: ReviewRecordedEventProps) {
    const parsed = ReviewRecordedEventPropsSchema.parse(props);
    super(parsed);
    this.sliceId = parsed.sliceId;
    this.role = parsed.role;
    this.verdict = parsed.verdict;
    this.findingsCount = parsed.findingsCount;
    this.blockerCount = parsed.blockerCount;
  }
}
