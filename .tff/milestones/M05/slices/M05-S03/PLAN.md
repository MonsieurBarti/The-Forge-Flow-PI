# M05-S03: Critique-then-Reflection — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Two-pass review pattern (exhaustive critique → meta-analysis/prioritization) for code-reviewer + security-auditor roles.
**Architecture:** Extends review hexagon (`src/hexagons/review/`) — new schemas, domain service, application-layer prompt builder, prompt template resource.
**Tech Stack:** Zod, Vitest, @faker-js/faker

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/hexagons/review/domain/review.schemas.ts` | MODIFY | Add `FindingImpactSchema`, `ReviewStrategySchema`, optional `impact` on `FindingPropsSchema` |
| `src/hexagons/review/domain/review.schemas.spec.ts` | MODIFY | Add tests for new schemas + backward compat |
| `src/hexagons/review/domain/finding.builder.ts` | MODIFY | Add `withId()`, `withImpact()` setters |
| `src/hexagons/review/domain/builders.spec.ts` | MODIFY | Add tests for `withId()`, `withImpact()` |
| `src/hexagons/review/domain/review-strategy.ts` | CREATE | `ROLE_STRATEGY_MAP`, `strategyForRole()` |
| `src/hexagons/review/domain/review-strategy.spec.ts` | CREATE | Strategy mapping tests |
| `src/hexagons/review/domain/critique-reflection.schemas.ts` | CREATE | CTR result schemas, `ProcessedReviewResultSchema` |
| `src/hexagons/review/domain/critique-reflection.schemas.spec.ts` | CREATE | Schema validation tests |
| `src/hexagons/review/domain/critique-reflection.builder.ts` | CREATE | `CritiqueReflectionResultBuilder` |
| `src/hexagons/review/domain/errors/critique-reflection.error.ts` | CREATE | `CritiqueReflectionError` |
| `src/hexagons/review/domain/services/critique-reflection.service.ts` | CREATE | `CritiqueReflectionService.processResult()` |
| `src/hexagons/review/domain/services/critique-reflection.service.spec.ts` | CREATE | Service unit tests (5 invariants) |
| `src/hexagons/review/application/review-prompt-builder.ts` | CREATE | `ReviewPromptBuilder` |
| `src/hexagons/review/application/review-prompt-builder.spec.ts` | CREATE | Prompt builder unit tests |
| `src/resources/prompts/critique-then-reflection.md` | CREATE | Two-pass prompt template |
| `src/hexagons/review/index.ts` | MODIFY | Add new exports |

---

## Wave 0 (parallel — schemas + error + strategy + template, no dependencies)

### T01: Schema extensions — FindingImpactSchema + ReviewStrategySchema
**Files:** Modify `src/hexagons/review/domain/review.schemas.ts`, Modify `src/hexagons/review/domain/review.schemas.spec.ts`
**Traces to:** AC1, AC2, AC3, AC5

- [ ] Step 1: Write failing tests

```typescript
// src/hexagons/review/domain/review.schemas.spec.ts — ADD to existing file

import {
  // ... existing imports ...
  FindingImpactSchema,
  ReviewStrategySchema,
} from "./review.schemas";

describe("FindingImpactSchema", () => {
  it("accepts all 3 valid impact levels", () => {
    for (const level of ["must-fix", "should-fix", "nice-to-have"]) {
      expect(FindingImpactSchema.parse(level)).toBe(level);
    }
  });

  it("rejects invalid impact", () => {
    expect(() => FindingImpactSchema.parse("critical")).toThrow();
    expect(() => FindingImpactSchema.parse("optional")).toThrow();
  });
});

describe("ReviewStrategySchema", () => {
  it("accepts valid strategies", () => {
    for (const s of ["standard", "critique-then-reflection"]) {
      expect(ReviewStrategySchema.parse(s)).toBe(s);
    }
  });

  it("rejects invalid strategy", () => {
    expect(() => ReviewStrategySchema.parse("two-pass")).toThrow();
  });
});

describe("FindingPropsSchema — impact field", () => {
  const base = {
    id: faker.string.uuid(),
    severity: "high",
    message: "Test finding",
    filePath: "src/foo.ts",
    lineStart: 10,
  };

  it("accepts finding without impact (backward-compatible)", () => {
    const result = FindingPropsSchema.parse(base);
    expect(result.impact).toBeUndefined();
  });

  it("accepts finding with valid impact", () => {
    const result = FindingPropsSchema.parse({ ...base, impact: "must-fix" });
    expect(result.impact).toBe("must-fix");
  });

  it("allows severity:low + impact:must-fix (independent dimensions)", () => {
    const result = FindingPropsSchema.parse({ ...base, severity: "low", impact: "must-fix" });
    expect(result.severity).toBe("low");
    expect(result.impact).toBe("must-fix");
  });

  it("rejects invalid impact value", () => {
    expect(() => FindingPropsSchema.parse({ ...base, impact: "blocker" })).toThrow();
  });
});
```

- [ ] Step 2: Run `npx vitest run src/hexagons/review/domain/review.schemas.spec.ts`, verify FAIL — `FindingImpactSchema` and `ReviewStrategySchema` not exported

- [ ] Step 3: Implement schemas

```typescript
// src/hexagons/review/domain/review.schemas.ts — ADD after existing schemas

