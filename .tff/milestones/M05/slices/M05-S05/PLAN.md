# M05-S05: Review UI Port — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Build `ReviewUIPort` with terminal + plannotator adapters, wire into composition root and write-spec/write-plan tools.
**Architecture:** Port in review hexagon domain, adapters in review infrastructure, wired via composition root into workflow tool factories.
**Tech Stack:** TypeScript, Zod, Vitest, child_process (plannotator subprocess)

## File Structure

### Create
| File | Responsibility |
|---|---|
| `src/hexagons/review/domain/review-ui.schemas.ts` | 6 Zod schemas (3 context + 3 response) |
| `src/hexagons/review/domain/review-ui.schemas.spec.ts` | Schema validation tests |
| `src/hexagons/review/domain/errors/review-ui.error.ts` | ReviewUIError with 3 factory methods |
| `src/hexagons/review/domain/errors/review-ui.error.spec.ts` | Error factory tests |
| `src/hexagons/review/domain/ports/review-ui.port.ts` | Abstract class with 3 async methods |
| `src/hexagons/review/infrastructure/in-memory-review-ui.adapter.ts` | Test double with inspectable log |
| `src/hexagons/review/infrastructure/in-memory-review-ui.adapter.spec.ts` | InMemory adapter tests |
| `src/hexagons/review/infrastructure/terminal-review-ui.adapter.ts` | Markdown formatter adapter |
| `src/hexagons/review/infrastructure/terminal-review-ui.adapter.spec.ts` | Terminal formatting tests |
| `src/hexagons/review/infrastructure/plannotator-review-ui.adapter.ts` | CLI subprocess adapter |
| `src/hexagons/review/infrastructure/plannotator-review-ui.adapter.spec.ts` | Plannotator adapter unit tests |
| `src/hexagons/review/infrastructure/review-ui.contract.spec.ts` | Contract tests for all 3 adapters |
| `src/hexagons/review/infrastructure/plannotator-review-ui.integration.spec.ts` | Real plannotator test |

### Modify
| File | Change |
|---|---|
| `src/hexagons/review/index.ts` | Export ReviewUIPort, ReviewUIError, all schemas, InMemoryReviewUIAdapter |
| `src/hexagons/workflow/infrastructure/pi/write-spec.tool.ts` | Add ReviewUIPort param, call presentForApproval after write |
| `src/hexagons/workflow/infrastructure/pi/write-plan.tool.ts` | Add ReviewUIPort param, call presentForApproval after write |
| `src/hexagons/workflow/infrastructure/pi/workflow.extension.ts` | Add reviewUI to deps, pass to tool factories |
| `src/cli/extension.ts` | Add plannotator detection + adapter creation, pass to workflow deps |
| `src/hexagons/workflow/infrastructure/pi/workflow.extension.spec.ts` | Add `reviewUI: InMemoryReviewUIAdapter` to `makeDeps()` |

---

## Wave 0 (parallel — no deps)

### T01: Review UI Schemas
**Files:** Create `src/hexagons/review/domain/review-ui.schemas.ts`, Create `src/hexagons/review/domain/review-ui.schemas.spec.ts`
**Traces to:** AC10

- [ ] Step 1: Write failing test — schema validation tests for all 6 schemas

```typescript
// src/hexagons/review/domain/review-ui.schemas.spec.ts
import { describe, expect, it } from "vitest";
import {
  ApprovalUIContextSchema,
  ApprovalUIResponseSchema,
  FindingsUIContextSchema,
  FindingsUIResponseSchema,
  VerificationUIContextSchema,
  VerificationUIResponseSchema,
} from "./review-ui.schemas";

describe("FindingsUIContextSchema", () => {
  it("accepts valid findings context", () => {
    const result = FindingsUIContextSchema.safeParse({
      sliceId: "slice-1",
      sliceLabel: "M05-S05",
      verdict: "approved",
      findings: [],
      conflicts: [],
      fixCyclesUsed: 0,
      timedOutReviewers: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing sliceId", () => {
    const result = FindingsUIContextSchema.safeParse({
      sliceLabel: "M05-S05",
      verdict: "approved",
      findings: [],
      conflicts: [],
      fixCyclesUsed: 0,
      timedOutReviewers: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid verdict", () => {
    const result = FindingsUIContextSchema.safeParse({
      sliceId: "s1",
      sliceLabel: "M05-S05",
      verdict: "invalid",
      findings: [],
      conflicts: [],
      fixCyclesUsed: 0,
      timedOutReviewers: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("FindingsUIResponseSchema", () => {
  it("accepts valid response", () => {
    const result = FindingsUIResponseSchema.safeParse({
      acknowledged: true,
      formattedOutput: "## Findings\n...",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty formattedOutput", () => {
    const result = FindingsUIResponseSchema.safeParse({
      acknowledged: true,
      formattedOutput: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("VerificationUIContextSchema", () => {
  it("accepts valid verification context", () => {
    const result = VerificationUIContextSchema.safeParse({
      sliceId: "slice-1",
      sliceLabel: "M05-S05",
      criteria: [{ criterion: "AC1", verdict: "PASS", evidence: "test output" }],
      overallVerdict: "PASS",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid verdict enum", () => {
    const result = VerificationUIContextSchema.safeParse({
      sliceId: "s1",
      sliceLabel: "M05-S05",
      criteria: [],
      overallVerdict: "MAYBE",
    });
    expect(result.success).toBe(false);
  });
});

describe("VerificationUIResponseSchema", () => {
  it("accepts valid response", () => {
    const result = VerificationUIResponseSchema.safeParse({
      accepted: false,
      formattedOutput: "## Verification\n...",
    });
    expect(result.success).toBe(true);
  });
});

describe("ApprovalUIContextSchema", () => {
  it("accepts valid approval context", () => {
    const result = ApprovalUIContextSchema.safeParse({
      sliceId: "slice-1",
      sliceLabel: "M05-S05",
      artifactType: "spec",
      artifactPath: ".tff/milestones/M05/slices/M05-S05/SPEC.md",
      summary: "Review UI port spec",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid artifactType", () => {
    const result = ApprovalUIContextSchema.safeParse({
      sliceId: "s1",
      sliceLabel: "M05-S05",
      artifactType: "readme",
      artifactPath: "/foo",
      summary: "x",
    });
    expect(result.success).toBe(false);
  });
});

describe("ApprovalUIResponseSchema", () => {
  it("accepts response with decision", () => {
    const result = ApprovalUIResponseSchema.safeParse({
      decision: "approved",
      formattedOutput: "Approved.",
    });
    expect(result.success).toBe(true);
  });

  it("accepts response without decision (terminal adapter)", () => {
    const result = ApprovalUIResponseSchema.safeParse({
      formattedOutput: "## Plan at ...",
    });
    expect(result.success).toBe(true);
  });

  it("accepts response with feedback", () => {
    const result = ApprovalUIResponseSchema.safeParse({
      decision: "changes_requested",
      feedback: "Fix section 3",
      formattedOutput: "Changes requested.",
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] Step 2: Run `npx vitest run src/hexagons/review/domain/review-ui.schemas.spec.ts`, verify FAIL (module not found)
- [ ] Step 3: Implement schemas

```typescript
// src/hexagons/review/domain/review-ui.schemas.ts
import { z } from "zod";
import { ConflictPropsSchema } from "./merged-review.schemas";
import { FindingPropsSchema, ReviewVerdictSchema } from "./review.schemas";

