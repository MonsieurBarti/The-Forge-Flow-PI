# M05-S03: Critique-then-Reflection

## Problem

Single-pass code reviews produce superficial feedback -- the reviewer finds obvious issues first, runs out of attention budget, and misses systemic patterns. The review aggregate (S01) stores findings but has no mechanism to ensure exhaustive coverage or impact-based prioritization. R04 requires a two-pass pattern: exhaustive critique followed by meta-analysis.

## Approach

Single-agent two-pass prompt with structured output. One reviewer agent session receives a prompt enforcing Pass 1 (exhaustive critique, no filtering) then Pass 2 (meta-analysis, impact annotation, synthesis). Domain service validates the structured output and extracts prioritized findings for the Review aggregate.

Applied to: `code-reviewer` + `security-auditor` roles.
Not applied to: `spec-reviewer` (uses standard single-pass strategy).

## Scope

### In Scope
- `FindingImpactSchema` + optional `impact` field on `FindingPropsSchema`
- `FindingBuilder.withImpact()` setter (backward-compatible extension)
- `ReviewStrategySchema` + role-to-strategy mapping
- `CritiqueReflectionResultSchema` (structured two-pass output)
- `CritiqueReflectionService` (domain service -- validates + extracts)
- `CritiqueReflectionError` (domain error)
- `ReviewPromptBuilder` (application layer -- template interpolation)
- Prompt template: `src/resources/prompts/critique-then-reflection.md`
- `CritiqueReflectionResultBuilder` (test data, coordinates finding IDs across passes)
- Barrel export updates

### Out of Scope
- Agent dispatch / session creation (S04)
- Fixer loop / receiving code review (S07)
- Review UI presentation of insights (S05)
- PR body generation from insights (S09)
- Standard review prompt content (S04 -- S03 only stubs `buildStandard`)
- Persisting insights on Review aggregate (transient output, not domain state)
- Token budget enforcement (settings/overseer concern)
- Composition root wiring (S04)

## Design

### Schema Extensions

#### FindingImpactSchema (new)

```typescript
// review.schemas.ts
FindingImpactSchema = z.enum(["must-fix", "should-fix", "nice-to-have"]);
```

- `must-fix`: blocks merge, systemic risk, correctness bug
- `should-fix`: meaningful quality improvement, not blocking
- `nice-to-have`: cosmetic, style, optional

#### FindingPropsSchema (modified -- backward-compatible)

```typescript
// review.schemas.ts -- add optional field
FindingPropsSchema = z.object({
  id: IdSchema,
  severity: ReviewSeveritySchema,
  message: z.string().min(1),
  filePath: z.string().min(1),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive().optional(),
  suggestion: z.string().optional(),
  ruleId: z.string().optional(),
  impact: FindingImpactSchema.optional(), // NEW
});
```

#### ReviewStrategySchema (new)

```typescript
// review.schemas.ts
ReviewStrategySchema = z.enum(["standard", "critique-then-reflection"]);
```

#### CritiqueReflectionResultSchema (new file)

```typescript
// domain/critique-reflection.schemas.ts
CritiquePassResultSchema = z.object({
  rawFindings: z.array(FindingPropsSchema),
});

ReflectionInsightSchema = z.object({
  theme: z.string().min(1),
  affectedFindings: z.array(IdSchema),
  recommendation: z.string().min(1),
});

ReflectionPassResultSchema = z.object({
  prioritizedFindings: z.array(
    FindingPropsSchema.required({ impact: true })
  ),
  insights: z.array(ReflectionInsightSchema),
  summary: z.string().min(1),
});

CritiqueReflectionResultSchema = z.object({
  critique: CritiquePassResultSchema,
  reflection: ReflectionPassResultSchema,
});
```

### Review Strategy

```typescript
// domain/review-strategy.ts
const ROLE_STRATEGY_MAP: Record<ReviewRole, ReviewStrategy> = {
  "code-reviewer": "critique-then-reflection",
  "security-auditor": "critique-then-reflection",
  "spec-reviewer": "standard",
} as const;

function strategyForRole(role: ReviewRole): ReviewStrategy
```