export const FindingImpactSchema = z.enum(["must-fix", "should-fix", "nice-to-have"]);
export type FindingImpact = z.infer<typeof FindingImpactSchema>;

export const ReviewStrategySchema = z.enum(["standard", "critique-then-reflection"]);
export type ReviewStrategy = z.infer<typeof ReviewStrategySchema>;
```

And modify `FindingPropsSchema` to add optional `impact`:

```typescript
// src/hexagons/review/domain/review.schemas.ts — MODIFY FindingPropsSchema
export const FindingPropsSchema = z.object({
  id: IdSchema,
  severity: ReviewSeveritySchema,
  message: z.string().min(1),
  filePath: z.string().min(1),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive().optional(),
  suggestion: z.string().optional(),
  ruleId: z.string().optional(),
  impact: FindingImpactSchema.optional(),
});
```

- [ ] Step 4: Run `npx vitest run src/hexagons/review/domain/review.schemas.spec.ts`, verify PASS
- [ ] Step 5: Commit `feat(S03/T01): FindingImpactSchema + ReviewStrategySchema + impact field on FindingPropsSchema`

---

## Wave 1 (depends on T01 — builder + CTR schemas need FindingImpactSchema)

### T02: FindingBuilder — withId + withImpact
**Files:** Modify `src/hexagons/review/domain/finding.builder.ts`, Modify `src/hexagons/review/domain/builders.spec.ts`
**Traces to:** AC19
**Depends on:** T01 (needs `FindingImpact` type from `review.schemas.ts`)

- [ ] Step 1: Write failing tests

```typescript
// src/hexagons/review/domain/builders.spec.ts — ADD to FindingBuilder describe block

it("withId sets custom ID", () => {
  const id = faker.string.uuid();
  const finding = new FindingBuilder().withId(id).build();
  expect(finding.id).toBe(id);
});

it("withImpact sets impact field", () => {
  const finding = new FindingBuilder().withImpact("must-fix").build();
  expect(finding.impact).toBe("must-fix");
});

it("build without withImpact produces undefined impact", () => {
  const finding = new FindingBuilder().build();
  expect(finding.impact).toBeUndefined();
});
```

- [ ] Step 2: Run `npx vitest run src/hexagons/review/domain/builders.spec.ts`, verify FAIL — `withId` and `withImpact` not defined

- [ ] Step 3: Implement

```typescript
// src/hexagons/review/domain/finding.builder.ts — ADD fields + methods
import type { FindingImpact, FindingProps, ReviewSeverity } from "./review.schemas";

// ADD private field:
private _impact?: FindingImpact;

// ADD methods:
withId(id: string): this {
  this._id = id;
  return this;
}
withImpact(impact: FindingImpact): this {
  this._impact = impact;
  return this;
}

// MODIFY build() to include impact:
build(): FindingProps {
  return {
    id: this._id,
    severity: this._severity,
    message: this._message,
    filePath: this._filePath,
    lineStart: this._lineStart,
    lineEnd: this._lineEnd,
    suggestion: this._suggestion,
    ruleId: this._ruleId,
    impact: this._impact,
  };
}
```

- [ ] Step 4: Run `npx vitest run src/hexagons/review/domain/builders.spec.ts`, verify PASS
- [ ] Step 5: Commit `feat(S03/T02): FindingBuilder.withId() + withImpact()`

---

### T03: CritiqueReflectionError
**Files:** Create `src/hexagons/review/domain/errors/critique-reflection.error.ts`
**Traces to:** AC10 (error code)

- [ ] Step 1: Implement (no separate test file — error is trivial, tested via service tests)

```typescript
// src/hexagons/review/domain/errors/critique-reflection.error.ts
import { BaseDomainError } from "@kernel";

export class CritiqueReflectionError extends BaseDomainError {
  readonly code = "REVIEW.CRITIQUE_REFLECTION_FAILED";