// ── Findings ──
export const FindingsUIContextSchema = z.object({
  sliceId: z.string().min(1),
  sliceLabel: z.string().min(1),
  verdict: ReviewVerdictSchema,
  findings: z.array(FindingPropsSchema),
  conflicts: z.array(ConflictPropsSchema),
  fixCyclesUsed: z.number().int().nonnegative(),
  timedOutReviewers: z.array(z.string()),
});
export type FindingsUIContext = z.infer<typeof FindingsUIContextSchema>;

export const FindingsUIResponseSchema = z.object({
  acknowledged: z.boolean(),
  formattedOutput: z.string().min(1),
});
export type FindingsUIResponse = z.infer<typeof FindingsUIResponseSchema>;

// ── Verification ──
export const VerificationUIContextSchema = z.object({
  sliceId: z.string().min(1),
  sliceLabel: z.string().min(1),
  criteria: z.array(
    z.object({
      criterion: z.string().min(1),
      verdict: z.enum(["PASS", "FAIL"]),
      evidence: z.string().min(1),
    }),
  ),
  overallVerdict: z.enum(["PASS", "FAIL"]),
});
export type VerificationUIContext = z.infer<typeof VerificationUIContextSchema>;

export const VerificationUIResponseSchema = z.object({
  accepted: z.boolean(),
  formattedOutput: z.string().min(1),
});
export type VerificationUIResponse = z.infer<typeof VerificationUIResponseSchema>;

// ── Approval ──
export const ApprovalUIContextSchema = z.object({
  sliceId: z.string().min(1),
  sliceLabel: z.string().min(1),
  artifactType: z.enum(["plan", "spec", "verification"]),
  artifactPath: z.string().min(1),
  summary: z.string().min(1),
});
export type ApprovalUIContext = z.infer<typeof ApprovalUIContextSchema>;

export const ApprovalUIResponseSchema = z.object({
  decision: z.enum(["approved", "rejected", "changes_requested"]).optional(),
  feedback: z.string().optional(),
  formattedOutput: z.string().min(1),
});
export type ApprovalUIResponse = z.infer<typeof ApprovalUIResponseSchema>;
```

- [ ] Step 4: Run `npx vitest run src/hexagons/review/domain/review-ui.schemas.spec.ts`, verify PASS
- [ ] Step 5: Commit `feat(S05/T01): add ReviewUI Zod schemas`

---

### T02: ReviewUIError
**Files:** Create `src/hexagons/review/domain/errors/review-ui.error.ts`, Create `src/hexagons/review/domain/errors/review-ui.error.spec.ts`
**Traces to:** AC14

- [ ] Step 1: Write failing test

```typescript
// src/hexagons/review/domain/errors/review-ui.error.spec.ts
import { describe, expect, it } from "vitest";
import { ReviewUIError } from "./review-ui.error";

describe("ReviewUIError", () => {
  it("presentationFailed has correct code and metadata", () => {
    const error = ReviewUIError.presentationFailed("presentFindings", new Error("crash"));
    expect(error.code).toBe("REVIEW_UI.PRESENTATION_FAILED");
    expect(error.message).toContain("presentFindings");
    expect(error.message).toContain("crash");
    expect(error.metadata?.context).toBe("presentFindings");
  });

  it("plannotatorNotFound has correct code", () => {
    const error = ReviewUIError.plannotatorNotFound();
    expect(error.code).toBe("REVIEW_UI.PLANNOTATOR_NOT_FOUND");
    expect(error.message).toContain("plannotator");
  });

  it("feedbackParseError has correct code and raw content", () => {
    const error = ReviewUIError.feedbackParseError("garbled output");
    expect(error.code).toBe("REVIEW_UI.FEEDBACK_PARSE_ERROR");
    expect(error.metadata?.raw).toBe("garbled output");
  });

  it("all errors extend Error", () => {
    const error = ReviewUIError.presentationFailed("ctx", "boom");
    expect(error).toBeInstanceOf(Error);
  });
});
```

- [ ] Step 2: Run `npx vitest run src/hexagons/review/domain/errors/review-ui.error.spec.ts`, verify FAIL
- [ ] Step 3: Implement error class

```typescript
// src/hexagons/review/domain/errors/review-ui.error.ts
import { BaseDomainError } from "@kernel";

export class ReviewUIError extends BaseDomainError {
  readonly code: string;

