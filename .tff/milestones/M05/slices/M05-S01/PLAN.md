# M05-S01: Review Entity + Repository — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Establish domain model for review hexagon — Review aggregate, MergedReview VO, schemas, ports, events, repositories, builders.
**Architecture:** New hexagon at `src/hexagons/review/` following established patterns (Slice, Execution hexagons).
**Tech Stack:** Zod, Vitest, @faker-js/faker, better-sqlite3 (stub only)

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/hexagons/review/domain/review.schemas.ts` | CREATE | Severity/Verdict/Role enums, FindingPropsSchema, ReviewPropsSchema |
| `src/hexagons/review/domain/review.schemas.spec.ts` | CREATE | Schema validation tests |
| `src/hexagons/review/domain/merged-review.schemas.ts` | CREATE | MergedFinding, Conflict, MergedReview schemas |
| `src/hexagons/review/domain/events/review-recorded.event.ts` | CREATE | ReviewRecordedEvent domain event |
| `src/hexagons/review/domain/review.aggregate.ts` | CREATE | Review aggregate root |
| `src/hexagons/review/domain/review.aggregate.spec.ts` | CREATE | Aggregate tests |
| `src/hexagons/review/domain/review.builder.ts` | CREATE | ReviewBuilder (faker) |
| `src/hexagons/review/domain/finding.builder.ts` | CREATE | FindingBuilder (faker) |
| `src/hexagons/review/domain/merged-review.vo.ts` | CREATE | MergedReview value object |
| `src/hexagons/review/domain/merged-review.vo.spec.ts` | CREATE | VO merge/dedup/conflict tests |
| `src/hexagons/review/domain/errors/fresh-reviewer-violation.error.ts` | CREATE | Placeholder error (S02 fills logic) |
| `src/hexagons/review/domain/ports/review-repository.port.ts` | CREATE | Abstract ReviewRepositoryPort |
| `src/hexagons/review/infrastructure/in-memory-review.repository.ts` | CREATE | InMemoryReviewRepository |
| `src/hexagons/review/infrastructure/in-memory-review.repository.spec.ts` | CREATE | Repository CRUD + query tests |
| `src/hexagons/review/infrastructure/sqlite-review.repository.ts` | CREATE | Stub (throws "Not implemented") |
| `src/hexagons/review/index.ts` | CREATE | Barrel exports |

---

### Task 1: Review Schemas
**Files:** Create `src/hexagons/review/domain/review.schemas.ts`, `src/hexagons/review/domain/review.schemas.spec.ts`, `src/hexagons/review/domain/merged-review.schemas.ts`
**Traces to:** AC19

- [ ] Step 1: Write failing test

```typescript
// src/hexagons/review/domain/review.schemas.spec.ts
import { describe, expect, it } from "vitest";
import {
  ReviewSeveritySchema,
  ReviewVerdictSchema,
  ReviewRoleSchema,
  FindingPropsSchema,
  ReviewPropsSchema,
} from "./review.schemas";
import {
  MergedFindingPropsSchema,
  ConflictPropsSchema,
  MergedReviewPropsSchema,
} from "./merged-review.schemas";
import { faker } from "@faker-js/faker";

describe("ReviewSeveritySchema", () => {
  it("accepts all 5 valid levels", () => {
    for (const level of ["critical", "high", "medium", "low", "info"]) {
      expect(ReviewSeveritySchema.parse(level)).toBe(level);
    }
  });

  it("rejects invalid severity", () => {
    expect(() => ReviewSeveritySchema.parse("catastrophic")).toThrow();
    expect(() => ReviewSeveritySchema.parse("major")).toThrow();
  });
});

describe("ReviewVerdictSchema", () => {
  it("accepts valid verdicts", () => {
    for (const v of ["approved", "changes_requested", "rejected"]) {
      expect(ReviewVerdictSchema.parse(v)).toBe(v);
    }
  });
});

describe("ReviewRoleSchema", () => {
  it("accepts valid roles", () => {
    for (const r of ["code-reviewer", "spec-reviewer", "security-auditor"]) {
      expect(ReviewRoleSchema.parse(r)).toBe(r);
    }
  });
});

describe("FindingPropsSchema", () => {
  const valid = {
    id: faker.string.uuid(),
    severity: "high",
    message: "Potential SQL injection",
    filePath: "src/api/handler.ts",
    lineStart: 42,
  };

  it("accepts valid finding with required fields only", () => {
    const result = FindingPropsSchema.parse(valid);
    expect(result.lineEnd).toBeUndefined();
    expect(result.suggestion).toBeUndefined();
    expect(result.ruleId).toBeUndefined();
  });

  it("accepts optional fields", () => {
    const result = FindingPropsSchema.parse({
      ...valid,
      lineEnd: 50,
      suggestion: "Use parameterized queries",
      ruleId: "OWASP-A03",
    });
    expect(result.lineEnd).toBe(50);
    expect(result.suggestion).toBe("Use parameterized queries");
    expect(result.ruleId).toBe("OWASP-A03");
  });

  it("rejects empty message", () => {
    expect(() => FindingPropsSchema.parse({ ...valid, message: "" })).toThrow();
  });

  it("rejects non-positive lineStart", () => {
    expect(() => FindingPropsSchema.parse({ ...valid, lineStart: 0 })).toThrow();
  });
});