  constructor(message: string, cause?: Error) {
    super(message, { cause: cause?.message });
  }
}
```

- [ ] Step 2: Run `npx vitest run src/hexagons/review/`, verify existing tests still PASS
- [ ] Step 3: Commit `feat(S03/T03): CritiqueReflectionError domain error`

---

### T04: ReviewStrategy mapping
**Files:** Create `src/hexagons/review/domain/review-strategy.ts`, Create `src/hexagons/review/domain/review-strategy.spec.ts`
**Traces to:** AC6, AC7, AC8

- [ ] Step 1: Write failing test

```typescript
// src/hexagons/review/domain/review-strategy.spec.ts
import { describe, expect, it } from "vitest";
import { strategyForRole } from "./review-strategy";

describe("strategyForRole", () => {
  it("returns critique-then-reflection for code-reviewer", () => {
    expect(strategyForRole("code-reviewer")).toBe("critique-then-reflection");
  });

  it("returns critique-then-reflection for security-auditor", () => {
    expect(strategyForRole("security-auditor")).toBe("critique-then-reflection");
  });

  it("returns standard for spec-reviewer", () => {
    expect(strategyForRole("spec-reviewer")).toBe("standard");
  });
});
```

- [ ] Step 2: Run `npx vitest run src/hexagons/review/domain/review-strategy.spec.ts`, verify FAIL

- [ ] Step 3: Implement

```typescript
// src/hexagons/review/domain/review-strategy.ts
import type { ReviewRole, ReviewStrategy } from "./review.schemas";

const ROLE_STRATEGY_MAP: Record<ReviewRole, ReviewStrategy> = {
  "code-reviewer": "critique-then-reflection",
  "security-auditor": "critique-then-reflection",
  "spec-reviewer": "standard",
} as const;

export function strategyForRole(role: ReviewRole): ReviewStrategy {
  return ROLE_STRATEGY_MAP[role];
}
```

- [ ] Step 4: Run `npx vitest run src/hexagons/review/domain/review-strategy.spec.ts`, verify PASS
- [ ] Step 5: Commit `feat(S03/T04): ReviewStrategy role-to-strategy mapping`

---

### T05: CritiqueReflectionResultSchema + ProcessedReviewResultSchema
**Files:** Create `src/hexagons/review/domain/critique-reflection.schemas.ts`, Create `src/hexagons/review/domain/critique-reflection.schemas.spec.ts`
**Traces to:** AC4, AC9 (schema shape)

- [ ] Step 1: Write failing tests

```typescript
// src/hexagons/review/domain/critique-reflection.schemas.spec.ts
import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";
import {
  CritiquePassResultSchema,
  CritiqueReflectionResultSchema,
  ProcessedReviewResultSchema,
  ReflectionInsightSchema,
  ReflectionPassResultSchema,
} from "./critique-reflection.schemas";

const makeFinding = (overrides = {}) => ({
  id: faker.string.uuid(),
  severity: "medium",
  message: faker.lorem.sentence(),
  filePath: `src/${faker.system.fileName()}`,
  lineStart: faker.number.int({ min: 1, max: 500 }),
  ...overrides,
});

describe("CritiquePassResultSchema", () => {
  it("accepts valid critique pass with findings", () => {
    const result = CritiquePassResultSchema.parse({
      rawFindings: [makeFinding(), makeFinding()],
    });
    expect(result.rawFindings).toHaveLength(2);
  });

  it("accepts empty rawFindings", () => {
    const result = CritiquePassResultSchema.parse({ rawFindings: [] });
    expect(result.rawFindings).toHaveLength(0);
  });
});

describe("ReflectionInsightSchema", () => {
  it("accepts valid insight", () => {
    const result = ReflectionInsightSchema.parse({
      theme: "Error handling inconsistency",
      affectedFindings: [faker.string.uuid()],
      recommendation: "Standardize error handling across modules",
    });
    expect(result.theme).toBe("Error handling inconsistency");
  });

  it("rejects empty theme", () => {
    expect(() =>
      ReflectionInsightSchema.parse({
        theme: "",
        affectedFindings: [],
        recommendation: "Fix it",
      }),
    ).toThrow();
  });
});

describe("ReflectionPassResultSchema", () => {
  it("requires impact on prioritized findings", () => {
    expect(() =>
      ReflectionPassResultSchema.parse({
        prioritizedFindings: [makeFinding()], // no impact
        insights: [],
        summary: "All good",
      }),
    ).toThrow();
  });

  it("accepts findings with impact", () => {
    const result = ReflectionPassResultSchema.parse({
      prioritizedFindings: [makeFinding({ impact: "must-fix" })],
      insights: [],
      summary: "One critical issue found",
    });
    expect(result.prioritizedFindings[0].impact).toBe("must-fix");
  });
});

describe("CritiqueReflectionResultSchema", () => {
  it("accepts full valid CTR result", () => {
    const findingId = faker.string.uuid();
    const result = CritiqueReflectionResultSchema.parse({
      critique: { rawFindings: [makeFinding({ id: findingId })] },
      reflection: {
        prioritizedFindings: [makeFinding({ id: findingId, impact: "should-fix" })],
        insights: [{ theme: "Test coverage", affectedFindings: [findingId], recommendation: "Add edge cases" }],
        summary: "Minor issues only",
      },
    });
    expect(result.critique.rawFindings).toHaveLength(1);
    expect(result.reflection.prioritizedFindings).toHaveLength(1);
  });
});