Pure domain constant. S04 calls `strategyForRole()` to select prompt template per reviewer.

### CritiqueReflectionService (domain service)

```typescript
// domain/services/critique-reflection.service.ts
class CritiqueReflectionService {
  processResult(
    rawResult: unknown
  ): Result<ProcessedReviewResult, CritiqueReflectionError>
}
```

**Invariants:**
1. Parse `rawResult` against `CritiqueReflectionResultSchema`
2. `prioritizedFindings` IDs ⊆ `rawFindings` IDs (no invented findings)
3. |`prioritizedFindings`| = |`rawFindings`| (all findings accounted for)
4. ∀ finding ∈ `prioritizedFindings`: `impact` is set
5. ∀ insight ∈ `insights`: `insight.affectedFindings` ⊆ `rawFindings` IDs (no phantom references)

**Output:**

```typescript
ProcessedReviewResultSchema = z.object({
  findings: z.array(FindingPropsSchema.required({ impact: true })),
  insights: z.array(ReflectionInsightSchema),
  summary: z.string().min(1),
});
```

### CritiqueReflectionError

```typescript
// domain/errors/critique-reflection.error.ts
class CritiqueReflectionError extends BaseDomainError {
  readonly code = "REVIEW.CRITIQUE_REFLECTION_FAILED";
  constructor(message: string, cause?: Error)
}
```

### Insights Lifecycle

`insights` + `summary` from `ProcessedReviewResult` are **transient** -- passed to ReviewUIPort (S05) for presentation and included in PR body (S09). NOT persisted on Review aggregate. Review stores only `findings` (with impact).

### ReviewPromptBuilder (application layer)

```typescript
// review/application/review-prompt-builder.ts
class ReviewPromptBuilder {
  constructor(templateLoader: (path: string) => string)
  build(config: ReviewPromptConfig): string
}

interface ReviewPromptConfig {
  readonly sliceId: string;
  readonly sliceLabel: string;
  readonly sliceTitle: string;
  readonly role: ReviewRole;
  readonly changedFiles: string;
  readonly acceptanceCriteria: string;
}
```

- CTR roles → loads `prompts/critique-then-reflection.md`, interpolates placeholders
- Standard roles → returns minimal placeholder string (stub for S03; S04 provides real content)
- `templateLoader` injected for testability (not hardcoded `loadResource`)
- Note: differs from execution's `PromptBuilder` which receives pre-loaded `templateContent`. Here the builder selects between CTR and standard templates at `build()` time, so the loader must be callable on demand.

### Prompt Template

`src/resources/prompts/critique-then-reflection.md` -- role-agnostic template with:
- Pass 1 instructions (exhaustive critique, categories to check)
- Pass 2 instructions (theme grouping, impact assignment, insight synthesis)
- Output schema (JSON, injected via `{{outputSchema}}`)
- Context placeholders (`{{changedFiles}}`, `{{acceptanceCriteria}}`, `{{reviewRole}}`)

### Directory Structure

```
src/hexagons/review/
  domain/
    critique-reflection.schemas.ts         ← NEW
    critique-reflection.schemas.spec.ts    ← NEW
    review-strategy.ts                     ← NEW
    review-strategy.spec.ts                ← NEW
    review.schemas.ts                      ← MODIFY (impact field)
    finding.builder.ts                     ← MODIFY (add withImpact)
    errors/
      critique-reflection.error.ts         ← NEW
    services/
      critique-reflection.service.ts       ← NEW
      critique-reflection.service.spec.ts  ← NEW
  application/
    review-prompt-builder.ts               ← NEW
    review-prompt-builder.spec.ts          ← NEW
  index.ts                                 ← MODIFY (new exports)

src/resources/
  prompts/
    critique-then-reflection.md            ← NEW
```

## Error Handling

