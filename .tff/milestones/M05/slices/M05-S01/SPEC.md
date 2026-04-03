# M05-S01: Review Entity + Repository

## Goal

∀ review hexagon: establish domain model — `Review` aggregate, `MergedReview` VO, schemas, ports, events, repository adapters, builders. Foundation for S02-S05 ∧ S07/S09.

## Scope

### In Scope
- `Review` aggregate (AggregateRoot pattern)
- `MergedReview` value object (dedup + conflict detection)
- Zod schemas: Finding, Review, MergedReview, Conflict
- `ReviewRepositoryPort` (abstract class)
- `InMemoryReviewRepository` + `SqliteReviewRepository`
- `ReviewRecordedEvent` domain event
- `ReviewBuilder` + `FindingBuilder` (test data)
- Barrel exports (`index.ts`)

### Out of Scope
- Fresh-reviewer enforcement (S02)
- Critique-then-reflection (S03)
- Multi-stage pipeline / ConductReviewUseCase (S04)
- Review UI port (S05)
- Agent authoring (S06)
- Fixer behavior (S07)

## Design

### Schemas

```typescript
// review.schemas.ts
ReviewSeveritySchema = z.enum(["critical", "high", "medium", "low", "info"]);
ReviewVerdictSchema = z.enum(["approved", "changes_requested", "rejected"]);
ReviewRoleSchema = z.enum(["code-reviewer", "spec-reviewer", "security-auditor"]);

FindingPropsSchema = z.object({
  id: IdSchema,
  severity: ReviewSeveritySchema,
  message: z.string().min(1),
  filePath: z.string().min(1),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive().optional(),
  suggestion: z.string().optional(),
  ruleId: z.string().optional(),
});

ReviewPropsSchema = z.object({
  id: IdSchema,
  sliceId: IdSchema,
  role: ReviewRoleSchema,
  agentIdentity: z.string().min(1),
  verdict: ReviewVerdictSchema,
  findings: z.array(FindingPropsSchema),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
```

```typescript
// merged-review.schemas.ts
MergedFindingPropsSchema = FindingPropsSchema.extend({
  sourceReviewIds: z.array(IdSchema).min(1),
});

ConflictPropsSchema = z.object({
  filePath: z.string().min(1),
  lineStart: z.number().int().positive(),
  description: z.string().min(1),
  reviewerVerdicts: z.array(z.object({
    reviewId: IdSchema,
    role: ReviewRoleSchema,
    severity: ReviewSeveritySchema,
  })).min(2),
});

MergedReviewPropsSchema = z.object({
  sliceId: IdSchema,
  sourceReviewIds: z.array(IdSchema).min(1),
  verdict: ReviewVerdictSchema,
  findings: z.array(MergedFindingPropsSchema),
  conflicts: z.array(ConflictPropsSchema),
  mergedAt: TimestampSchema,
});
```

### Review Aggregate

```
Review extends AggregateRoot<ReviewProps>
  private constructor(props: ReviewProps)
  static createNew({sliceId, role, agentIdentity, now}) → Review
    verdict = "approved", findings = []
    emits ReviewRecordedEvent
  static reconstitute(props) → Review

  recordFindings(findings: FindingProps[], now: Date) → Result<void, DomainError>
    sets findings, auto-computes verdict via computeVerdict()
    emits ReviewRecordedEvent (updated)
  computeVerdict() → ReviewVerdict
    ∃ finding ∈ findings: severity ∈ {critical, high} → "changes_requested"
    ∀ findings: severity ∈ {medium, low, info} → "approved"
    findings.length = 0 → "approved"
  getBlockerCount() → count(severity ∈ {critical, high})
  getAdvisoryCount() → count(severity ∈ {medium, low, info})
```

### MergedReview Value Object

```
MergedReview extends ValueObject<MergedReviewProps>
  static merge(reviews: Review[], now: Date) → Result<MergedReview, DomainError>
    guard: reviews.length ≥ 1
    guard: ∀ review ∈ reviews: review.sliceId = reviews[0].sliceId
    dedup: group findings by (filePath, lineStart) — lineEnd ignored for grouping
      duplicate → keep highest severity, merge sourceReviewIds
      conflict → same location, severity diff >= 2 levels → add to conflicts[]
    verdict (priority order): ∃ review.verdict = "rejected" → "rejected"
             ∃ review.verdict = "changes_requested" → "changes_requested"
             else → "approved"

  hasBlockers() → ∃ finding: severity ∈ {critical, high}
  hasConflicts() → conflicts.length > 0

  Note: MergedReview is NOT persisted separately. Reconstructed from constituent Reviews via merge() when needed.
```