describe("ProcessedReviewResultSchema", () => {
  it("requires impact on all findings", () => {
    expect(() =>
      ProcessedReviewResultSchema.parse({
        findings: [makeFinding()], // no impact
        insights: [],
        summary: "Done",
      }),
    ).toThrow();
  });

  it("accepts valid processed result", () => {
    const result = ProcessedReviewResultSchema.parse({
      findings: [makeFinding({ impact: "nice-to-have" })],
      insights: [],
      summary: "Clean code",
    });
    expect(result.findings[0].impact).toBe("nice-to-have");
  });
});
```

- [ ] Step 2: Run `npx vitest run src/hexagons/review/domain/critique-reflection.schemas.spec.ts`, verify FAIL

- [ ] Step 3: Implement

```typescript
// src/hexagons/review/domain/critique-reflection.schemas.ts
import { IdSchema } from "@kernel";
import { z } from "zod";
import { FindingPropsSchema } from "./review.schemas";

export const CritiquePassResultSchema = z.object({
  rawFindings: z.array(FindingPropsSchema),
});
export type CritiquePassResult = z.infer<typeof CritiquePassResultSchema>;

export const ReflectionInsightSchema = z.object({
  theme: z.string().min(1),
  affectedFindings: z.array(IdSchema),
  recommendation: z.string().min(1),
});
export type ReflectionInsight = z.infer<typeof ReflectionInsightSchema>;

const FindingWithImpactSchema = FindingPropsSchema.required({ impact: true });

export const ReflectionPassResultSchema = z.object({
  prioritizedFindings: z.array(FindingWithImpactSchema),
  insights: z.array(ReflectionInsightSchema),
  summary: z.string().min(1),
});
export type ReflectionPassResult = z.infer<typeof ReflectionPassResultSchema>;

export const CritiqueReflectionResultSchema = z.object({
  critique: CritiquePassResultSchema,
  reflection: ReflectionPassResultSchema,
});
export type CritiqueReflectionResult = z.infer<typeof CritiqueReflectionResultSchema>;

export const ProcessedReviewResultSchema = z.object({
  findings: z.array(FindingWithImpactSchema),
  insights: z.array(ReflectionInsightSchema),
  summary: z.string().min(1),
});
export type ProcessedReviewResult = z.infer<typeof ProcessedReviewResultSchema>;
```

- [ ] Step 4: Run `npx vitest run src/hexagons/review/domain/critique-reflection.schemas.spec.ts`, verify PASS
- [ ] Step 5: Commit `feat(S03/T05): CritiqueReflectionResultSchema + ProcessedReviewResultSchema`

---

### T06: CritiqueReflectionResultBuilder
**Files:** Create `src/hexagons/review/domain/critique-reflection.builder.ts`, Create `src/hexagons/review/domain/critique-reflection.builder.spec.ts`
**Traces to:** AC20

- [ ] Step 1: Write failing tests

```typescript
// src/hexagons/review/domain/critique-reflection.builder.spec.ts
import { describe, expect, it } from "vitest";
import { CritiqueReflectionResultSchema } from "./critique-reflection.schemas";
import { CritiqueReflectionResultBuilder } from "./critique-reflection.builder";

describe("CritiqueReflectionResultBuilder", () => {
  it("produces coordinated IDs: prioritizedFindings IDs match rawFindings IDs (AC20)", () => {
    const result = new CritiqueReflectionResultBuilder().withFindings(3).build();
    const rawIds = result.critique.rawFindings.map((f) => f.id);
    const prioIds = result.reflection.prioritizedFindings.map((f) => f.id);
    expect(prioIds).toEqual(rawIds);
  });

  it("all prioritized findings have impact set", () => {
    const result = new CritiqueReflectionResultBuilder().withFindings(2).build();
    for (const f of result.reflection.prioritizedFindings) {
      expect(f.impact).toBeDefined();
    }
  });

  it("builds schema-valid output", () => {
    const result = new CritiqueReflectionResultBuilder().withFindings(2).build();
    expect(() => CritiqueReflectionResultSchema.parse(result)).not.toThrow();
  });

  it("builds valid output with zero findings", () => {
    const result = new CritiqueReflectionResultBuilder().withRawFindings([]).withSummary("Clean").build();
    result.reflection.insights = [];
    expect(() => CritiqueReflectionResultSchema.parse(result)).not.toThrow();
    expect(result.critique.rawFindings).toHaveLength(0);
  });
});
```

- [ ] Step 2: Run `npx vitest run src/hexagons/review/domain/critique-reflection.builder.spec.ts`, verify FAIL

- [ ] Step 3: Implement builder

```typescript
// src/hexagons/review/domain/critique-reflection.builder.ts
import { faker } from "@faker-js/faker";
import type { FindingImpact, FindingProps } from "./review.schemas";
import { FindingBuilder } from "./finding.builder";
import type { CritiqueReflectionResult, ReflectionInsight } from "./critique-reflection.schemas";