| Scenario | Behavior |
|---|---|
| Agent returns invalid JSON | `CritiqueReflectionError` with parse cause |
| Reflection invents finding IDs | `CritiqueReflectionError` ("invented findings") |
| Reflection omits critique findings | `CritiqueReflectionError` ("missing findings") |
| Agent returns empty findings | Valid -- 0 findings = approved review |
| Standard role passed to CTR service | Caller error -- `strategyForRole()` prevents this |

## Testing Strategy

| Layer | Target | Method |
|---|---|---|
| Schema unit | `CritiqueReflectionResultSchema` | Valid/invalid payloads; impact required in reflection |
| Schema unit | `FindingImpactSchema` | 3 values accepted, invalid rejected |
| Schema unit | `FindingPropsSchema` | Backward compat: findings without impact still parse |
| Domain unit | `strategyForRole()` | code-reviewer → CTR, security-auditor → CTR, spec-reviewer → standard |
| Domain unit | `CritiqueReflectionService.processResult()` | Valid → Ok; invented IDs → error; missing findings → error; phantom insight refs → error; empty findings → Ok; malformed → error |
| Application unit | `ReviewPromptBuilder.build()` | CTR role → CTR template with JSON schema block; standard role → stub; zero `{{...}}` in output |
| Integration | Schema round-trip | Build CTR result → parse → process → verify findings |

## Acceptance Criteria

### Schemas
- AC1: `FindingPropsSchema` accepts findings with and without `impact` (backward-compatible)
- AC2: `FindingImpactSchema` validates exactly `must-fix | should-fix | nice-to-have`
- AC3: `ReviewStrategySchema` validates exactly `standard | critique-then-reflection`
- AC4: `CritiqueReflectionResultSchema` enforces: critique.rawFindings + reflection.prioritizedFindings + reflection.insights + reflection.summary
- AC5: Impact is independent from severity: a finding with `severity: low` + `impact: must-fix` is valid (impact is not derived from severity)

### Strategy Mapping
- AC6: `strategyForRole("code-reviewer")` = `"critique-then-reflection"`
- AC7: `strategyForRole("security-auditor")` = `"critique-then-reflection"`
- AC8: `strategyForRole("spec-reviewer")` = `"standard"`

### CritiqueReflectionService
- AC9: Valid CTR output → `Ok<ProcessedReviewResult>` conforming to `ProcessedReviewResultSchema` (findings with impact, insights, summary)
- AC10: Reflection invents finding ID not in critique → `CritiqueReflectionError` (code: `REVIEW.CRITIQUE_REFLECTION_FAILED`)
- AC11: Reflection omits a critique finding → `CritiqueReflectionError`
- AC12: Malformed/unparseable input → `CritiqueReflectionError`
- AC13: Insight references finding ID not in rawFindings → `CritiqueReflectionError`
- AC14: Empty rawFindings (0 findings) → valid `Ok` result (empty findings = clean review)

### ReviewPromptBuilder
- AC15: CTR role → interpolated prompt contains "PASS 1" and "PASS 2" sections + literal JSON schema block (not raw `{{outputSchema}}` placeholder)
- AC16: Standard role → prompt does NOT contain two-pass instructions
- AC17: Output contains zero `{{...}}` tokens (all placeholders interpolated)
- AC18: `ReviewPromptBuilder.build()` produces valid output for both `code-reviewer` and `security-auditor` roles (template is role-agnostic, no role-specific conditionals)

### Builders + Exports
- AC19: `FindingBuilder.withImpact()` produces findings with impact field set
- AC20: `CritiqueReflectionResultBuilder` produces coordinated IDs (prioritizedFindings IDs match rawFindings IDs)
- AC21: `critique-then-reflection.md` exists in `src/resources/prompts/`
- AC22: Barrel exports include all new schemas, types, service, builder, error, strategy function

## Dependencies

- S01 (closed): Review aggregate, FindingPropsSchema, ReviewRoleSchema, ReviewRecordedEvent
- `@kernel`: BaseDomainError, IdSchema, TimestampSchema, Result
- `src/resources/`: loadResource utility