### Repository Port

```typescript
abstract class ReviewRepositoryPort {
  abstract save(review: Review): Promise<Result<void, PersistenceError>>;
  abstract findById(id: string): Promise<Result<Review | null, PersistenceError>>;
  abstract findBySliceId(sliceId: string): Promise<Result<Review[], PersistenceError>>;
  abstract delete(id: string): Promise<Result<void, PersistenceError>>;
}
```

### Events

```
ReviewRecordedEvent extends DomainEvent
  props: sliceId, role, verdict, findingsCount, blockerCount
  schema-validated constructor (CheckpointSavedEvent pattern)
```

### Infrastructure

**InMemoryReviewRepository:**
- `Map<string, ReviewProps>` backing store
- `seed()`, `reset()` test helpers
- Collocated with SqliteReviewRepository

**SqliteReviewRepository:**
- Table: `reviews(id TEXT PK, slice_id TEXT, role TEXT, agent_identity TEXT, verdict TEXT, findings TEXT, created_at TEXT, updated_at TEXT)`
- `findings` column: JSON-serialized array
- Index on `slice_id` for `findBySliceId()`

### Builders

**ReviewBuilder:** Faker defaults, fluent setters (`withSliceId`, `withRole`, `withVerdict`, `withFindings`, `withAgentIdentity`). Dual `build()` / `buildProps()`.

**FindingBuilder:** Faker defaults (`withSeverity`, `withFilePath`, `withLineStart`, `withMessage`, `withSuggestion`, `withRuleId`). Single `build()` → `FindingProps`.

### Directory Structure

```
src/hexagons/review/
  domain/
    errors/
      fresh-reviewer-violation.error.ts    (placeholder — S02 fills logic)
    events/
      review-recorded.event.ts
    ports/
      review-repository.port.ts
    review.aggregate.ts
    review.schemas.ts
    review.builder.ts
    merged-review.vo.ts
    merged-review.schemas.ts
    finding.builder.ts
  infrastructure/
    in-memory-review.repository.ts
    sqlite-review.repository.ts
  index.ts
```

## Acceptance Criteria

### Review Aggregate
- AC1: `Review.createNew()` → verdict = "approved", findings = [], emits `ReviewRecordedEvent`
- AC2: `Review.recordFindings([critical or high])` → verdict = "changes_requested"
- AC3: `Review.recordFindings([low, info])` → verdict = "approved" (advisory only)
- AC4: `Review.recordFindings()` emits `ReviewRecordedEvent` with updated verdict
- AC5: `Review.reconstitute()` does NOT emit events
- AC6: `Review.getBlockerCount()` counts critical + high; `getAdvisoryCount()` counts medium + low + info

### MergedReview VO
- AC7: `MergedReview.merge()` deduplicates findings by (filePath, lineStart); lineEnd ignored for grouping; highest severity wins
- AC8: `MergedReview.merge()` detects conflicts (same location, severity diff >= 2 levels)
- AC9: `MergedReview.merge([approved, changes_requested])` → verdict = "changes_requested"
- AC10: `MergedReview.merge([approved, rejected])` → verdict = "rejected"
- AC11: `MergedReview.merge([approved, approved])` → verdict = "approved"
- AC12: `MergedReview.merge([])` → Result.error (empty array guard)
- AC13: `MergedReview.merge()` rejects reviews with mismatched `sliceId`
- AC14: `MergedReview.hasBlockers()` ∧ `hasConflicts()` return correct booleans

### Repository
- AC15: Save/findById/delete round-trip on InMemoryReviewRepository
- AC16: `ReviewRepositoryPort.findBySliceId()` returns all reviews for a slice
- AC17: `SqliteReviewRepository` persists + loads findings as JSON round-trip [DEFERRED — stub only, consistent with all other hexagons; real implementation in M07]

### Schemas ∧ Builders
- AC18: `ReviewBuilder` + `FindingBuilder` produce valid schema-conformant data
- AC19: All 5 severity levels validated via Zod; invalid values rejected
- AC20: Barrel exports: Review, MergedReview, schemas, types, ports, events, adapters, builders (no internal constructors)

## Dependencies

- `@kernel`: AggregateRoot, ValueObject, DomainEvent, IdSchema, TimestampSchema, Result, PersistenceError
- `better-sqlite3`: SQLite adapter
- `@faker-js/faker`: builders