export class CritiqueReflectionResultBuilder {
  private _rawFindings: FindingProps[] = [];
  private _impacts: Map<string, FindingImpact> = new Map();
  private _insights: ReflectionInsight[] = [];
  private _summary: string = faker.lorem.sentence();

  withFindings(count: number): this {
    this._rawFindings = Array.from({ length: count }, () =>
      new FindingBuilder().withId(faker.string.uuid()).build(),
    );
    // Default impacts
    for (const f of this._rawFindings) {
      this._impacts.set(f.id, "should-fix");
    }
    return this;
  }

  withRawFindings(findings: FindingProps[]): this {
    this._rawFindings = findings;
    for (const f of findings) {
      if (!this._impacts.has(f.id)) {
        this._impacts.set(f.id, "should-fix");
      }
    }
    return this;
  }

  withImpact(findingId: string, impact: FindingImpact): this {
    this._impacts.set(findingId, impact);
    return this;
  }

  withInsights(insights: ReflectionInsight[]): this {
    this._insights = insights;
    return this;
  }

  withSummary(summary: string): this {
    this._summary = summary;
    return this;
  }

  build(): CritiqueReflectionResult {
    const prioritizedFindings = this._rawFindings.map((f) => ({
      ...f,
      impact: this._impacts.get(f.id) ?? "should-fix",
    }));

    return {
      critique: { rawFindings: this._rawFindings },
      reflection: {
        prioritizedFindings,
        insights: this._insights.length > 0
          ? this._insights
          : this._rawFindings.length > 0
            ? [{ theme: "General", affectedFindings: this._rawFindings.map((f) => f.id), recommendation: "Review" }]
            : [],
        summary: this._summary,
      },
    };
  }
}
```

- [ ] Step 2: Run `npx vitest run src/hexagons/review/`, verify existing tests PASS
- [ ] Step 3: Commit `feat(S03/T06): CritiqueReflectionResultBuilder`

---

## Wave 2 (depends on Wave 1 — service depends on CTR schemas + error + builder)

### T07: CritiqueReflectionService
**Files:** Create `src/hexagons/review/domain/services/critique-reflection.service.ts`, Create `src/hexagons/review/domain/services/critique-reflection.service.spec.ts`
**Traces to:** AC9, AC10, AC11, AC12, AC13, AC14

- [ ] Step 1: Write failing tests

```typescript
// src/hexagons/review/domain/services/critique-reflection.service.spec.ts
import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";
import { isErr, isOk } from "@kernel";
import { CritiqueReflectionResultBuilder } from "../critique-reflection.builder";
import { FindingBuilder } from "../finding.builder";
import { CritiqueReflectionService } from "./critique-reflection.service";

