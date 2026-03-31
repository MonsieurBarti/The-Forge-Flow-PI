import { faker } from "@faker-js/faker";
import { Review } from "./review.aggregate";
import type { FindingProps, ReviewProps, ReviewRole, ReviewVerdict } from "./review.schemas";

export class ReviewBuilder {
  private _id: string = faker.string.uuid();
  private _sliceId: string = faker.string.uuid();
  private _role: ReviewRole = "code-reviewer";
  private _agentIdentity: string = `agent-${faker.string.alphanumeric(8)}`;
  private _verdict: ReviewVerdict = "approved";
  private _findings: FindingProps[] = [];
  private _now: Date = faker.date.recent();

  withId(id: string): this {
    this._id = id;
    return this;
  }
  withSliceId(id: string): this {
    this._sliceId = id;
    return this;
  }
  withRole(r: ReviewRole): this {
    this._role = r;
    return this;
  }
  withAgentIdentity(a: string): this {
    this._agentIdentity = a;
    return this;
  }
  withVerdict(v: ReviewVerdict): this {
    this._verdict = v;
    return this;
  }
  withFindings(f: FindingProps[]): this {
    this._findings = f;
    return this;
  }

  build(): Review {
    const review = Review.createNew({
      id: this._id,
      sliceId: this._sliceId,
      role: this._role,
      agentIdentity: this._agentIdentity,
      now: this._now,
    });
    if (this._findings.length > 0) {
      review.recordFindings(this._findings, this._now);
    }
    return review;
  }

  buildProps(): ReviewProps {
    return {
      id: this._id,
      sliceId: this._sliceId,
      role: this._role,
      agentIdentity: this._agentIdentity,
      verdict: this._verdict,
      findings: this._findings,
      createdAt: this._now,
      updatedAt: this._now,
    };
  }
}