describe("ReviewPropsSchema", () => {
  it("accepts valid review props", () => {
    const result = ReviewPropsSchema.parse({
      id: faker.string.uuid(),
      sliceId: faker.string.uuid(),
      role: "code-reviewer",
      agentIdentity: "agent-abc-123",
      verdict: "approved",
      findings: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.verdict).toBe("approved");
  });
});

describe("MergedFindingPropsSchema", () => {
  it("extends FindingPropsSchema with sourceReviewIds", () => {
    const result = MergedFindingPropsSchema.parse({
      id: faker.string.uuid(),
      severity: "medium",
      message: "Unused import",
      filePath: "src/foo.ts",
      lineStart: 1,
      sourceReviewIds: [faker.string.uuid()],
    });
    expect(result.sourceReviewIds).toHaveLength(1);
  });

  it("rejects empty sourceReviewIds", () => {
    expect(() =>
      MergedFindingPropsSchema.parse({
        id: faker.string.uuid(),
        severity: "low",
        message: "msg",
        filePath: "f.ts",
        lineStart: 1,
        sourceReviewIds: [],
      }),
    ).toThrow();
  });
});

describe("ConflictPropsSchema", () => {
  it("requires at least 2 reviewer verdicts", () => {
    expect(() =>
      ConflictPropsSchema.parse({
        filePath: "src/foo.ts",
        lineStart: 10,
        description: "Disagreement on severity",
        reviewerVerdicts: [{ reviewId: faker.string.uuid(), role: "code-reviewer", severity: "high" }],
      }),
    ).toThrow();
  });
});

describe("MergedReviewPropsSchema", () => {
  it("accepts valid merged review", () => {
    const result = MergedReviewPropsSchema.parse({
      sliceId: faker.string.uuid(),
      sourceReviewIds: [faker.string.uuid(), faker.string.uuid()],
      verdict: "approved",
      findings: [],
      conflicts: [],
      mergedAt: new Date(),
    });
    expect(result.verdict).toBe("approved");
  });
});
```

- [ ] Step 2: Run `npx vitest run src/hexagons/review/domain/review.schemas.spec.ts`, verify FAIL (modules not found)

- [ ] Step 3: Implement schemas

```typescript
// src/hexagons/review/domain/review.schemas.ts
import { z } from "zod";
import { IdSchema, TimestampSchema } from "@kernel";

export const ReviewSeveritySchema = z.enum(["critical", "high", "medium", "low", "info"]);
export type ReviewSeverity = z.infer<typeof ReviewSeveritySchema>;

export const ReviewVerdictSchema = z.enum(["approved", "changes_requested", "rejected"]);
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;

export const ReviewRoleSchema = z.enum(["code-reviewer", "spec-reviewer", "security-auditor"]);
export type ReviewRole = z.infer<typeof ReviewRoleSchema>;

export const SEVERITY_RANK: Record<ReviewSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export const FindingPropsSchema = z.object({
  id: IdSchema,
  severity: ReviewSeveritySchema,
  message: z.string().min(1),
  filePath: z.string().min(1),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive().optional(),
  suggestion: z.string().optional(),
  ruleId: z.string().optional(),
});
export type FindingProps = z.infer<typeof FindingPropsSchema>;

export const ReviewPropsSchema = z.object({
  id: IdSchema,
  sliceId: IdSchema,
  role: ReviewRoleSchema,
  agentIdentity: z.string().min(1),
  verdict: ReviewVerdictSchema,
  findings: z.array(FindingPropsSchema),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type ReviewProps = z.infer<typeof ReviewPropsSchema>;
```

```typescript
// src/hexagons/review/domain/merged-review.schemas.ts
import { z } from "zod";
import { IdSchema, TimestampSchema } from "@kernel";
import { FindingPropsSchema, ReviewRoleSchema, ReviewSeveritySchema, ReviewVerdictSchema } from "./review.schemas";

export const MergedFindingPropsSchema = FindingPropsSchema.extend({
  sourceReviewIds: z.array(IdSchema).min(1),
});
export type MergedFindingProps = z.infer<typeof MergedFindingPropsSchema>;

export const ConflictPropsSchema = z.object({
  filePath: z.string().min(1),
  lineStart: z.number().int().positive(),
  description: z.string().min(1),
  reviewerVerdicts: z.array(
    z.object({
      reviewId: IdSchema,
      role: ReviewRoleSchema,
      severity: ReviewSeveritySchema,
    }),
  ).min(2),
});
export type ConflictProps = z.infer<typeof ConflictPropsSchema>;

export const MergedReviewPropsSchema = z.object({
  sliceId: IdSchema,
  sourceReviewIds: z.array(IdSchema).min(1),
  verdict: ReviewVerdictSchema,
  findings: z.array(MergedFindingPropsSchema),
  conflicts: z.array(ConflictPropsSchema),
  mergedAt: TimestampSchema,
});
export type MergedReviewProps = z.infer<typeof MergedReviewPropsSchema>;
```

- [ ] Step 4: Run `npx vitest run src/hexagons/review/domain/review.schemas.spec.ts`, verify PASS
- [ ] Step 5: `git add src/hexagons/review/domain/review.schemas.ts src/hexagons/review/domain/review.schemas.spec.ts src/hexagons/review/domain/merged-review.schemas.ts && git commit -m "feat(M05-S01/T01): review + merged-review schemas with 5-level severity"`

---

### Task 2: ReviewRecordedEvent
**Files:** Create `src/hexagons/review/domain/events/review-recorded.event.ts`
**Traces to:** AC1, AC4
**Deps:** T1

- [ ] Step 1: Write event (no separate test — tested via aggregate in T3)

```typescript
// src/hexagons/review/domain/events/review-recorded.event.ts
import { DomainEvent, DomainEventPropsSchema, EVENT_NAMES, type EventName, IdSchema } from "@kernel";
import { ReviewRoleSchema, ReviewVerdictSchema } from "../review.schemas";
import { z } from "zod";

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
```

- [ ] Step 2: `git add src/hexagons/review/domain/events/review-recorded.event.ts && git commit -m "feat(M05-S01/T02): ReviewRecordedEvent domain event"`

---

### Task 3: Review Aggregate
**Files:** Create `src/hexagons/review/domain/review.aggregate.ts`, `src/hexagons/review/domain/review.aggregate.spec.ts`
**Traces to:** AC1, AC2, AC3, AC4, AC5, AC6
**Deps:** T1, T2

- [ ] Step 1: Write failing tests

```typescript
// src/hexagons/review/domain/review.aggregate.spec.ts
import { describe, expect, it } from "vitest";
import { Review } from "./review.aggregate";
import { ReviewRecordedEvent } from "./events/review-recorded.event";
import { faker } from "@faker-js/faker";

const sliceId = faker.string.uuid();
const now = new Date();

describe("Review", () => {
  describe("createNew", () => {
    it("creates with approved verdict and empty findings (AC1)", () => {
      const review = Review.createNew({ id: faker.string.uuid(), sliceId, role: "code-reviewer", agentIdentity: "agent-1", now });
      expect(review.verdict).toBe("approved");
      expect(review.findings).toEqual([]);
    });

    it("emits ReviewRecordedEvent on creation (AC1)", () => {
      const review = Review.createNew({ id: faker.string.uuid(), sliceId, role: "code-reviewer", agentIdentity: "agent-1", now });
      const events = review.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(ReviewRecordedEvent);
    });
  });

  describe("reconstitute", () => {
    it("does NOT emit events (AC5)", () => {
      const review = Review.reconstitute({
        id: faker.string.uuid(), sliceId, role: "code-reviewer", agentIdentity: "agent-1",
        verdict: "approved", findings: [], createdAt: now, updatedAt: now,
      });
      expect(review.pullEvents()).toHaveLength(0);
    });
  });

  describe("recordFindings", () => {
    it("sets verdict to changes_requested for critical finding (AC2)", () => {
      const review = Review.createNew({ id: faker.string.uuid(), sliceId, role: "code-reviewer", agentIdentity: "agent-1", now });
      review.pullEvents(); // clear creation event
      const result = review.recordFindings([{
        id: faker.string.uuid(), severity: "critical", message: "SQL injection",
        filePath: "src/api.ts", lineStart: 10,
      }], now);
      expect(result.ok).toBe(true);
      expect(review.verdict).toBe("changes_requested");
    });

    it("sets verdict to changes_requested for high finding (AC2)", () => {
      const review = Review.createNew({ id: faker.string.uuid(), sliceId, role: "code-reviewer", agentIdentity: "agent-1", now });
      review.pullEvents();
      review.recordFindings([{
        id: faker.string.uuid(), severity: "high", message: "XSS risk",
        filePath: "src/ui.ts", lineStart: 5,
      }], now);
      expect(review.verdict).toBe("changes_requested");
    });

    it("keeps verdict as approved for low/info only (AC3)", () => {
      const review = Review.createNew({ id: faker.string.uuid(), sliceId, role: "code-reviewer", agentIdentity: "agent-1", now });
      review.pullEvents();
      review.recordFindings([
        { id: faker.string.uuid(), severity: "low", message: "Naming", filePath: "src/a.ts", lineStart: 1 },
        { id: faker.string.uuid(), severity: "info", message: "Style", filePath: "src/b.ts", lineStart: 2 },
      ], now);
      expect(review.verdict).toBe("approved");
    });

    it("emits ReviewRecordedEvent with updated verdict (AC4)", () => {
      const review = Review.createNew({ id: faker.string.uuid(), sliceId, role: "code-reviewer", agentIdentity: "agent-1", now });
      review.pullEvents();
      review.recordFindings([{
        id: faker.string.uuid(), severity: "critical", message: "Bad",
        filePath: "src/x.ts", lineStart: 1,
      }], now);
      const events = review.pullEvents();
      expect(events).toHaveLength(1);
      const event = events[0] as ReviewRecordedEvent;
      expect(event.verdict).toBe("changes_requested");
      expect(event.findingsCount).toBe(1);
      expect(event.blockerCount).toBe(1);
    });
  });

  describe("getBlockerCount / getAdvisoryCount (AC6)", () => {
    it("counts correctly", () => {
      const review = Review.createNew({ id: faker.string.uuid(), sliceId, role: "code-reviewer", agentIdentity: "agent-1", now });
      review.recordFindings([
        { id: faker.string.uuid(), severity: "critical", message: "a", filePath: "f.ts", lineStart: 1 },
        { id: faker.string.uuid(), severity: "high", message: "b", filePath: "f.ts", lineStart: 2 },
        { id: faker.string.uuid(), severity: "medium", message: "c", filePath: "f.ts", lineStart: 3 },
        { id: faker.string.uuid(), severity: "low", message: "d", filePath: "f.ts", lineStart: 4 },
        { id: faker.string.uuid(), severity: "info", message: "e", filePath: "f.ts", lineStart: 5 },
      ], now);
      expect(review.getBlockerCount()).toBe(2);
      expect(review.getAdvisoryCount()).toBe(3);
    });
  });
});
```

- [ ] Step 2: Run `npx vitest run src/hexagons/review/domain/review.aggregate.spec.ts`, verify FAIL

- [ ] Step 3: Implement Review aggregate

```typescript
// src/hexagons/review/domain/review.aggregate.ts
import { AggregateRoot, type Id, ok, type Result, type DomainError } from "@kernel";
import { ReviewRecordedEvent } from "./events/review-recorded.event";
import {
  type FindingProps,
  type ReviewProps,
  type ReviewRole,
  type ReviewVerdict,
  ReviewPropsSchema,
  SEVERITY_RANK,
} from "./review.schemas";

export class Review extends AggregateRoot<ReviewProps> {
  private constructor(props: ReviewProps) {
    super(props, ReviewPropsSchema);
  }

  get id(): string { return this.props.id; }
  get sliceId(): string { return this.props.sliceId; }
  get role(): ReviewRole { return this.props.role; }
  get agentIdentity(): string { return this.props.agentIdentity; }
  get verdict(): ReviewVerdict { return this.props.verdict; }
  get findings(): ReadonlyArray<FindingProps> { return this.props.findings; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  static createNew(params: {
    id: Id; sliceId: Id; role: ReviewRole; agentIdentity: string; now: Date;
  }): Review {
    const review = new Review({
      id: params.id, sliceId: params.sliceId, role: params.role,
      agentIdentity: params.agentIdentity, verdict: "approved",
      findings: [], createdAt: params.now, updatedAt: params.now,
    });
    review.addEvent(new ReviewRecordedEvent({
      id: crypto.randomUUID(), aggregateId: params.id, occurredAt: params.now,
      sliceId: params.sliceId, role: params.role, verdict: "approved",
      findingsCount: 0, blockerCount: 0,
    }));
    return review;
  }

  static reconstitute(props: ReviewProps): Review {
    return new Review(props);
  }

  recordFindings(findings: FindingProps[], now: Date): Result<void, DomainError> {
    this.props.findings = [...findings];
    this.props.verdict = this.computeVerdict();
    this.props.updatedAt = now;
    this.addEvent(new ReviewRecordedEvent({
      id: crypto.randomUUID(), aggregateId: this.props.id, occurredAt: now,
      sliceId: this.props.sliceId, role: this.props.role, verdict: this.props.verdict,
      findingsCount: findings.length, blockerCount: this.getBlockerCount(),
    }));
    return ok(undefined);
  }

  computeVerdict(): ReviewVerdict {
    const hasBlocker = this.props.findings.some(
      (f) => f.severity === "critical" || f.severity === "high",
    );
    return hasBlocker ? "changes_requested" : "approved";
  }

  getBlockerCount(): number {
    return this.props.findings.filter(
      (f) => f.severity === "critical" || f.severity === "high",
    ).length;
  }

  getAdvisoryCount(): number {
    return this.props.findings.filter(
      (f) => f.severity === "medium" || f.severity === "low" || f.severity === "info",
    ).length;
  }
}
```

- [ ] Step 4: Run `npx vitest run src/hexagons/review/domain/review.aggregate.spec.ts`, verify PASS
- [ ] Step 5: `git add src/hexagons/review/domain/review.aggregate.ts src/hexagons/review/domain/review.aggregate.spec.ts && git commit -m "feat(M05-S01/T03): Review aggregate with verdict logic and events"`

---

### Task 4: FindingBuilder + ReviewBuilder
**Files:** Create `src/hexagons/review/domain/finding.builder.ts`, `src/hexagons/review/domain/review.builder.ts`
**Traces to:** AC18
**Deps:** T1, T3

- [ ] Step 1: Write failing test (add to review.aggregate.spec.ts)

```typescript
// Add to review.aggregate.spec.ts or create review.builder.spec.ts
describe("FindingBuilder", () => {
  it("produces schema-conformant data (AC18)", () => {
    const finding = new FindingBuilder().build();
    expect(() => FindingPropsSchema.parse(finding)).not.toThrow();
  });
});

describe("ReviewBuilder", () => {
  it("builds valid Review aggregate (AC18)", () => {
    const review = new ReviewBuilder().build();
    expect(review.verdict).toBe("approved");
  });

  it("buildProps returns valid raw props (AC18)", () => {
    const props = new ReviewBuilder().buildProps();
    expect(() => ReviewPropsSchema.parse(props)).not.toThrow();
  });
});
```

- [ ] Step 2: Run test, verify FAIL
- [ ] Step 3: Implement builders

```typescript
// src/hexagons/review/domain/finding.builder.ts
import { faker } from "@faker-js/faker";
import type { FindingProps, ReviewSeverity } from "./review.schemas";

export class FindingBuilder {
  private _id: string = faker.string.uuid();
  private _severity: ReviewSeverity = "medium";
  private _message: string = faker.lorem.sentence();
  private _filePath: string = `src/${faker.system.fileName()}`;
  private _lineStart: number = faker.number.int({ min: 1, max: 500 });
  private _lineEnd?: number;
  private _suggestion?: string;
  private _ruleId?: string;

  withSeverity(s: ReviewSeverity): this { this._severity = s; return this; }
  withFilePath(p: string): this { this._filePath = p; return this; }
  withLineStart(n: number): this { this._lineStart = n; return this; }
  withLineEnd(n: number): this { this._lineEnd = n; return this; }
  withMessage(m: string): this { this._message = m; return this; }
  withSuggestion(s: string): this { this._suggestion = s; return this; }
  withRuleId(r: string): this { this._ruleId = r; return this; }

  build(): FindingProps {
    return {
      id: this._id, severity: this._severity, message: this._message,
      filePath: this._filePath, lineStart: this._lineStart,
      lineEnd: this._lineEnd, suggestion: this._suggestion, ruleId: this._ruleId,
    };
  }
}
```

```typescript
// src/hexagons/review/domain/review.builder.ts
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

  withId(id: string): this { this._id = id; return this; }
  withSliceId(id: string): this { this._sliceId = id; return this; }
  withRole(r: ReviewRole): this { this._role = r; return this; }
  withAgentIdentity(a: string): this { this._agentIdentity = a; return this; }
  withVerdict(v: ReviewVerdict): this { this._verdict = v; return this; }
  withFindings(f: FindingProps[]): this { this._findings = f; return this; }

  build(): Review {
    const review = Review.createNew({
      id: this._id, sliceId: this._sliceId, role: this._role,
      agentIdentity: this._agentIdentity, now: this._now,
    });
    if (this._findings.length > 0) {
      review.recordFindings(this._findings, this._now);
    }
    return review;
  }

  buildProps(): ReviewProps {
    return {
      id: this._id, sliceId: this._sliceId, role: this._role,
      agentIdentity: this._agentIdentity, verdict: this._verdict,
      findings: this._findings, createdAt: this._now, updatedAt: this._now,
    };
  }
}
```

- [ ] Step 4: Run tests, verify PASS
- [ ] Step 5: `git add src/hexagons/review/domain/finding.builder.ts src/hexagons/review/domain/review.builder.ts && git commit -m "feat(M05-S01/T04): FindingBuilder + ReviewBuilder with faker defaults"`

---

### Task 5: MergedReview Value Object
**Files:** Create `src/hexagons/review/domain/merged-review.vo.ts`, `src/hexagons/review/domain/merged-review.vo.spec.ts`
**Traces to:** AC7, AC8, AC9, AC10, AC11, AC12, AC13, AC14
**Deps:** T1, T3, T4

- [ ] Step 1: Write failing tests

```typescript
// src/hexagons/review/domain/merged-review.vo.spec.ts
import { describe, expect, it } from "vitest";
import { MergedReview } from "./merged-review.vo";
import { Review } from "./review.aggregate";
import { ReviewBuilder } from "./review.builder";
import { FindingBuilder } from "./finding.builder";
import { faker } from "@faker-js/faker";

const sliceId = faker.string.uuid();
const now = new Date();

describe("MergedReview", () => {
  describe("merge", () => {
    it("deduplicates findings by filePath+lineStart, highest severity wins (AC7)", () => {
      const r1 = new ReviewBuilder().withSliceId(sliceId)
        .withFindings([new FindingBuilder().withFilePath("src/a.ts").withLineStart(10).withSeverity("medium").build()])
        .build();
      const r2 = new ReviewBuilder().withSliceId(sliceId)
        .withFindings([new FindingBuilder().withFilePath("src/a.ts").withLineStart(10).withSeverity("critical").build()])
        .build();
      const result = MergedReview.merge([r1, r2], now);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.findings).toHaveLength(1);
      expect(result.data.findings[0].severity).toBe("critical");
      expect(result.data.findings[0].sourceReviewIds).toHaveLength(2);
    });

    it("detects conflicts when severity diff >= 2 levels (AC8)", () => {
      const r1 = new ReviewBuilder().withSliceId(sliceId)
        .withFindings([new FindingBuilder().withFilePath("src/a.ts").withLineStart(5).withSeverity("critical").build()])
        .build();
      const r2 = new ReviewBuilder().withSliceId(sliceId)
        .withFindings([new FindingBuilder().withFilePath("src/a.ts").withLineStart(5).withSeverity("low").build()])
        .build();
      const result = MergedReview.merge([r1, r2], now);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.conflicts.length).toBeGreaterThan(0);
    });

    it("approved + changes_requested → changes_requested (AC9)", () => {
      const r1 = new ReviewBuilder().withSliceId(sliceId).build(); // approved (no findings)
      const r2 = new ReviewBuilder().withSliceId(sliceId)
        .withFindings([new FindingBuilder().withSeverity("critical").build()])
        .build(); // changes_requested
      const result = MergedReview.merge([r1, r2], now);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.verdict).toBe("changes_requested");
    });

    it("approved + rejected → rejected (AC10)", () => {
      const r1 = new ReviewBuilder().withSliceId(sliceId).build();
      const r2 = new ReviewBuilder().withSliceId(sliceId).withVerdict("rejected").build();
      // reconstitute with rejected verdict directly
      const r2recon = Review.reconstitute({ ...r2.toJSON(), verdict: "rejected" });
      const result = MergedReview.merge([r1, r2recon], now);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.verdict).toBe("rejected");
    });

    it("approved + approved → approved (AC11)", () => {
      const r1 = new ReviewBuilder().withSliceId(sliceId).build();
      const r2 = new ReviewBuilder().withSliceId(sliceId).build();
      const result = MergedReview.merge([r1, r2], now);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.verdict).toBe("approved");
    });

    it("empty array → error (AC12)", () => {
      const result = MergedReview.merge([], now);
      expect(result.ok).toBe(false);
    });

    it("mismatched sliceId → error (AC13)", () => {
      const r1 = new ReviewBuilder().withSliceId(faker.string.uuid()).build();
      const r2 = new ReviewBuilder().withSliceId(faker.string.uuid()).build();
      const result = MergedReview.merge([r1, r2], now);
      expect(result.ok).toBe(false);
    });

    it("hasBlockers and hasConflicts (AC14)", () => {
      const r1 = new ReviewBuilder().withSliceId(sliceId)
        .withFindings([new FindingBuilder().withSeverity("critical").build()])
        .build();
      const result = MergedReview.merge([r1], now);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.hasBlockers()).toBe(true);
      expect(result.data.hasConflicts()).toBe(false);
    });
  });
});
```

- [ ] Step 2: Run test, verify FAIL

- [ ] Step 3: Implement MergedReview VO

```typescript
// src/hexagons/review/domain/merged-review.vo.ts
import { ValueObject, err, ok, type Result, type DomainError, BaseDomainError } from "@kernel";
import type { Review } from "./review.aggregate";
import {
  type MergedReviewProps,
  MergedReviewPropsSchema,
  type MergedFindingProps,
  type ConflictProps,
} from "./merged-review.schemas";
import { type ReviewVerdict, SEVERITY_RANK, type ReviewSeverity } from "./review.schemas";