describe("CritiqueReflectionService", () => {
  const service = new CritiqueReflectionService();

  describe("processResult — happy path", () => {
    it("returns Ok with processed result for valid CTR output (AC9)", () => {
      const ctr = new CritiqueReflectionResultBuilder().withFindings(3).build();
      const result = service.processResult(ctr);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data.findings).toHaveLength(3);
        expect(result.data.findings.every((f) => f.impact !== undefined)).toBe(true);
        expect(result.data.summary).toBeTruthy();
      }
    });

    it("returns Ok for empty findings — clean review (AC14)", () => {
      const ctr = new CritiqueReflectionResultBuilder()
        .withRawFindings([])
        .withSummary("No issues found")
        .build();
      // Manually fix: empty findings means empty insights too
      ctr.reflection.insights = [];
      const result = service.processResult(ctr);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data.findings).toHaveLength(0);
      }
    });
  });

  describe("processResult — invariant violations", () => {
    it("rejects invented finding IDs (AC10)", () => {
      const f1 = new FindingBuilder().withId(faker.string.uuid()).build();
      const inventedId = faker.string.uuid();
      const ctr = {
        critique: { rawFindings: [f1] },
        reflection: {
          prioritizedFindings: [{ ...f1, id: inventedId, impact: "must-fix" as const }],
          insights: [],
          summary: "Found issues",
        },
      };
      const result = service.processResult(ctr);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe("REVIEW.CRITIQUE_REFLECTION_FAILED");
        expect(result.error.message).toContain("invented");
      }
    });

    it("rejects omitted findings (AC11)", () => {
      const f1 = new FindingBuilder().withId(faker.string.uuid()).build();
      const f2 = new FindingBuilder().withId(faker.string.uuid()).build();
      const ctr = {
        critique: { rawFindings: [f1, f2] },
        reflection: {
          prioritizedFindings: [{ ...f1, impact: "must-fix" as const }],
          insights: [],
          summary: "Partial",
        },
      };
      const result = service.processResult(ctr);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain("missing");
      }
    });

    it("rejects malformed input (AC12)", () => {
      const result = service.processResult({ garbage: true });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe("REVIEW.CRITIQUE_REFLECTION_FAILED");
      }
    });

    it("rejects phantom insight references (AC13)", () => {
      const f1 = new FindingBuilder().withId(faker.string.uuid()).build();
      const phantomId = faker.string.uuid();
      const ctr = {
        critique: { rawFindings: [f1] },
        reflection: {
          prioritizedFindings: [{ ...f1, impact: "should-fix" as const }],
          insights: [{ theme: "Phantom", affectedFindings: [phantomId], recommendation: "Fix" }],
          summary: "Issues found",
        },
      };
      const result = service.processResult(ctr);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain("phantom");
      }
    });
  });
});
```

- [ ] Step 2: Run `npx vitest run src/hexagons/review/domain/services/critique-reflection.service.spec.ts`, verify FAIL

- [ ] Step 3: Implement

```typescript
// src/hexagons/review/domain/services/critique-reflection.service.ts
import { type Result, err, ok } from "@kernel";
import {
  CritiqueReflectionResultSchema,
  type ProcessedReviewResult,
} from "../critique-reflection.schemas";
import { CritiqueReflectionError } from "../errors/critique-reflection.error";

export class CritiqueReflectionService {
  processResult(rawResult: unknown): Result<ProcessedReviewResult, CritiqueReflectionError> {
    // Invariant 1: Parse against schema
    const parsed = CritiqueReflectionResultSchema.safeParse(rawResult);
    if (!parsed.success) {
      return err(new CritiqueReflectionError(
        `Malformed CTR output: ${parsed.error.message}`,
        parsed.error,
      ));
    }

    const { critique, reflection } = parsed.data;
    const rawIds = new Set(critique.rawFindings.map((f) => f.id));
    const prioIds = new Set(reflection.prioritizedFindings.map((f) => f.id));

    // Invariant 2: No invented findings
    for (const id of prioIds) {
      if (!rawIds.has(id)) {
        return err(new CritiqueReflectionError(
          `Reflection contains invented finding ID: ${id}`,
        ));
      }
    }

    // Invariant 3: All findings accounted for
    if (prioIds.size !== rawIds.size) {
      const missing = [...rawIds].filter((id) => !prioIds.has(id));
      return err(new CritiqueReflectionError(
        `Reflection is missing ${missing.length} finding(s) from critique: ${missing.join(", ")}`,
      ));
    }

    // Invariant 5: No phantom insight references
    for (const insight of reflection.insights) {
      for (const refId of insight.affectedFindings) {
        if (!rawIds.has(refId)) {
          return err(new CritiqueReflectionError(
            `Insight "${insight.theme}" references phantom finding ID: ${refId}`,
          ));
        }
      }
    }

    return ok({
      findings: reflection.prioritizedFindings,
      insights: reflection.insights,
      summary: reflection.summary,
    });
  }
}
```

- [ ] Step 4: Run `npx vitest run src/hexagons/review/domain/services/critique-reflection.service.spec.ts`, verify PASS
- [ ] Step 5: Commit `feat(S03/T07): CritiqueReflectionService with 5 invariants`

---

## Wave 3 (depends on Wave 2 — prompt builder depends on strategy + CTR schemas)

### T08: Prompt template
**Files:** Create `src/resources/prompts/critique-then-reflection.md`
**Traces to:** AC21

- [ ] Step 1: Create prompt template

```markdown
# Review: {{sliceLabel}} — {{sliceTitle}}

You are reviewing code changes for slice {{sliceId}}.
Role: {{reviewRole}}

## Instructions

Execute a TWO-PASS review. Both passes are mandatory.

### PASS 1 — EXHAUSTIVE CRITIQUE

Identify ALL issues. Do not prioritize, filter, or self-censor.
∀ issue found: report it, even if minor.

Categories to check:
- Correctness (logic errors, edge cases, off-by-one)
- Architecture (hexagonal boundaries, port violations, coupling)
- Testing (coverage gaps, missing edge cases, brittle assertions)
- Security (injection, exposure, unsafe operations)
- Performance (unnecessary allocations, O(n^2) where O(n) possible)
- Style (naming, consistency, readability)

