# M05-S05 Research: Review UI Port

## R1: Plannotator stdout Protocol

`plannotator annotate <file.md>` outputs **plain markdown text** (not JSON) via `console.log()`.

**Source**: `~/.claude/plugins/marketplaces/plannotator/apps/hook/server/index.ts:366`

```
console.log(result.feedback || "No feedback provided.");
```

**Feedback generation** (`packages/editor/App.tsx:833-858`):
- No annotations: `"User reviewed the document and has no feedback."`
- With annotations: `exportAnnotations(blocks, annotations, ...)` -> structured markdown

**Example output format**:
```markdown
# File Feedback

I've reviewed this file and have 2 pieces of feedback:

## 1. Line 5-7
> original text here
[REPLACEMENT] suggested replacement text

## 2. General feedback about the file
> lgtm
```

**Parser strategy for PlannotatorReviewUIAdapter**:
- Capture stdout text after subprocess exits
- Check for "no feedback" sentinel -> `{ acknowledged: true }`
- For `presentForApproval`: check if feedback contains DELETION/REPLACEMENT/INSERTION -> `changes_requested`; else `approved`
- All debug output goes to stderr (not stdout)
- Exit code 0 on success (after 1500ms delay for browser cleanup)

**Internal but inaccessible**: The HTTP POST body includes `{ feedback: string, annotations: Annotation[] }` but CLI only outputs the `feedback` string. The structured `annotations` array is not available via stdout.

## R2: Error Pattern — ConductReviewError

**Source**: `src/hexagons/review/domain/errors/conduct-review.error.ts`

```typescript
export class ConductReviewError extends BaseDomainError {
  readonly code: string;
  private constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = code;
  }
  static contextResolutionFailed(sliceId: string, cause: unknown): ConductReviewError { ... }
  static freshReviewerBlocked(sliceId, role, identity): ConductReviewError { ... }
  static allReviewersFailed(sliceId, failures): ConductReviewError { ... }
  static reviewerRetryExhausted(sliceId, role, cause): ConductReviewError { ... }
  static mergeError(sliceId, cause): ConductReviewError { ... }
}
```

**BaseDomainError** (`src/kernel/errors/base-domain.error.ts`):
- Abstract class, abstract `code: string`, constructor `(message, metadata?)`
- Sets `this.name = this.constructor.name`

**ReviewUIError factory methods**: `presentationFailed`, `plannotatorNotFound`, `feedbackParseError`.

## R3: Domain Schemas

**FindingPropsSchema** (`src/hexagons/review/domain/review.schemas.ts`):
```
{ id: IdSchema, severity: ReviewSeveritySchema, message: string.min(1),
  filePath: string.min(1), lineStart: number.int.positive,
  lineEnd?: number.int.positive, suggestion?: string,
  ruleId?: string, impact?: FindingImpactSchema }
```

**ConflictPropsSchema** (`src/hexagons/review/domain/merged-review.schemas.ts`):
```
{ filePath: string.min(1), lineStart: number.int.positive,
  description: string.min(1),
  reviewerVerdicts: [{ reviewId: IdSchema, role: ReviewRoleSchema,
    severity: ReviewSeveritySchema }].min(2) }
```

## R4: Tool Factory Integration

**Current pattern** (`write-spec.tool.ts`):
```typescript
export function createWriteSpecTool(useCase: WriteSpecUseCase) {
  return createZodTool({ name: "tff_write_spec", schema, execute: async (params) => {
    const result = await useCase.execute(params);
    if (isErr(result)) return textResult(`Error: ${result.error.message}`);
    return textResult(JSON.stringify({ ok: true, path: result.data.path }));
  }});
}
```

**Modification for ReviewUIPort**: Add second parameter to factory:
```typescript
export function createWriteSpecTool(useCase: WriteSpecUseCase, reviewUI: ReviewUIPort) {
  // After successful write, call reviewUI.presentForApproval()
  // Include approval result in textResult output
}
```

Same pattern for `createWritePlanTool(useCase, reviewUI)`.

## R5: Composition Root Wiring

**WorkflowExtensionDeps** interface (`workflow.extension.ts`): Add `reviewUIPort: ReviewUIPort`.

**createTffExtension** (`extension.ts`): Create adapter based on detection:
```typescript
const plannotatorPath = detectPlannotator(); // execFileSync wrapped
const reviewUI = plannotatorPath
  ? new PlannotatorReviewUIAdapter(plannotatorPath)
  : new TerminalReviewUIAdapter();
```

Pass `reviewUI` into `registerWorkflowExtension(api, { ...deps, reviewUIPort: reviewUI })`.

## R6: Barrel Exports

**Current** (`src/hexagons/review/index.ts`): Exports all errors, ports, domain entities, schemas, infrastructure adapters.

**To add**: `ReviewUIPort`, `ReviewUIError`, and all 6 context/response schemas + types, plus `InMemoryReviewUIAdapter`.

## R7: createZodTool API

```typescript
interface ZodToolConfig<T extends z.ZodObject> {
  name: string; label: string; description: string;
  promptSnippet?: string; promptGuidelines?: string[];
  schema: T;
  execute: (params: z.infer<T>, signal: AbortSignal, ctx: ExtensionContext) => Promise<AgentToolResult>;
}
```

`textResult(text: string)` -> `{ content: [{ type: "text", text }] }`

## Key Risks Resolved

| Risk | Resolution |
|---|---|
| Plannotator stdout is JSON? | No -- plain markdown text. Parser uses text analysis. |
| Need annotations array? | Not available via stdout. Markdown feedback is sufficient. |
| Tool factory accepts extra deps? | Yes -- just add parameter. No framework constraint. |
| ReviewUIError pattern unclear? | Follows ConductReviewError exactly (private ctor + static factories). |
| ConflictProps fields? | filePath, lineStart, description, reviewerVerdicts[min 2]. |