export class MergeValidationError extends BaseDomainError {
  readonly code = "REVIEW.MERGE_VALIDATION";
}

export class MergedReview extends ValueObject<MergedReviewProps> {
  private constructor(props: MergedReviewProps) {
    super(props, MergedReviewPropsSchema);
  }

  get sliceId(): string { return this.props.sliceId; }
  get sourceReviewIds(): ReadonlyArray<string> { return this.props.sourceReviewIds; }
  get verdict(): ReviewVerdict { return this.props.verdict; }
  get findings(): ReadonlyArray<MergedFindingProps> { return this.props.findings; }
  get conflicts(): ReadonlyArray<ConflictProps> { return this.props.conflicts; }

  hasBlockers(): boolean {
    return this.props.findings.some((f) => f.severity === "critical" || f.severity === "high");
  }

  hasConflicts(): boolean {
    return this.props.conflicts.length > 0;
  }

  static merge(reviews: Review[], now: Date): Result<MergedReview, DomainError> {
    if (reviews.length === 0) {
      return err(new MergeValidationError("Cannot merge empty review array"));
    }

    const sliceId = reviews[0].sliceId;
    if (!reviews.every((r) => r.sliceId === sliceId)) {
      return err(new MergeValidationError("All reviews must share the same sliceId"));
    }

    const sourceReviewIds = reviews.map((r) => r.id);

    // Collect all findings with source tracking
    const allFindings: Array<{ finding: typeof reviews[0]["findings"][number]; reviewId: string; role: string }> = [];
    for (const review of reviews) {
      for (const finding of review.findings) {
        allFindings.push({ finding, reviewId: review.id, role: review.role });
      }
    }

    // Group by (filePath, lineStart)
    const groups = new Map<string, typeof allFindings>();
    for (const entry of allFindings) {
      const key = `${entry.finding.filePath}:${entry.finding.lineStart}`;
      const group = groups.get(key) ?? [];
      group.push(entry);
      groups.set(key, group);
    }

    // Dedup + detect conflicts
    const mergedFindings: MergedFindingProps[] = [];
    const conflicts: ConflictProps[] = [];

    for (const [, group] of groups) {
      // Find highest severity
      let bestEntry = group[0];
      for (const entry of group) {
        if (SEVERITY_RANK[entry.finding.severity as ReviewSeverity] < SEVERITY_RANK[bestEntry.finding.severity as ReviewSeverity]) {
          bestEntry = entry;
        }
      }

      const sourceIds = [...new Set(group.map((e) => e.reviewId))];

      mergedFindings.push({
        ...bestEntry.finding,
        sourceReviewIds: sourceIds,
      });

      // Detect conflicts: severity diff >= 2 levels within the same location
      if (group.length >= 2) {
        const severities = group.map((e) => SEVERITY_RANK[e.finding.severity as ReviewSeverity]);
        const maxSev = Math.min(...severities);
        const minSev = Math.max(...severities);
        if (minSev - maxSev >= 2) {
          conflicts.push({
            filePath: bestEntry.finding.filePath,
            lineStart: bestEntry.finding.lineStart,
            description: `Severity disagreement: ${group.map((e) => `${e.role}=${e.finding.severity}`).join(", ")}`,
            reviewerVerdicts: group.map((e) => ({
              reviewId: e.reviewId,
              role: e.role as any,
              severity: e.finding.severity,
            })),
          });
        }
      }
    }

    // Verdict aggregation: rejected > changes_requested > approved
    let verdict: ReviewVerdict = "approved";
    for (const review of reviews) {
      if (review.verdict === "rejected") { verdict = "rejected"; break; }
      if (review.verdict === "changes_requested") { verdict = "changes_requested"; }
    }

    return ok(new MergedReview({
      sliceId,
      sourceReviewIds: sourceIds,
      verdict,
      findings: mergedFindings,
      conflicts,
      mergedAt: now,
    }));
  }
}
```

Note: The executor should fix the `sourceIds` reference in the final `ok(new MergedReview(...))` — it should be the top-level `sourceReviewIds` variable, not `sourceIds`.

- [ ] Step 4: Run test, verify PASS
- [ ] Step 5: `git add src/hexagons/review/domain/merged-review.vo.ts src/hexagons/review/domain/merged-review.vo.spec.ts && git commit -m "feat(M05-S01/T05): MergedReview VO with dedup, conflict detection, verdict priority"`

---

### Task 6: ReviewRepositoryPort + InMemoryReviewRepository
**Files:** Create `src/hexagons/review/domain/ports/review-repository.port.ts`, `src/hexagons/review/infrastructure/in-memory-review.repository.ts`, `src/hexagons/review/infrastructure/in-memory-review.repository.spec.ts`
**Traces to:** AC15, AC16
**Deps:** T3

- [ ] Step 1: Write failing tests

```typescript
// src/hexagons/review/infrastructure/in-memory-review.repository.spec.ts
import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryReviewRepository } from "./in-memory-review.repository";
import { ReviewBuilder } from "../domain/review.builder";
import { FindingBuilder } from "../domain/finding.builder";
import { faker } from "@faker-js/faker";