∀ finding: provide id (UUID), filePath, lineStart, lineEnd (optional), severity (critical|high|medium|low|info), message, suggestion (optional), ruleId (optional).

### PASS 2 — REFLECTION & PRIORITIZATION

Re-read your Pass 1 findings. Now meta-analyze:

1. **Group by theme** — which findings share a root cause?
2. **Assign impact** — ∀ finding from Pass 1: must-fix | should-fix | nice-to-have
   - must-fix: blocks merge, systemic risk, correctness bug
   - should-fix: meaningful quality improvement
   - nice-to-have: style, cosmetic, optional
3. **Synthesize insights** — what patterns emerge? Reference finding IDs.
4. **Write executive summary** — 2-3 sentences, key concerns only.

Impact is INDEPENDENT from severity. A low-severity style issue affecting 8 files is must-fix. A high-severity edge case in dead code is nice-to-have.

## Output Format

Return JSON matching this schema exactly:

{{outputSchema}}

## Context

### Changed Files
{{changedFiles}}

### Acceptance Criteria
{{acceptanceCriteria}}
```

- [ ] Step 2: Verify file exists: `ls src/resources/prompts/critique-then-reflection.md`
- [ ] Step 3: Commit `feat(S03/T08): critique-then-reflection prompt template`

---

### T09: ReviewPromptBuilder
**Files:** Create `src/hexagons/review/application/review-prompt-builder.ts`, Create `src/hexagons/review/application/review-prompt-builder.spec.ts`
**Traces to:** AC15, AC16, AC17, AC18

- [ ] Step 1: Write failing tests

```typescript
// src/hexagons/review/application/review-prompt-builder.spec.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ReviewPromptBuilder } from "./review-prompt-builder";
import type { ReviewPromptConfig } from "./review-prompt-builder";

const TEMPLATE_PATH = join(import.meta.dirname, "../../../resources/prompts/critique-then-reflection.md");
const realLoader = (path: string) => readFileSync(join(import.meta.dirname, "../../../resources", path), "utf-8");

const baseConfig: ReviewPromptConfig = {
  sliceId: "slice-123",
  sliceLabel: "M05-S03",
  sliceTitle: "Critique-then-reflection",
  role: "code-reviewer",
  changedFiles: "- src/foo.ts\n- src/bar.ts",
  acceptanceCriteria: "- AC1: Must pass",
};

describe("ReviewPromptBuilder", () => {
  it("builds CTR prompt for code-reviewer with PASS 1 and PASS 2 (AC15)", () => {
    const builder = new ReviewPromptBuilder(realLoader);
    const prompt = builder.build(baseConfig);
    expect(prompt).toContain("PASS 1");
    expect(prompt).toContain("PASS 2");
    expect(prompt).toContain('"critique"');  // JSON schema block
  });

  it("builds CTR prompt for security-auditor (AC18)", () => {
    const builder = new ReviewPromptBuilder(realLoader);
    const prompt = builder.build({ ...baseConfig, role: "security-auditor" });
    expect(prompt).toContain("PASS 1");
    expect(prompt).toContain("security-auditor");
  });

  it("builds standard prompt for spec-reviewer without two-pass (AC16)", () => {
    const builder = new ReviewPromptBuilder(realLoader);
    const prompt = builder.build({ ...baseConfig, role: "spec-reviewer" });
    expect(prompt).not.toContain("PASS 1");
    expect(prompt).not.toContain("PASS 2");
  });

  it("interpolates all placeholders — no raw {{...}} tokens (AC17)", () => {
    const builder = new ReviewPromptBuilder(realLoader);
    const prompt = builder.build(baseConfig);
    expect(prompt).not.toMatch(/\{\{.*?\}\}/);
  });

  it("includes slice context in output", () => {
    const builder = new ReviewPromptBuilder(realLoader);
    const prompt = builder.build(baseConfig);
    expect(prompt).toContain("M05-S03");
    expect(prompt).toContain("slice-123");
    expect(prompt).toContain("src/foo.ts");
  });

  it("uses injected template loader", () => {
    let loadedPath = "";
    const spyLoader = (path: string) => {
      loadedPath = path;
      return "# Mock template\n{{sliceLabel}} {{reviewRole}}";
    };
    const builder = new ReviewPromptBuilder(spyLoader);
    builder.build(baseConfig);
    expect(loadedPath).toBe("prompts/critique-then-reflection.md");
  });
});
```

- [ ] Step 2: Run `npx vitest run src/hexagons/review/application/review-prompt-builder.spec.ts`, verify FAIL

- [ ] Step 3: Implement

```typescript
// src/hexagons/review/application/review-prompt-builder.ts
import { toJSONSchema } from "zod";
import { CritiqueReflectionResultSchema } from "../domain/critique-reflection.schemas";
import type { ReviewRole } from "../domain/review.schemas";
import { strategyForRole } from "../domain/review-strategy";