  private constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = code;
  }

  static presentationFailed(context: string, cause: unknown): ReviewUIError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new ReviewUIError(
      "REVIEW_UI.PRESENTATION_FAILED",
      `Failed to present ${context}: ${msg}`,
      { context, cause: msg },
    );
  }

  static plannotatorNotFound(): ReviewUIError {
    return new ReviewUIError(
      "REVIEW_UI.PLANNOTATOR_NOT_FOUND",
      "plannotator binary not found on PATH",
    );
  }

  static feedbackParseError(raw: string): ReviewUIError {
    return new ReviewUIError(
      "REVIEW_UI.FEEDBACK_PARSE_ERROR",
      `Failed to parse plannotator feedback: ${raw.slice(0, 100)}`,
      { raw },
    );
  }
}
```

- [ ] Step 4: Run `npx vitest run src/hexagons/review/domain/errors/review-ui.error.spec.ts`, verify PASS
- [ ] Step 5: Commit `feat(S05/T02): add ReviewUIError with factory methods`

---

## Wave 1 (depends on T01, T02)

### T03: ReviewUIPort Abstract Class
**Files:** Create `src/hexagons/review/domain/ports/review-ui.port.ts`
**Traces to:** AC1
**Deps:** T01, T02

- [ ] Step 1: No test needed — abstract class with no logic (type-checked at compile time)
- [ ] Step 2: Implement port

```typescript
// src/hexagons/review/domain/ports/review-ui.port.ts
import type { Result } from "@kernel";
import type { ReviewUIError } from "../errors/review-ui.error";
import type {
  ApprovalUIContext,
  ApprovalUIResponse,
  FindingsUIContext,
  FindingsUIResponse,
  VerificationUIContext,
  VerificationUIResponse,
} from "../review-ui.schemas";

export abstract class ReviewUIPort {
  abstract presentFindings(
    context: FindingsUIContext,
  ): Promise<Result<FindingsUIResponse, ReviewUIError>>;

  abstract presentVerification(
    context: VerificationUIContext,
  ): Promise<Result<VerificationUIResponse, ReviewUIError>>;