describe("InMemoryReviewRepository", () => {
  let repo: InMemoryReviewRepository;
  beforeEach(() => { repo = new InMemoryReviewRepository(); });

  it("save + findById round-trip (AC15)", async () => {
    const review = new ReviewBuilder().build();
    await repo.save(review);
    const result = await repo.findById(review.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data?.id).toBe(review.id);
    expect(result.data?.role).toBe(review.role);
  });

  it("delete removes review (AC15)", async () => {
    const review = new ReviewBuilder().build();
    await repo.save(review);
    await repo.delete(review.id);
    const result = await repo.findById(review.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBeNull();
  });

  it("findBySliceId returns all reviews for a slice (AC16)", async () => {
    const sliceId = faker.string.uuid();
    const r1 = new ReviewBuilder().withSliceId(sliceId).withRole("code-reviewer").build();
    const r2 = new ReviewBuilder().withSliceId(sliceId).withRole("security-auditor").build();
    const r3 = new ReviewBuilder().withSliceId(faker.string.uuid()).build(); // different slice
    await repo.save(r1);
    await repo.save(r2);
    await repo.save(r3);
    const result = await repo.findBySliceId(sliceId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(2);
  });

  it("findById returns null for missing id", async () => {
    const result = await repo.findById(faker.string.uuid());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBeNull();
  });
});
```

- [ ] Step 2: Run test, verify FAIL
- [ ] Step 3: Implement port + in-memory adapter
- [ ] Step 4: Run test, verify PASS
- [ ] Step 5: `git add src/hexagons/review/domain/ports/review-repository.port.ts src/hexagons/review/infrastructure/in-memory-review.repository.ts src/hexagons/review/infrastructure/in-memory-review.repository.spec.ts && git commit -m "feat(M05-S01/T06): ReviewRepositoryPort + InMemoryReviewRepository"`

---

### Task 7: SqliteReviewRepository (stub) + FreshReviewerViolationError placeholder
**Files:** Create `src/hexagons/review/infrastructure/sqlite-review.repository.ts`, `src/hexagons/review/domain/errors/fresh-reviewer-violation.error.ts`
**Traces to:** AC20 (stub pattern — consistent with all other hexagons; AC17 deferred to M07 when SQLite is wired)
**Deps:** T6

- [ ] Step 1: Implement stub + error placeholder

```typescript
// src/hexagons/review/infrastructure/sqlite-review.repository.ts
import type { Id, PersistenceError, Result } from "@kernel";
import { ReviewRepositoryPort } from "../domain/ports/review-repository.port";
import type { Review } from "../domain/review.aggregate";

export class SqliteReviewRepository extends ReviewRepositoryPort {
  save(_review: Review): Promise<Result<void, PersistenceError>> { throw new Error("Not implemented"); }
  findById(_id: Id): Promise<Result<Review | null, PersistenceError>> { throw new Error("Not implemented"); }
  findBySliceId(_sliceId: Id): Promise<Result<Review[], PersistenceError>> { throw new Error("Not implemented"); }
  delete(_id: Id): Promise<Result<void, PersistenceError>> { throw new Error("Not implemented"); }
}
```

```typescript
// src/hexagons/review/domain/errors/fresh-reviewer-violation.error.ts
import { BaseDomainError } from "@kernel";

export class FreshReviewerViolationError extends BaseDomainError {
  readonly code = "REVIEW.FRESH_REVIEWER_VIOLATION";

  constructor(reviewerId: string, sliceId: string) {
    super(`Reviewer "${reviewerId}" was also an executor for slice "${sliceId}"`, { reviewerId, sliceId });
  }
}
```

- [ ] Step 2: `git add src/hexagons/review/infrastructure/sqlite-review.repository.ts src/hexagons/review/domain/errors/fresh-reviewer-violation.error.ts && git commit -m "feat(M05-S01/T07): SqliteReviewRepository stub + FreshReviewerViolationError placeholder"`

---

### Task 8: Barrel Exports
**Files:** Create `src/hexagons/review/index.ts`
**Traces to:** AC20
**Deps:** T1-T7

- [ ] Step 1: Create barrel + verify full test suite passes

```typescript
// src/hexagons/review/index.ts

// Domain -- Errors
export { FreshReviewerViolationError } from "./domain/errors/fresh-reviewer-violation.error";

// Domain -- Events
export { ReviewRecordedEvent } from "./domain/events/review-recorded.event";

// Domain -- Ports
export { ReviewRepositoryPort } from "./domain/ports/review-repository.port";

// Domain -- Aggregates & Value Objects
export { Review } from "./domain/review.aggregate";
export { MergedReview } from "./domain/merged-review.vo";

// Domain -- Schemas (values)
export {
  FindingPropsSchema,
  ReviewPropsSchema,
  ReviewRoleSchema,
  ReviewSeveritySchema,
  ReviewVerdictSchema,
  SEVERITY_RANK,
} from "./domain/review.schemas";

export {
  ConflictPropsSchema,
  MergedFindingPropsSchema,
  MergedReviewPropsSchema,
} from "./domain/merged-review.schemas";

// Domain -- Schemas (types)
export type {
  FindingProps,
  ReviewProps,
  ReviewRole,
  ReviewSeverity,
  ReviewVerdict,
} from "./domain/review.schemas";

export type {
  ConflictProps,
  MergedFindingProps,
  MergedReviewProps,
} from "./domain/merged-review.schemas";

// Domain -- Builders
export { FindingBuilder } from "./domain/finding.builder";
export { ReviewBuilder } from "./domain/review.builder";

// Infrastructure -- Adapters
export { InMemoryReviewRepository } from "./infrastructure/in-memory-review.repository";
export { SqliteReviewRepository } from "./infrastructure/sqlite-review.repository";
```

- [ ] Step 2: Run `npx vitest run src/hexagons/review/`, verify ALL tests pass
- [ ] Step 3: Run `npx tsc --noEmit`, verify 0 errors
- [ ] Step 4: Run `npx biome check src/hexagons/review/`, verify 0 errors
- [ ] Step 5: `git add src/hexagons/review/index.ts && git commit -m "feat(M05-S01/T08): barrel exports for review hexagon"`

---

## Wave Structure

| Wave | Tasks | Rationale |
|---|---|---|
| 1 | T1 | Schemas (foundation — no dependencies) |
| 2 | T2, T3 | Event + aggregate (both need schemas) |
| 3 | T4, T5, T6 | Builders, MergedReview VO, InMemory repo (all need aggregate) |
| 4 | T7, T8 | SQLite stub + barrel (need everything) |