export interface ReviewPromptConfig {
  readonly sliceId: string;
  readonly sliceLabel: string;
  readonly sliceTitle: string;
  readonly role: ReviewRole;
  readonly changedFiles: string;
  readonly acceptanceCriteria: string;
}

export class ReviewPromptBuilder {
  constructor(private readonly templateLoader: (path: string) => string) {}

  build(config: ReviewPromptConfig): string {
    const strategy = strategyForRole(config.role);

    if (strategy === "critique-then-reflection") {
      return this.buildCTR(config);
    }
    return this.buildStandard(config);
  }

  private buildCTR(config: ReviewPromptConfig): string {
    const template = this.templateLoader("prompts/critique-then-reflection.md");
    const outputSchema = JSON.stringify(
      toJSONSchema(CritiqueReflectionResultSchema),
      null,
      2,
    );

    return template
      .replace(/\{\{sliceLabel\}\}/g, config.sliceLabel)
      .replace(/\{\{sliceTitle\}\}/g, config.sliceTitle)
      .replace(/\{\{sliceId\}\}/g, config.sliceId)
      .replace(/\{\{reviewRole\}\}/g, config.role)
      .replace(/\{\{outputSchema\}\}/g, outputSchema)
      .replace(/\{\{changedFiles\}\}/g, config.changedFiles)
      .replace(/\{\{acceptanceCriteria\}\}/g, config.acceptanceCriteria);
  }

  private buildStandard(config: ReviewPromptConfig): string {
    return [
      `# Review: ${config.sliceLabel} — ${config.sliceTitle}`,
      `Role: ${config.role}`,
      `Slice: ${config.sliceId}`,
      "",
      "## Changed Files",
      config.changedFiles,
      "",
      "## Acceptance Criteria",
      config.acceptanceCriteria,
    ].join("\n");
  }
}
```

- [ ] Step 4: Run `npx vitest run src/hexagons/review/application/review-prompt-builder.spec.ts`, verify PASS
- [ ] Step 5: Commit `feat(S03/T09): ReviewPromptBuilder with CTR + standard paths`

---

## Wave 4 (depends on all prior — barrel exports + integration)

### T10: Barrel exports update
**Files:** Modify `src/hexagons/review/index.ts`
**Traces to:** AC22

- [ ] Step 1: Update barrel exports

```typescript
// src/hexagons/review/index.ts — ADD new exports

// Domain -- Errors
export { CritiqueReflectionError } from "./domain/errors/critique-reflection.error";

// Domain -- Schemas (CTR)
export type {
  CritiquePassResult,
  CritiqueReflectionResult,
  ProcessedReviewResult,
  ReflectionInsight,
  ReflectionPassResult,
} from "./domain/critique-reflection.schemas";
export {
  CritiquePassResultSchema,
  CritiqueReflectionResultSchema,
  ProcessedReviewResultSchema,
  ReflectionInsightSchema,
  ReflectionPassResultSchema,
} from "./domain/critique-reflection.schemas";

// Domain -- Schemas (types — add new types)
export type { FindingImpact, ReviewStrategy } from "./domain/review.schemas";
// Domain -- Schemas (values — add new schemas)
export { FindingImpactSchema, ReviewStrategySchema } from "./domain/review.schemas";

// Domain -- Strategy
export { strategyForRole } from "./domain/review-strategy";

// Domain -- Services
export { CritiqueReflectionService } from "./domain/services/critique-reflection.service";

// Domain -- Builders
export { CritiqueReflectionResultBuilder } from "./domain/critique-reflection.builder";

// Application
export { ReviewPromptBuilder } from "./application/review-prompt-builder";
export type { ReviewPromptConfig } from "./application/review-prompt-builder";
```

- [ ] Step 2: Run `npx vitest run src/hexagons/review/`, verify ALL tests PASS
- [ ] Step 3: Run `npx biome check src/hexagons/review/`, verify no lint errors
- [ ] Step 4: Commit `feat(S03/T10): barrel exports for critique-then-reflection`

---

### T11: Import boundary verification
**Files:** Modify or verify `src/hexagons/review/integration/import-boundary.spec.ts`
**Traces to:** AC22 (architectural correctness)

- [ ] Step 1: Run existing import boundary test to confirm no cross-hexagon violations

```bash
npx vitest run src/hexagons/review/integration/import-boundary.spec.ts
```

- [ ] Step 2: Extend boundary test to cover `application/` layer — verify `review-prompt-builder.ts` does not import from other hexagons (only from `../domain/` and `zod`)
- [ ] Step 3: Run full review hexagon test suite: `npx vitest run src/hexagons/review/`
- [ ] Step 4: Commit `test(S03/T11): import boundary verification for CTR additions`