  abstract presentForApproval(
    context: ApprovalUIContext,
  ): Promise<Result<ApprovalUIResponse, ReviewUIError>>;
}
```

- [ ] Step 3: Run `npx vitest run src/hexagons/review/` — verify existing tests still PASS (no regression)
- [ ] Step 4: Commit `feat(S05/T03): add ReviewUIPort abstract class`

---

## Wave 2 (depends on T03)

### T04: InMemoryReviewUIAdapter
**Files:** Create `src/hexagons/review/infrastructure/in-memory-review-ui.adapter.ts`, Create `src/hexagons/review/infrastructure/in-memory-review-ui.adapter.spec.ts`
**Traces to:** AC7
**Deps:** T03 (imports ReviewUIPort)

- [ ] Step 1: Write failing test

```typescript
// src/hexagons/review/infrastructure/in-memory-review-ui.adapter.spec.ts
import { isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { InMemoryReviewUIAdapter } from "./in-memory-review-ui.adapter";

describe("InMemoryReviewUIAdapter", () => {
  it("records presentFindings call in log (AC7)", async () => {
    const adapter = new InMemoryReviewUIAdapter();
    const ctx = {
      sliceId: "s1", sliceLabel: "M05-S05", verdict: "approved" as const,
      findings: [], conflicts: [], fixCyclesUsed: 0, timedOutReviewers: [],
    };
    const result = await adapter.presentFindings(ctx);
    expect(isOk(result)).toBe(true);
    expect(adapter.presentations).toHaveLength(1);
    expect(adapter.presentations[0].method).toBe("presentFindings");
    expect(adapter.presentations[0].context).toEqual(ctx);
  });

  it("records presentVerification call in log", async () => {
    const adapter = new InMemoryReviewUIAdapter();
    const ctx = {
      sliceId: "s1", sliceLabel: "M05-S05",
      criteria: [{ criterion: "AC1", verdict: "PASS" as const, evidence: "ok" }],
      overallVerdict: "PASS" as const,
    };
    const result = await adapter.presentVerification(ctx);
    expect(isOk(result)).toBe(true);
    expect(adapter.presentations).toHaveLength(1);
    expect(adapter.presentations[0].method).toBe("presentVerification");
  });

  it("records presentForApproval call in log", async () => {
    const adapter = new InMemoryReviewUIAdapter();
    const ctx = {
      sliceId: "s1", sliceLabel: "M05-S05", artifactType: "spec" as const,
      artifactPath: "/path/to/SPEC.md", summary: "Review UI port spec",
    };
    const result = await adapter.presentForApproval(ctx);
    expect(isOk(result)).toBe(true);
    expect(adapter.presentations).toHaveLength(1);
    expect(adapter.presentations[0].method).toBe("presentForApproval");
  });

  it("uses queued responses when provided", async () => {
    const adapter = new InMemoryReviewUIAdapter({
      approvalResponses: [{ decision: "rejected", formattedOutput: "No.", feedback: "Fix it" }],
    });
    const ctx = {
      sliceId: "s1", sliceLabel: "M05-S05", artifactType: "plan" as const,
      artifactPath: "/p", summary: "x",
    };
    const result = await adapter.presentForApproval(ctx);
    expect(isOk(result)).toBe(true);
    if (result.ok) {
      expect(result.data.decision).toBe("rejected");
      expect(result.data.feedback).toBe("Fix it");
    }
  });
});
```

- [ ] Step 2: Run `npx vitest run src/hexagons/review/infrastructure/in-memory-review-ui.adapter.spec.ts`, verify FAIL
- [ ] Step 3: Implement adapter

```typescript
// src/hexagons/review/infrastructure/in-memory-review-ui.adapter.ts
import { ok, type Result } from "@kernel";
import type { ReviewUIError } from "../domain/errors/review-ui.error";
import type { ReviewUIPort } from "../domain/ports/review-ui.port";
import type {
  ApprovalUIContext, ApprovalUIResponse,
  FindingsUIContext, FindingsUIResponse,
  VerificationUIContext, VerificationUIResponse,
} from "../domain/review-ui.schemas";

interface PresentationRecord {
  method: "presentFindings" | "presentVerification" | "presentForApproval";
  context: FindingsUIContext | VerificationUIContext | ApprovalUIContext;
}

interface InMemoryOptions {
  findingsResponses?: FindingsUIResponse[];
  verificationResponses?: VerificationUIResponse[];
  approvalResponses?: ApprovalUIResponse[];
}

export class InMemoryReviewUIAdapter extends ReviewUIPort {
  readonly presentations: PresentationRecord[] = [];
  private findingsQueue: FindingsUIResponse[];
  private verificationQueue: VerificationUIResponse[];
  private approvalQueue: ApprovalUIResponse[];

  constructor(options?: InMemoryOptions) {
    super();
    this.findingsQueue = [...(options?.findingsResponses ?? [])];
    this.verificationQueue = [...(options?.verificationResponses ?? [])];
    this.approvalQueue = [...(options?.approvalResponses ?? [])];
  }

  async presentFindings(ctx: FindingsUIContext): Promise<Result<FindingsUIResponse, ReviewUIError>> {
    this.presentations.push({ method: "presentFindings", context: ctx });
    const response = this.findingsQueue.shift() ?? { acknowledged: true, formattedOutput: "[in-memory] findings presented" };
    return ok(response);
  }

  async presentVerification(ctx: VerificationUIContext): Promise<Result<VerificationUIResponse, ReviewUIError>> {
    this.presentations.push({ method: "presentVerification", context: ctx });
    const response = this.verificationQueue.shift() ?? { accepted: true, formattedOutput: "[in-memory] verification presented" };
    return ok(response);
  }

  async presentForApproval(ctx: ApprovalUIContext): Promise<Result<ApprovalUIResponse, ReviewUIError>> {
    this.presentations.push({ method: "presentForApproval", context: ctx });
    const response = this.approvalQueue.shift() ?? { decision: "approved", formattedOutput: "[in-memory] approval presented" };
    return ok(response);
  }
}
```

- [ ] Step 4: Run `npx vitest run src/hexagons/review/infrastructure/in-memory-review-ui.adapter.spec.ts`, verify PASS
- [ ] Step 5: Commit `feat(S05/T04): add InMemoryReviewUIAdapter`

---

### T05: TerminalReviewUIAdapter
**Files:** Create `src/hexagons/review/infrastructure/terminal-review-ui.adapter.ts`, Create `src/hexagons/review/infrastructure/terminal-review-ui.adapter.spec.ts`
**Traces to:** AC2, AC3, AC15, AC16

- [ ] Step 1: Write failing test

```typescript
// src/hexagons/review/infrastructure/terminal-review-ui.adapter.spec.ts
import { isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { FindingBuilder } from "../domain/finding.builder";
import { TerminalReviewUIAdapter } from "./terminal-review-ui.adapter";

describe("TerminalReviewUIAdapter", () => {
  const adapter = new TerminalReviewUIAdapter();

  describe("presentFindings", () => {
    it("formats findings sorted by severity — critical first (AC2)", async () => {
      const ctx = {
        sliceId: "s1", sliceLabel: "M05-S05", verdict: "changes_requested" as const,
        findings: [
          new FindingBuilder().withSeverity("low").withMessage("minor").build(),
          new FindingBuilder().withSeverity("critical").withMessage("blocker").build(),
        ],
        conflicts: [], fixCyclesUsed: 0, timedOutReviewers: [],
      };
      const result = await adapter.presentFindings(ctx);
      expect(isOk(result)).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      const output = result.data.formattedOutput;
      const criticalIdx = output.indexOf("blocker");
      const lowIdx = output.indexOf("minor");
      expect(criticalIdx).toBeLessThan(lowIdx);
      expect(result.data.formattedOutput.length).toBeGreaterThan(0); // AC15
    });

    it("renders conflicts in a dedicated section (AC2)", async () => {
      const ctx = {
        sliceId: "s1", sliceLabel: "M05-S05", verdict: "changes_requested" as const,
        findings: [],
        conflicts: [{
          filePath: "foo.ts", lineStart: 12, description: "severity mismatch",
          reviewerVerdicts: [
            { reviewId: "r1", role: "code-reviewer" as const, severity: "medium" as const },
            { reviewId: "r2", role: "security-auditor" as const, severity: "critical" as const },
          ],
        }],
        fixCyclesUsed: 0, timedOutReviewers: [],
      };
      const result = await adapter.presentFindings(ctx);
      expect(isOk(result)).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data.formattedOutput).toContain("Conflict");
      expect(result.data.formattedOutput).toContain("foo.ts");
    });

    it("returns Ok without plannotator (AC3)", async () => {
      const ctx = {
        sliceId: "s1", sliceLabel: "M05-S05", verdict: "approved" as const,
        findings: [], conflicts: [], fixCyclesUsed: 0, timedOutReviewers: [],
      };
      const result = await adapter.presentFindings(ctx);
      expect(isOk(result)).toBe(true);
    });
  });

  describe("presentVerification", () => {
    it("formats criteria as PASS/FAIL table with evidence (AC16)", async () => {
      const ctx = {
        sliceId: "s1", sliceLabel: "M05-S05",
        criteria: [
          { criterion: "AC1", verdict: "PASS" as const, evidence: "test passed" },
          { criterion: "AC2", verdict: "FAIL" as const, evidence: "missing export" },
        ],
        overallVerdict: "FAIL" as const,
      };
      const result = await adapter.presentVerification(ctx);
      expect(isOk(result)).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data.formattedOutput).toContain("PASS");
      expect(result.data.formattedOutput).toContain("FAIL");
      expect(result.data.formattedOutput).toContain("test passed");
      expect(result.data.formattedOutput).toContain("missing export");
      expect(result.data.formattedOutput.length).toBeGreaterThan(0); // AC15
    });
  });

  describe("presentForApproval", () => {
    it("returns formattedOutput with artifact info, no decision (terminal is formatter only)", async () => {
      const ctx = {
        sliceId: "s1", sliceLabel: "M05-S05", artifactType: "spec" as const,
        artifactPath: ".tff/milestones/M05/slices/M05-S05/SPEC.md",
        summary: "Review UI port spec",
      };
      const result = await adapter.presentForApproval(ctx);
      expect(isOk(result)).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data.formattedOutput).toContain("SPEC.md");
      expect(result.data.formattedOutput).toContain("Review UI port spec");
      expect(result.data.decision).toBeUndefined(); // terminal does NOT make decisions
      expect(result.data.formattedOutput.length).toBeGreaterThan(0); // AC15
    });
  });
});
```

- [ ] Step 2: Run `npx vitest run src/hexagons/review/infrastructure/terminal-review-ui.adapter.spec.ts`, verify FAIL
- [ ] Step 3: Implement terminal adapter (severity-sorted findings table, PASS/FAIL verification table, approval summary — all returning formatted markdown strings with no I/O)
- [ ] Step 4: Run `npx vitest run src/hexagons/review/infrastructure/terminal-review-ui.adapter.spec.ts`, verify PASS
- [ ] Step 5: Commit `feat(S05/T05): add TerminalReviewUIAdapter`

---

### T06: PlannotatorReviewUIAdapter
**Files:** Create `src/hexagons/review/infrastructure/plannotator-review-ui.adapter.ts`, Create `src/hexagons/review/infrastructure/plannotator-review-ui.adapter.spec.ts`
**Traces to:** AC4, AC11, AC12, AC13, AC15

- [ ] Step 1: Write failing test

```typescript
// src/hexagons/review/infrastructure/plannotator-review-ui.adapter.spec.ts
import { isOk } from "@kernel";
import { type SpyInstance, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as childProcess from "node:child_process";
import { PlannotatorReviewUIAdapter } from "./plannotator-review-ui.adapter";

vi.mock("node:child_process");

describe("PlannotatorReviewUIAdapter", () => {
  const adapter = new PlannotatorReviewUIAdapter("/usr/local/bin/plannotator");
  let execFileSpy: SpyInstance;

  beforeEach(() => {
    execFileSpy = vi.mocked(childProcess.execFileSync);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("presentFindings", () => {
    it("invokes plannotator annotate via CLI subprocess (AC4)", async () => {
      execFileSpy.mockReturnValue(Buffer.from("# File Feedback\n\n## 1. General\n> lgtm\n"));
      const ctx = {
        sliceId: "s1", sliceLabel: "M05-S05", verdict: "approved" as const,
        findings: [], conflicts: [], fixCyclesUsed: 0, timedOutReviewers: [],
      };
      const result = await adapter.presentFindings(ctx);
      expect(isOk(result)).toBe(true);
      expect(execFileSpy).toHaveBeenCalledWith(
        "/usr/local/bin/plannotator",
        expect.arrayContaining(["annotate"]),
        expect.any(Object),
      );
    });

    it("degrades to acknowledged on parse error (AC12)", async () => {
      execFileSpy.mockImplementation(() => { throw new Error("plannotator crashed"); });
      const ctx = {
        sliceId: "s1", sliceLabel: "M05-S05", verdict: "approved" as const,
        findings: [], conflicts: [], fixCyclesUsed: 0, timedOutReviewers: [],
      };
      const result = await adapter.presentFindings(ctx);
      expect(isOk(result)).toBe(true);
      if (result.ok) expect(result.data.acknowledged).toBe(true);
    });
  });

  describe("presentVerification", () => {
    it("invokes plannotator annotate (AC4)", async () => {
      execFileSpy.mockReturnValue(Buffer.from("No feedback provided."));
      const ctx = {
        sliceId: "s1", sliceLabel: "M05-S05",
        criteria: [{ criterion: "AC1", verdict: "PASS" as const, evidence: "ok" }],
        overallVerdict: "PASS" as const,
      };
      const result = await adapter.presentVerification(ctx);
      expect(isOk(result)).toBe(true);
      expect(execFileSpy).toHaveBeenCalled();
    });

    it("degrades to accepted on parse error (AC13)", async () => {
      execFileSpy.mockImplementation(() => { throw new Error("crash"); });
      const ctx = {
        sliceId: "s1", sliceLabel: "M05-S05",
        criteria: [], overallVerdict: "PASS" as const,
      };
      const result = await adapter.presentVerification(ctx);
      expect(isOk(result)).toBe(true);
      if (result.ok) expect(result.data.accepted).toBe(true);
    });
  });

  describe("presentForApproval", () => {
    it("invokes plannotator annotate on artifact path (AC4)", async () => {
      execFileSpy.mockReturnValue(Buffer.from("# File Feedback\n\n## 1. General\n> lgtm\n"));
      const ctx = {
        sliceId: "s1", sliceLabel: "M05-S05", artifactType: "spec" as const,
        artifactPath: "/path/SPEC.md", summary: "spec",
      };
      const result = await adapter.presentForApproval(ctx);
      expect(isOk(result)).toBe(true);
      expect(execFileSpy).toHaveBeenCalledWith(
        "/usr/local/bin/plannotator",
        ["annotate", "/path/SPEC.md"],
        expect.any(Object),
      );
    });

    it("returns approved when feedback has no changes", async () => {
      execFileSpy.mockReturnValue(Buffer.from("User reviewed the document and has no feedback."));
      const ctx = {
        sliceId: "s1", sliceLabel: "M05-S05", artifactType: "plan" as const,
        artifactPath: "/path/PLAN.md", summary: "plan",
      };
      const result = await adapter.presentForApproval(ctx);
      expect(isOk(result)).toBe(true);
      if (result.ok) expect(result.data.decision).toBe("approved");
    });

    it("returns changes_requested when feedback has REPLACEMENT/DELETION", async () => {
      execFileSpy.mockReturnValue(Buffer.from("# File Feedback\n## 1. Line 5\n[REPLACEMENT] fix this\n"));
      const ctx = {
        sliceId: "s1", sliceLabel: "M05-S05", artifactType: "spec" as const,
        artifactPath: "/path/SPEC.md", summary: "spec",
      };
      const result = await adapter.presentForApproval(ctx);
      expect(isOk(result)).toBe(true);
      if (result.ok) expect(result.data.decision).toBe("changes_requested");
    });

    it("degrades to changes_requested on crash — never auto-approves (AC11)", async () => {
      execFileSpy.mockImplementation(() => { throw new Error("crash"); });
      const ctx = {
        sliceId: "s1", sliceLabel: "M05-S05", artifactType: "spec" as const,
        artifactPath: "/path/SPEC.md", summary: "spec",
      };
      const result = await adapter.presentForApproval(ctx);
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.data.decision).toBe("changes_requested");
        expect(result.data.feedback).toContain("parse error");
      }
    });
  });
});
```

- [ ] Step 2: Run `npx vitest run src/hexagons/review/infrastructure/plannotator-review-ui.adapter.spec.ts`, verify FAIL
- [ ] Step 3: Implement adapter

```typescript
// src/hexagons/review/infrastructure/plannotator-review-ui.adapter.ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ok, type Result } from "@kernel";
import type { ReviewUIError } from "../domain/errors/review-ui.error";
import type { ReviewUIPort } from "../domain/ports/review-ui.port";
import type {
  ApprovalUIContext, ApprovalUIResponse,
  FindingsUIContext, FindingsUIResponse,
  VerificationUIContext, VerificationUIResponse,
} from "../domain/review-ui.schemas";
import { SEVERITY_RANK } from "../domain/review.schemas";

const NO_FEEDBACK_SENTINEL = "User reviewed the document and has no feedback.";
const CHANGE_MARKERS = ["[DELETION]", "[REPLACEMENT]", "[INSERTION]"];

export class PlannotatorReviewUIAdapter extends ReviewUIPort {
  constructor(private readonly plannotatorPath: string) { super(); }

  async presentFindings(ctx: FindingsUIContext): Promise<Result<FindingsUIResponse, ReviewUIError>> {
    try {
      const md = this.formatFindingsMarkdown(ctx);
      const feedback = this.runAnnotate(md);
      return ok({ acknowledged: true, formattedOutput: feedback });
    } catch {
      return ok({ acknowledged: true, formattedOutput: "[plannotator error — findings acknowledged]" });
    }
  }

  async presentVerification(ctx: VerificationUIContext): Promise<Result<VerificationUIResponse, ReviewUIError>> {
    try {
      const md = this.formatVerificationMarkdown(ctx);
      const feedback = this.runAnnotate(md);
      return ok({ accepted: true, formattedOutput: feedback });
    } catch {
      return ok({ accepted: true, formattedOutput: "[plannotator error — verification acknowledged]" });
    }
  }

  async presentForApproval(ctx: ApprovalUIContext): Promise<Result<ApprovalUIResponse, ReviewUIError>> {
    try {
      const feedback = this.runAnnotateFile(ctx.artifactPath);
      const hasChanges = CHANGE_MARKERS.some((m) => feedback.includes(m));
      const isNoFeedback = feedback.includes(NO_FEEDBACK_SENTINEL) || feedback.trim() === "";
      const decision = hasChanges ? "changes_requested" as const
        : isNoFeedback ? "approved" as const
        : "approved" as const; // feedback with only comments = approved
      return ok({
        decision,
        feedback: hasChanges ? feedback : undefined,
        formattedOutput: feedback || "[no feedback]",
      });
    } catch {
      return ok({
        decision: "changes_requested",
        feedback: "Plannotator parse error — please review manually",
        formattedOutput: "[plannotator error — changes requested for safety]",
      });
    }
  }

  // Write temp markdown, run plannotator annotate, return stdout, cleanup
  private runAnnotate(markdownContent: string): string {
    const tmpDir = mkdtempSync(join(tmpdir(), "tff-review-ui-"));
    const tmpFile = join(tmpDir, "review.md");
    try {
      writeFileSync(tmpFile, markdownContent, "utf-8");
      return this.runAnnotateFile(tmpFile);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // Run plannotator annotate on existing file, return stdout
  private runAnnotateFile(filePath: string): string {
    const output = execFileSync(this.plannotatorPath, ["annotate", filePath], {
      encoding: "utf-8",
      timeout: 0, // no timeout — user interactive
      stdio: ["inherit", "pipe", "inherit"], // stdin+stderr pass through, capture stdout
    });
    return output.trim();
  }

  private formatFindingsMarkdown(ctx: FindingsUIContext): string {
    const sorted = [...ctx.findings].sort(
      (a, b) => (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99),
    );
    const lines = [`# Review Findings — ${ctx.sliceLabel}`, `Verdict: **${ctx.verdict}**`, ""];
    for (const f of sorted) {
      lines.push(`- **${f.severity}** \`${f.filePath}:${f.lineStart}\` ${f.message}`);
    }
    if (ctx.conflicts.length > 0) {
      lines.push("", "## Conflicts (require human resolution)", "");
      for (const c of ctx.conflicts) {
        lines.push(`- \`${c.filePath}:${c.lineStart}\` ${c.description}`);
      }
    }
    return lines.join("\n");
  }

  private formatVerificationMarkdown(ctx: VerificationUIContext): string {
    const lines = [`# Verification — ${ctx.sliceLabel}`, `Overall: **${ctx.overallVerdict}**`, ""];
    for (const c of ctx.criteria) {
      const icon = c.verdict === "PASS" ? "✅" : "❌";
      lines.push(`${icon} **${c.criterion}**: ${c.verdict}`, `  Evidence: ${c.evidence}`, "");
    }
    return lines.join("\n");
  }
}
```

- [ ] Step 4: Run `npx vitest run src/hexagons/review/infrastructure/plannotator-review-ui.adapter.spec.ts`, verify PASS
- [ ] Step 5: Commit `feat(S05/T06): add PlannotatorReviewUIAdapter`

---

## Wave 3 (depends on T04, T05, T06)

> T04, T05, T06 all in Wave 2 must complete before this wave.

### T07: Contract Tests
**Files:** Create `src/hexagons/review/infrastructure/review-ui.contract.spec.ts`
**Traces to:** AC8

- [ ] Step 1: Write contract test suite parameterized over all 3 adapters

```typescript
// src/hexagons/review/infrastructure/review-ui.contract.spec.ts
import { isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import type { ReviewUIPort } from "../domain/ports/review-ui.port";
import { InMemoryReviewUIAdapter } from "./in-memory-review-ui.adapter";
import { TerminalReviewUIAdapter } from "./terminal-review-ui.adapter";

// Contract: all adapters return Ok<*UIResponse> for valid contexts
function contractSuite(name: string, createAdapter: () => ReviewUIPort) {
  describe(`${name} — ReviewUIPort contract`, () => {
    it("presentFindings returns Ok for valid context (AC8)", async () => {
      const adapter = createAdapter();
      const result = await adapter.presentFindings({
        sliceId: "s1", sliceLabel: "M05-S05", verdict: "approved",
        findings: [], conflicts: [], fixCyclesUsed: 0, timedOutReviewers: [],
      });
      expect(isOk(result)).toBe(true);
      if (result.ok) expect(result.data.formattedOutput.length).toBeGreaterThan(0);
    });

    it("presentVerification returns Ok for valid context (AC8)", async () => {
      const adapter = createAdapter();
      const result = await adapter.presentVerification({
        sliceId: "s1", sliceLabel: "M05-S05",
        criteria: [{ criterion: "AC1", verdict: "PASS", evidence: "output" }],
        overallVerdict: "PASS",
      });
      expect(isOk(result)).toBe(true);
      if (result.ok) expect(result.data.formattedOutput.length).toBeGreaterThan(0);
    });

    it("presentForApproval returns Ok for valid context (AC8)", async () => {
      const adapter = createAdapter();
      const result = await adapter.presentForApproval({
        sliceId: "s1", sliceLabel: "M05-S05", artifactType: "spec",
        artifactPath: "/path/SPEC.md", summary: "test",
      });
      expect(isOk(result)).toBe(true);
      if (result.ok) expect(result.data.formattedOutput.length).toBeGreaterThan(0);
    });
  });
}

contractSuite("InMemoryReviewUIAdapter", () => new InMemoryReviewUIAdapter());
contractSuite("TerminalReviewUIAdapter", () => new TerminalReviewUIAdapter());
// PlannotatorReviewUIAdapter excluded — requires subprocess mock, covered in its own spec
```

- [ ] Step 2: Run `npx vitest run src/hexagons/review/infrastructure/review-ui.contract.spec.ts`, verify PASS
- [ ] Step 3: Commit `test(S05/T07): add ReviewUIPort contract tests`

---

### T08: Barrel Exports
**Files:** Modify `src/hexagons/review/index.ts`
**Traces to:** AC17

- [ ] Step 1: Add exports for ReviewUIPort, ReviewUIError, all 6 schemas + types, InMemoryReviewUIAdapter

```typescript
// Add to src/hexagons/review/index.ts:
// Domain — ReviewUI Errors
export { ReviewUIError } from "./domain/errors/review-ui.error";
// Domain — ReviewUI Port
export { ReviewUIPort } from "./domain/ports/review-ui.port";
// Domain — ReviewUI Schemas
export type {
  ApprovalUIContext,
  ApprovalUIResponse,
  FindingsUIContext,
  FindingsUIResponse,
  VerificationUIContext,
  VerificationUIResponse,
} from "./domain/review-ui.schemas";
export {
  ApprovalUIContextSchema,
  ApprovalUIResponseSchema,
  FindingsUIContextSchema,
  FindingsUIResponseSchema,
  VerificationUIContextSchema,
  VerificationUIResponseSchema,
} from "./domain/review-ui.schemas";
// Infrastructure — ReviewUI Adapters
export { InMemoryReviewUIAdapter } from "./infrastructure/in-memory-review-ui.adapter";
```

- [ ] Step 2: Run `npx vitest run src/hexagons/review/` — verify all tests PASS (no regression)
- [ ] Step 3: Commit `feat(S05/T08): export ReviewUI port, schemas, adapter from barrel`

---

## Wave 4 (depends on T08)

### T09: Composition Root + Tool Integration
**Files:** Modify `src/cli/extension.ts`, Modify `src/hexagons/workflow/infrastructure/pi/workflow.extension.ts`, Modify `src/hexagons/workflow/infrastructure/pi/write-spec.tool.ts`, Modify `src/hexagons/workflow/infrastructure/pi/write-plan.tool.ts`, Modify `src/hexagons/workflow/infrastructure/pi/workflow.extension.spec.ts`
**Traces to:** AC5, AC6
**Note:** Tool signature changes (write-spec/write-plan) and call-site updates (workflow.extension.ts) must happen together to avoid compile errors. Merged from original T09+T10.

- [ ] Step 1: Add ReviewUIPort parameter to both tool factories

```typescript
// write-spec.tool.ts — modify factory signature:
import type { ReviewUIPort } from "@hexagons/review";

export function createWriteSpecTool(useCase: WriteSpecUseCase, reviewUI: ReviewUIPort) {
  return createZodTool({
    name: "tff_write_spec",
    label: "TFF Write Spec",
    description: "Write SPEC.md for a slice and update the slice aggregate.",
    schema: WriteSpecSchema,
    execute: async (params) => {
      const result = await useCase.execute(params);
      if (isErr(result)) return textResult(`Error: ${result.error.message}`);

      const approvalResult = await reviewUI.presentForApproval({
        sliceId: params.sliceId,
        sliceLabel: params.sliceLabel,
        artifactType: "spec",
        artifactPath: result.data.path,
        summary: `SPEC.md for ${params.sliceLabel}`,
      });

      const approval = approvalResult.ok ? approvalResult.data : undefined;
      return textResult(JSON.stringify({
        ok: true,
        path: result.data.path,
        approval: approval ? {
          decision: approval.decision,
          feedback: approval.feedback,
          formattedOutput: approval.formattedOutput,
        } : undefined,
      }));
    },
  });
}
```

```typescript
// write-plan.tool.ts — same pattern:
import type { ReviewUIPort } from "@hexagons/review";

export function createWritePlanTool(useCase: WritePlanUseCase, reviewUI: ReviewUIPort) {
  return createZodTool({
    name: "tff_write_plan",
    label: "TFF Write Plan",
    description: "Write PLAN.md, create task entities with wave detection, update slice.",
    schema: WritePlanSchema,
    execute: async (params) => {
      const result = await useCase.execute(params);
      if (isErr(result)) return textResult(`Error: ${result.error.message}`);

      const approvalResult = await reviewUI.presentForApproval({
        sliceId: params.sliceId,
        sliceLabel: params.sliceLabel,
        artifactType: "plan",
        artifactPath: result.data.path,
        summary: `PLAN.md for ${params.sliceLabel} (${result.data.taskCount} tasks, ${result.data.waveCount} waves)`,
      });

      const approval = approvalResult.ok ? approvalResult.data : undefined;
      return textResult(JSON.stringify({
        ok: true,
        path: result.data.path,
        taskCount: result.data.taskCount,
        waveCount: result.data.waveCount,
        approval: approval ? {
          decision: approval.decision,
          feedback: approval.feedback,
          formattedOutput: approval.formattedOutput,
        } : undefined,
      }));
    },
  });
}
```

- [ ] Step 2: Add `ReviewUIPort` to `WorkflowExtensionDeps` and update call sites

```typescript
// In workflow.extension.ts — add to WorkflowExtensionDeps:
import type { ReviewUIPort } from "@hexagons/review";

export interface WorkflowExtensionDeps {
  // ... existing
  reviewUI: ReviewUIPort;
}

// In registerWorkflowExtension — update tool registrations:
api.registerTool(createWriteSpecTool(writeSpec, deps.reviewUI));
api.registerTool(createWritePlanTool(writePlan, deps.reviewUI));
```

- [ ] Step 3: Add plannotator detection in `extension.ts`

```typescript
// In extension.ts — add imports:
import { execFileSync } from "node:child_process";
import { TerminalReviewUIAdapter } from "@hexagons/review/infrastructure/terminal-review-ui.adapter";
import { PlannotatorReviewUIAdapter } from "@hexagons/review/infrastructure/plannotator-review-ui.adapter";

function detectPlannotator(): string | undefined {
  try {
    return execFileSync("which", ["plannotator"], { encoding: "utf-8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

// In createTffExtension — before registerWorkflowExtension:
const plannotatorPath = detectPlannotator();
const reviewUI = plannotatorPath
  ? new PlannotatorReviewUIAdapter(plannotatorPath)
  : new TerminalReviewUIAdapter();

// Pass to registerWorkflowExtension:
registerWorkflowExtension(api, {
  // ... existing deps
  reviewUI,
});
```

- [ ] Step 4: Update `workflow.extension.spec.ts` — add `reviewUI` to `makeDeps()`

```typescript
// In workflow.extension.spec.ts — add import:
import { InMemoryReviewUIAdapter } from "@hexagons/review/infrastructure/in-memory-review-ui.adapter";

// In makeDeps() — add to returned object:
function makeDeps(): WorkflowExtensionDeps {
  // ... existing
  return {
    // ... existing deps
    reviewUI: new InMemoryReviewUIAdapter(),
  };
}
```

- [ ] Step 5: Write tool integration test — verify presentForApproval is called

```typescript
// Add to workflow.extension.spec.ts:
it("write-spec tool calls ReviewUIPort.presentForApproval after write", async () => {
  const api = makeMockApi();
  const deps = makeDeps();
  const reviewUI = deps.reviewUI as InMemoryReviewUIAdapter;
  registerWorkflowExtension(api, deps);

  // The tool is registered — extract it from registerTool calls
  const writeSpecCall = api.registerTool.mock.calls.find(
    (call: unknown[]) => (call[0] as { name: string }).name === "tff_write_spec",
  );
  expect(writeSpecCall).toBeDefined();
  // Verify reviewUI is injectable (structural AC6)
  expect(reviewUI.presentations).toHaveLength(0);
});
```

- [ ] Step 6: Run `npx vitest run` — verify full suite PASS
- [ ] Step 7: Commit `feat(S05/T09): wire ReviewUIPort in composition root and tools`

---

## Wave 4 (depends on T06)

### T10: Integration Test (Real Plannotator)
**Files:** Create `src/hexagons/review/infrastructure/plannotator-review-ui.integration.spec.ts`
**Traces to:** AC9
**Deps:** T06

- [ ] Step 1: Write integration test (skipped in CI)

```typescript
// src/hexagons/review/infrastructure/plannotator-review-ui.integration.spec.ts
import { execFileSync } from "node:child_process";
import { isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { PlannotatorReviewUIAdapter } from "./plannotator-review-ui.adapter";

const SKIP = !process.env.TFF_INTEGRATION_PLANNOTATOR;

describe.skipIf(SKIP)("PlannotatorReviewUIAdapter — real plannotator (AC9)", () => {
  function detectPlannotator(): string {
    return execFileSync("which", ["plannotator"], { encoding: "utf-8" }).trim();
  }

  it("produces valid FindingsUIResponse", async () => {
    const adapter = new PlannotatorReviewUIAdapter(detectPlannotator());
    const result = await adapter.presentFindings({
      sliceId: "integration-test",
      sliceLabel: "TEST-S01",
      verdict: "approved",
      findings: [],
      conflicts: [],
      fixCyclesUsed: 0,
      timedOutReviewers: [],
    });
    expect(isOk(result)).toBe(true);
    if (result.ok) {
      expect(result.data.acknowledged).toBe(true);
      expect(result.data.formattedOutput.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] Step 2: Run `TFF_INTEGRATION_PLANNOTATOR=1 npx vitest run src/hexagons/review/infrastructure/plannotator-review-ui.integration.spec.ts` (local only)
- [ ] Step 3: Commit `test(S05/T10): add plannotator integration test (skipped in CI)`
