# M04-S06: Agent Status Protocol — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Replace `success: boolean` in `AgentResult` with structured status protocol (DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED), self-review checklist, concerns, parser, and programmatic cross-checker.

**Architecture:** Kernel-level schemas in `kernel/agents/`, integration in `execution/infrastructure/`.

**Tech Stack:** Zod schemas, Vitest tests, PI SDK agent sessions.

## File Structure

### New Files (8)
| File | Responsibility |
|---|---|
| `src/kernel/agents/agent-status.schema.ts` | AgentStatusSchema, AgentConcernSchema, SelfReviewChecklistSchema, AgentStatusReportSchema, isSuccessfulStatus() |
| `src/kernel/agents/agent-status.schema.spec.ts` | Schema validation + isSuccessfulStatus tests |
| `src/kernel/agents/agent-status-parse.error.ts` | AgentStatusParseError extends BaseDomainError |
| `src/kernel/agents/agent-status-parser.ts` | parseAgentStatusReport() — extract + validate from raw output |
| `src/kernel/agents/agent-status-parser.spec.ts` | Parser tests (happy, missing markers, malformed JSON, partial) |
| `src/kernel/agents/agent-status-prompt.ts` | AGENT_STATUS_PROMPT constant — system prompt fragment |
| `src/kernel/agents/agent-status-cross-checker.ts` | crossCheckAgentResult() — 4 cross-checks |
| `src/kernel/agents/agent-status-cross-checker.spec.ts` | Cross-checker tests for all 4 rules |

### Modified Files (11)
| File | Change |
|---|---|
| `src/kernel/agents/agent-result.schema.ts` | Remove `success`, add `status` + `concerns` + `selfReview` |
| `src/kernel/agents/agent-result.schema.spec.ts` | Assert new fields instead of `success` |
| `src/kernel/agents/agent-result.builder.ts` | Replace `withSuccess`/`withFailure` → status-aware methods |
| `src/kernel/agents/agent-result.builder.spec.ts` | Assert new builder API |
| `src/kernel/agents/index.ts` | Export new schemas, parser, cross-checker, prompt, error |
| `src/hexagons/execution/infrastructure/pi-agent-dispatch.adapter.ts` | Inject prompt, parse output, cross-check, fallback |
| `src/hexagons/execution/infrastructure/in-memory-agent-dispatch.adapter.spec.ts` | Updated configurator with status-aware results |
| `src/hexagons/execution/infrastructure/agent-dispatch.contract.spec.ts` | Assert `result.data.status` instead of `result.data.success` |
| `src/hexagons/execution/application/record-task-metrics.use-case.ts` | `isSuccessfulStatus()` mapping |
| `src/hexagons/execution/application/record-task-metrics.use-case.spec.ts` | Updated assertions |
| `src/hexagons/execution/domain/events/task-execution-completed.event.spec.ts` | Assert `status` instead of `success` |

---

## Wave 0 (parallel — no dependencies)

### T01: Agent status schemas + error class + tests
**Create:** `src/kernel/agents/agent-status.schema.ts`, `src/kernel/agents/agent-status.schema.spec.ts`, `src/kernel/agents/agent-status-parse.error.ts`
**Traces to:** AC1 (foundation), AC2 (foundation), AC3 (foundation), AC5 (error class), AC7

- [ ] Step 1: Write tests for all schemas + `isSuccessfulStatus`

**File:** `src/kernel/agents/agent-status.schema.spec.ts`
```typescript
import { describe, expect, it } from "vitest";
import {
  AgentConcernSchema,
  AgentStatusReportSchema,
  AgentStatusSchema,
  isSuccessfulStatus,
  SelfReviewChecklistSchema,
} from "./agent-status.schema";

const ALL_PASSED_DIMS = [
  { dimension: "completeness" as const, passed: true },
  { dimension: "quality" as const, passed: true },
  { dimension: "discipline" as const, passed: true },
  { dimension: "verification" as const, passed: true },
];

describe("AgentStatusSchema", () => {
  it("accepts all four valid statuses", () => {
    for (const s of ["DONE", "DONE_WITH_CONCERNS", "NEEDS_CONTEXT", "BLOCKED"]) {
      expect(AgentStatusSchema.parse(s)).toBe(s);
    }
  });

  it("rejects invalid status", () => {
    expect(() => AgentStatusSchema.parse("SUCCESS")).toThrow();
  });
});

describe("AgentConcernSchema", () => {
  it("parses valid concern", () => {
    const concern = AgentConcernSchema.parse({
      area: "test coverage",
      description: "Missing edge case tests",
      severity: "warning",
    });
    expect(concern.area).toBe("test coverage");
  });

  it("rejects empty area", () => {
    expect(() =>
      AgentConcernSchema.parse({ area: "", description: "x", severity: "info" }),
    ).toThrow();
  });

  it("rejects invalid severity", () => {
    expect(() =>
      AgentConcernSchema.parse({ area: "x", description: "y", severity: "fatal" }),
    ).toThrow();
  });
});

describe("SelfReviewChecklistSchema", () => {
  it("parses valid 4-dimension checklist", () => {
    const checklist = SelfReviewChecklistSchema.parse({
      dimensions: ALL_PASSED_DIMS,
      overallConfidence: "high",
    });
    expect(checklist.dimensions).toHaveLength(4);
  });

  it("rejects wrong number of dimensions", () => {
    expect(() =>
      SelfReviewChecklistSchema.parse({
        dimensions: ALL_PASSED_DIMS.slice(0, 3),
        overallConfidence: "high",
      }),
    ).toThrow();
  });

  it("accepts dimension with note", () => {
    const dims = ALL_PASSED_DIMS.map((d, i) =>
      i === 0 ? { ...d, note: "All criteria addressed" } : d,
    );
    const checklist = SelfReviewChecklistSchema.parse({
      dimensions: dims,
      overallConfidence: "medium",
    });
    expect(checklist.dimensions[0].note).toBe("All criteria addressed");
  });
});

describe("AgentStatusReportSchema", () => {
  it("parses DONE report with default empty concerns", () => {
    const report = AgentStatusReportSchema.parse({
      status: "DONE",
      selfReview: { dimensions: ALL_PASSED_DIMS, overallConfidence: "high" },
    });
    expect(report.concerns).toEqual([]);
  });

  it("parses DONE_WITH_CONCERNS with concerns list", () => {
    const report = AgentStatusReportSchema.parse({
      status: "DONE_WITH_CONCERNS",
      concerns: [{ area: "edge case", description: "Unhandled null", severity: "warning" }],
      selfReview: { dimensions: ALL_PASSED_DIMS, overallConfidence: "medium" },
    });
    expect(report.concerns).toHaveLength(1);
  });
});

describe("isSuccessfulStatus", () => {
  it("returns true for DONE", () => expect(isSuccessfulStatus("DONE")).toBe(true));
  it("returns true for DONE_WITH_CONCERNS", () =>
    expect(isSuccessfulStatus("DONE_WITH_CONCERNS")).toBe(true));
  it("returns false for NEEDS_CONTEXT", () =>
    expect(isSuccessfulStatus("NEEDS_CONTEXT")).toBe(false));
  it("returns false for BLOCKED", () => expect(isSuccessfulStatus("BLOCKED")).toBe(false));
});
```

- [ ] Step 2: Run `npx vitest run src/kernel/agents/agent-status.schema.spec.ts`, verify FAIL (modules not found)

- [ ] Step 3: Implement schemas + error class

**File:** `src/kernel/agents/agent-status.schema.ts`
```typescript
import { z } from "zod";

export const AgentStatusSchema = z.enum([
  "DONE",
  "DONE_WITH_CONCERNS",
  "NEEDS_CONTEXT",
  "BLOCKED",
]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const AgentConcernSeveritySchema = z.enum(["info", "warning", "critical"]);
export type AgentConcernSeverity = z.infer<typeof AgentConcernSeveritySchema>;

export const AgentConcernSchema = z.object({
  area: z.string().min(1),
  description: z.string().min(1),
  severity: AgentConcernSeveritySchema,
});
export type AgentConcern = z.infer<typeof AgentConcernSchema>;

export const SelfReviewDimensionNameSchema = z.enum([
  "completeness",
  "quality",
  "discipline",
  "verification",
]);
export type SelfReviewDimensionName = z.infer<typeof SelfReviewDimensionNameSchema>;

export const SelfReviewDimensionSchema = z.object({
  dimension: SelfReviewDimensionNameSchema,
  passed: z.boolean(),
  note: z.string().optional(),
});
export type SelfReviewDimension = z.infer<typeof SelfReviewDimensionSchema>;

export const OverallConfidenceSchema = z.enum(["high", "medium", "low"]);
export type OverallConfidence = z.infer<typeof OverallConfidenceSchema>;

export const SelfReviewChecklistSchema = z.object({
  dimensions: z.array(SelfReviewDimensionSchema).length(4),
  overallConfidence: OverallConfidenceSchema,
});
export type SelfReviewChecklist = z.infer<typeof SelfReviewChecklistSchema>;

export const AgentStatusReportSchema = z.object({
  status: AgentStatusSchema,
  concerns: z.array(AgentConcernSchema).default([]),
  selfReview: SelfReviewChecklistSchema,
});
export type AgentStatusReport = z.infer<typeof AgentStatusReportSchema>;

export function isSuccessfulStatus(status: AgentStatus): boolean {
  return status === "DONE" || status === "DONE_WITH_CONCERNS";
}
```

**File:** `src/kernel/agents/agent-status-parse.error.ts`
```typescript
import { BaseDomainError } from "@kernel";

export class AgentStatusParseError extends BaseDomainError {
  readonly code = "AGENT_STATUS.PARSE_FAILED";

  constructor(
    message: string,
    public readonly rawOutput: string,
  ) {
    super(message);
  }
}
```

- [ ] Step 4: Run `npx vitest run src/kernel/agents/agent-status.schema.spec.ts`, verify PASS
- [ ] Step 5: Commit `feat(S06/T01): add agent status schemas + parse error class`

---

### T02: Agent status prompt constant
**Create:** `src/kernel/agents/agent-status-prompt.ts`
**Traces to:** AC9

- [ ] Step 1: Create the prompt constant

**File:** `src/kernel/agents/agent-status-prompt.ts`
```typescript
export const AGENT_STATUS_PROMPT = `
## Status Reporting Protocol

Before completing your response, you MUST report your status using the structured format below.

### Available Statuses

- **DONE** — Task completed successfully. No unresolved concerns. All acceptance criteria addressed.
- **DONE_WITH_CONCERNS** — Task completed, but you have concerns that should be reviewed. Use this when you are unsure about edge cases, test coverage, or design choices.
- **NEEDS_CONTEXT** — You cannot complete the task without additional information. Explain exactly what you need in the error field.
- **BLOCKED** — You hit an unrecoverable obstacle. Explain the blocker in the error field.

### Self-Review Checklist

Before reporting, evaluate your work on these 4 dimensions:
1. **completeness** — Did you address ALL acceptance criteria?
2. **quality** — Does your output meet quality standards (clean code, no shortcuts)?
3. **discipline** — Did you follow the prescribed methodology (TDD, commit conventions, architecture rules)?
4. **verification** — Did you verify your own work (tests pass, linting, manual checks)?

### Output Format

Emit this block at the END of your final response:

\`\`\`
<!-- TFF_STATUS_REPORT -->
{
  "status": "DONE",
  "concerns": [],
  "selfReview": {
    "dimensions": [
      { "dimension": "completeness", "passed": true },
      { "dimension": "quality", "passed": true },
      { "dimension": "discipline", "passed": true },
      { "dimension": "verification", "passed": true }
    ],
    "overallConfidence": "high"
  }
}
<!-- /TFF_STATUS_REPORT -->
\`\`\`

### Rules

- **Never report DONE if you have unresolved concerns** — use DONE_WITH_CONCERNS instead.
- **Never silently produce work you are unsure about** — surface concerns explicitly.
- If any self-review dimension fails, explain why in the dimension's "note" field and lower overallConfidence.
- The status report MUST be in your final message, at the very end.
`.trim();
```

- [ ] Step 2: Write prompt test

**File:** `src/kernel/agents/agent-status-prompt.spec.ts`
```typescript
import { describe, expect, it } from "vitest";
import { AGENT_STATUS_PROMPT } from "./agent-status-prompt";

describe("AGENT_STATUS_PROMPT", () => {
  it("contains all four status definitions", () => {
    expect(AGENT_STATUS_PROMPT).toContain("DONE");
    expect(AGENT_STATUS_PROMPT).toContain("DONE_WITH_CONCERNS");
    expect(AGENT_STATUS_PROMPT).toContain("NEEDS_CONTEXT");
    expect(AGENT_STATUS_PROMPT).toContain("BLOCKED");
  });

  it("contains self-review checklist dimensions", () => {
    expect(AGENT_STATUS_PROMPT).toContain("completeness");
    expect(AGENT_STATUS_PROMPT).toContain("quality");
    expect(AGENT_STATUS_PROMPT).toContain("discipline");
    expect(AGENT_STATUS_PROMPT).toContain("verification");
  });

  it("contains JSON output format with markers", () => {
    expect(AGENT_STATUS_PROMPT).toContain("TFF_STATUS_REPORT");
    expect(AGENT_STATUS_PROMPT).toContain("/TFF_STATUS_REPORT");
  });

  it("contains never-report-DONE-with-concerns rule", () => {
    expect(AGENT_STATUS_PROMPT).toContain("Never report DONE if you have unresolved concerns");
  });
});
```

- [ ] Step 3: Run `npx vitest run src/kernel/agents/agent-status-prompt.spec.ts`, verify PASS
- [ ] Step 4: Commit `feat(S06/T02): add agent status prompt constant`

---

## Wave 1 (parallel — depends on Wave 0)

### T03: Evolve AgentResult schema + builder + tests
**Modify:** `src/kernel/agents/agent-result.schema.ts`, `src/kernel/agents/agent-result.schema.spec.ts`, `src/kernel/agents/agent-result.builder.ts`, `src/kernel/agents/agent-result.builder.spec.ts`
**Traces to:** AC1, AC2, AC3

- [ ] Step 1: Update `agent-result.schema.spec.ts` (tests first)

**File:** `src/kernel/agents/agent-result.schema.spec.ts` (full replacement)
```typescript
import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";
import { AgentCostSchema, AgentResultSchema } from "./agent-result.schema";

const ALL_PASSED_DIMS = [
  { dimension: "completeness" as const, passed: true },
  { dimension: "quality" as const, passed: true },
  { dimension: "discipline" as const, passed: true },
  { dimension: "verification" as const, passed: true },
];

describe("AgentCostSchema", () => {
  it("parses valid cost", () => {
    const cost = AgentCostSchema.parse({
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      inputTokens: 1500,
      outputTokens: 800,
      costUsd: 0.015,
    });
    expect(cost.inputTokens).toBe(1500);
  });

  it("rejects negative token counts", () => {
    expect(() =>
      AgentCostSchema.parse({
        provider: "anthropic",
        modelId: "claude-sonnet-4-6",
        inputTokens: -1,
        outputTokens: 800,
        costUsd: 0.015,
      }),
    ).toThrow();
  });

  it("rejects non-integer tokens", () => {
    expect(() =>
      AgentCostSchema.parse({
        provider: "anthropic",
        modelId: "claude-sonnet-4-6",
        inputTokens: 1.5,
        outputTokens: 800,
        costUsd: 0.015,
      }),
    ).toThrow();
  });
});

describe("AgentResultSchema", () => {
  it("parses valid result with DONE status", () => {
    const result = AgentResultSchema.parse({
      taskId: faker.string.uuid(),
      agentType: "code-reviewer",
      status: "DONE",
      output: "Review complete. No issues found.",
      selfReview: { dimensions: ALL_PASSED_DIMS, overallConfidence: "high" },
      cost: {
        provider: "anthropic",
        modelId: "claude-opus-4-6",
        inputTokens: 5000,
        outputTokens: 2000,
        costUsd: 0.1,
      },
      durationMs: 45000,
    });
    expect(result.filesChanged).toEqual([]);
    expect(result.concerns).toEqual([]);
    expect(result.status).toBe("DONE");
    expect(result.error).toBeUndefined();
  });

  it("parses BLOCKED result with error", () => {
    const result = AgentResultSchema.parse({
      taskId: faker.string.uuid(),
      agentType: "fixer",
      status: "BLOCKED",
      output: "",
      selfReview: {
        dimensions: ALL_PASSED_DIMS.map((d) => ({ ...d, passed: false })),
        overallConfidence: "low",
      },
      cost: {
        provider: "anthropic",
        modelId: "claude-sonnet-4-6",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.001,
      },
      durationMs: 1000,
      error: "Test suite failed after fix attempt",
    });
    expect(result.status).toBe("BLOCKED");
    expect(result.error).toBe("Test suite failed after fix attempt");
  });

  it("rejects negative durationMs", () => {
    expect(() =>
      AgentResultSchema.parse({
        taskId: faker.string.uuid(),
        agentType: "fixer",
        status: "DONE",
        output: "Done",
        selfReview: { dimensions: ALL_PASSED_DIMS, overallConfidence: "high" },
        cost: {
          provider: "anthropic",
          modelId: "claude-sonnet-4-6",
          inputTokens: 100,
          outputTokens: 50,
          costUsd: 0.001,
        },
        durationMs: -1,
      }),
    ).toThrow();
  });
});
```

- [ ] Step 2: Update `agent-result.builder.spec.ts` (tests first — see Step 4 below for full code)

- [ ] Step 3: Run `npx vitest run src/kernel/agents/agent-result.schema.spec.ts src/kernel/agents/agent-result.builder.spec.ts`, verify FAIL (schema still has `success`, builder still has `withSuccess`)

- [ ] Step 4: Update `agent-result.schema.ts` — remove `success`, add `status`/`concerns`/`selfReview`

**File:** `src/kernel/agents/agent-result.schema.ts` (full replacement)
```typescript
import { IdSchema } from "@kernel/schemas";
import { z } from "zod";
import { AgentTypeSchema } from "./agent-card.schema";
import {
  AgentConcernSchema,
  AgentStatusSchema,
  SelfReviewChecklistSchema,
} from "./agent-status.schema";

export const AgentCostSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
});
export type AgentCost = z.infer<typeof AgentCostSchema>;

export const AgentResultSchema = z.object({
  taskId: IdSchema,
  agentType: AgentTypeSchema,
  status: AgentStatusSchema,
  output: z.string(),
  filesChanged: z.array(z.string()).default([]),
  concerns: z.array(AgentConcernSchema).default([]),
  selfReview: SelfReviewChecklistSchema,
  cost: AgentCostSchema,
  durationMs: z.number().int().nonnegative(),
  error: z.string().optional(),
});
export type AgentResult = z.infer<typeof AgentResultSchema>;
```

- [ ] Step 5: Update `agent-result.builder.ts`

```typescript
import { faker } from "@faker-js/faker";
import type { AgentType } from "./agent-card.schema";
import type { AgentCost, AgentResult } from "./agent-result.schema";
import { AgentResultSchema } from "./agent-result.schema";
import type { AgentConcern, AgentStatus, SelfReviewChecklist } from "./agent-status.schema";

const DEFAULT_SELF_REVIEW: SelfReviewChecklist = {
  dimensions: [
    { dimension: "completeness", passed: true },
    { dimension: "quality", passed: true },
    { dimension: "discipline", passed: true },
    { dimension: "verification", passed: true },
  ],
  overallConfidence: "high",
};

export class AgentResultBuilder {
  private _taskId: string = faker.string.uuid();
  private _agentType: AgentType = "fixer";
  private _status: AgentStatus = "DONE";
  private _output: string = faker.lorem.paragraph();
  private _filesChanged: string[] = [];
  private _concerns: AgentConcern[] = [];
  private _selfReview: SelfReviewChecklist = DEFAULT_SELF_REVIEW;
  private _cost: AgentCost = {
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
    inputTokens: faker.number.int({ min: 100, max: 10000 }),
    outputTokens: faker.number.int({ min: 50, max: 5000 }),
    costUsd: Number.parseFloat(faker.finance.amount({ min: 0.001, max: 1, dec: 4 })),
  };
  private _durationMs: number = faker.number.int({ min: 1000, max: 120000 });
  private _error?: string;

  withTaskId(taskId: string): this { this._taskId = taskId; return this; }
  withAgentType(agentType: AgentType): this { this._agentType = agentType; return this; }
  withStatus(status: AgentStatus): this { this._status = status; return this; }
  withOutput(output: string): this { this._output = output; return this; }
  withFilesChanged(files: string[]): this { this._filesChanged = files; return this; }
  withConcerns(concerns: AgentConcern[]): this { this._concerns = concerns; return this; }
  withSelfReview(selfReview: SelfReviewChecklist): this { this._selfReview = selfReview; return this; }
  withCost(cost: AgentCost): this { this._cost = cost; return this; }
  withDurationMs(ms: number): this { this._durationMs = ms; return this; }
  withError(error: string): this { this._error = error; return this; }

  asDone(): this { this._status = "DONE"; return this; }
  asDoneWithConcerns(concerns: AgentConcern[]): this {
    this._status = "DONE_WITH_CONCERNS";
    this._concerns = concerns;
    return this;
  }
  asBlocked(error: string): this {
    this._status = "BLOCKED";
    this._error = error;
    return this;
  }
  asNeedsContext(error: string): this {
    this._status = "NEEDS_CONTEXT";
    this._error = error;
    return this;
  }

  build(): AgentResult {
    return AgentResultSchema.parse({
      taskId: this._taskId,
      agentType: this._agentType,
      status: this._status,
      output: this._output,
      filesChanged: this._filesChanged,
      concerns: this._concerns,
      selfReview: this._selfReview,
      cost: this._cost,
      durationMs: this._durationMs,
      error: this._error,
    });
  }
}
```

- [ ] Step 4: Update `agent-result.builder.spec.ts`

```typescript
import { describe, expect, it } from "vitest";
import { AgentResultBuilder } from "./agent-result.builder";
import { AgentResultSchema } from "./agent-result.schema";

describe("AgentResultBuilder", () => {
  it("builds valid result with defaults", () => {
    const result = new AgentResultBuilder().build();
    expect(() => AgentResultSchema.parse(result)).not.toThrow();
    expect(result.status).toBe("DONE");
    expect(result.concerns).toEqual([]);
    expect(result.selfReview.overallConfidence).toBe("high");
  });

  it("builds BLOCKED result with asBlocked()", () => {
    const result = new AgentResultBuilder().asBlocked("Test suite failed").build();
    expect(result.status).toBe("BLOCKED");
    expect(result.error).toBe("Test suite failed");
  });

  it("builds DONE_WITH_CONCERNS with asDoneWithConcerns()", () => {
    const concerns = [{ area: "tests", description: "Missing edge case", severity: "warning" as const }];
    const result = new AgentResultBuilder().asDoneWithConcerns(concerns).build();
    expect(result.status).toBe("DONE_WITH_CONCERNS");
    expect(result.concerns).toEqual(concerns);
  });

  it("builds NEEDS_CONTEXT with asNeedsContext()", () => {
    const result = new AgentResultBuilder().asNeedsContext("Need DB schema").build();
    expect(result.status).toBe("NEEDS_CONTEXT");
    expect(result.error).toBe("Need DB schema");
  });

  it("overrides agentType", () => {
    const result = new AgentResultBuilder().withAgentType("security-auditor").build();
    expect(result.agentType).toBe("security-auditor");
  });

  it("overrides filesChanged", () => {
    const result = new AgentResultBuilder().withFilesChanged(["src/a.ts", "src/b.ts"]).build();
    expect(result.filesChanged).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("overrides cost", () => {
    const cost = { provider: "anthropic", modelId: "claude-opus-4-6", inputTokens: 10000, outputTokens: 5000, costUsd: 0.5 };
    const result = new AgentResultBuilder().withCost(cost).build();
    expect(result.cost).toEqual(cost);
  });

  it("is chainable", () => {
    const result = new AgentResultBuilder()
      .withAgentType("fixer")
      .withOutput("Fixed the bug")
      .withDurationMs(5000)
      .build();
    expect(result.agentType).toBe("fixer");
    expect(result.output).toBe("Fixed the bug");
    expect(result.durationMs).toBe(5000);
  });
});
```

- [ ] Step 7: Run `npx vitest run src/kernel/agents/agent-result.schema.spec.ts src/kernel/agents/agent-result.builder.spec.ts`, verify PASS
- [ ] Step 8: Commit `feat(S06/T03): evolve AgentResult schema + builder to status protocol`

---

### T04: Agent status parser + tests
**Create:** `src/kernel/agents/agent-status-parser.ts`, `src/kernel/agents/agent-status-parser.spec.ts`
**Traces to:** AC4, AC5

- [ ] Step 1: Write parser tests

**File:** `src/kernel/agents/agent-status-parser.spec.ts`
```typescript
import { describe, expect, it } from "vitest";
import { AgentStatusParseError } from "./agent-status-parse.error";
import { parseAgentStatusReport } from "./agent-status-parser";

const VALID_REPORT = JSON.stringify({
  status: "DONE",
  concerns: [],
  selfReview: {
    dimensions: [
      { dimension: "completeness", passed: true },
      { dimension: "quality", passed: true },
      { dimension: "discipline", passed: true },
      { dimension: "verification", passed: true },
    ],
    overallConfidence: "high",
  },
});

function wrap(json: string): string {
  return `Some agent output...\n<!-- TFF_STATUS_REPORT -->\n${json}\n<!-- /TFF_STATUS_REPORT -->`;
}

describe("parseAgentStatusReport", () => {
  it("extracts valid report from output", () => {
    const result = parseAgentStatusReport(wrap(VALID_REPORT));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe("DONE");
      expect(result.data.selfReview.overallConfidence).toBe("high");
    }
  });

  it("extracts report with concerns", () => {
    const json = JSON.stringify({
      status: "DONE_WITH_CONCERNS",
      concerns: [{ area: "tests", description: "Flaky test", severity: "warning" }],
      selfReview: {
        dimensions: [
          { dimension: "completeness", passed: true },
          { dimension: "quality", passed: true },
          { dimension: "discipline", passed: true },
          { dimension: "verification", passed: false, note: "Flaky test observed" },
        ],
        overallConfidence: "medium",
      },
    });
    const result = parseAgentStatusReport(wrap(json));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe("DONE_WITH_CONCERNS");
      expect(result.data.concerns).toHaveLength(1);
    }
  });

  it("returns error when markers are missing", () => {
    const result = parseAgentStatusReport("Just some output without markers");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(AgentStatusParseError);
      expect(result.error.code).toBe("AGENT_STATUS.PARSE_FAILED");
      expect(result.error.rawOutput).toContain("without markers");
    }
  });

  it("returns error when JSON is malformed", () => {
    const result = parseAgentStatusReport(wrap("{ not valid json }"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(AgentStatusParseError);
    }
  });

  it("returns error when JSON does not match schema", () => {
    const result = parseAgentStatusReport(wrap('{ "status": "INVALID" }'));
    expect(result.ok).toBe(false);
  });

  it("handles extra text around markers", () => {
    const output = `I've completed the task.\n\n<!-- TFF_STATUS_REPORT -->\n${VALID_REPORT}\n<!-- /TFF_STATUS_REPORT -->\n\nHope this helps!`;
    const result = parseAgentStatusReport(output);
    expect(result.ok).toBe(true);
  });

  it("preserves raw output in error", () => {
    const raw = "No markers here at all";
    const result = parseAgentStatusReport(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.rawOutput).toBe(raw);
    }
  });
});
```

- [ ] Step 2: Run `npx vitest run src/kernel/agents/agent-status-parser.spec.ts`, verify FAIL

- [ ] Step 3: Implement parser

**File:** `src/kernel/agents/agent-status-parser.ts`
```typescript
import { err, ok, type Result } from "@kernel";
import { AgentStatusParseError } from "./agent-status-parse.error";
import { type AgentStatusReport, AgentStatusReportSchema } from "./agent-status.schema";

const OPEN_MARKER = "<!-- TFF_STATUS_REPORT -->";
const CLOSE_MARKER = "<!-- /TFF_STATUS_REPORT -->";

export function parseAgentStatusReport(
  rawOutput: string,
): Result<AgentStatusReport, AgentStatusParseError> {
  const openIdx = rawOutput.indexOf(OPEN_MARKER);
  const closeIdx = rawOutput.indexOf(CLOSE_MARKER);

  if (openIdx === -1 || closeIdx === -1 || closeIdx <= openIdx) {
    return err(
      new AgentStatusParseError(
        "Status report markers not found in agent output",
        rawOutput,
      ),
    );
  }

  const jsonStr = rawOutput.slice(openIdx + OPEN_MARKER.length, closeIdx).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (cause) {
    return err(
      new AgentStatusParseError("Failed to parse status report JSON", rawOutput, cause),
    );
  }

  const validated = AgentStatusReportSchema.safeParse(parsed);
  if (!validated.success) {
    return err(
      new AgentStatusParseError(
        `Status report validation failed: ${validated.error.message}`,
        rawOutput,
        validated.error,
      ),
    );
  }

  return ok(validated.data);
}
```

- [ ] Step 4: Run `npx vitest run src/kernel/agents/agent-status-parser.spec.ts`, verify PASS
- [ ] Step 5: Commit `feat(S06/T04): add agent status report parser`

---

### T05: Agent status cross-checker + tests
**Create:** `src/kernel/agents/agent-status-cross-checker.ts`, `src/kernel/agents/agent-status-cross-checker.spec.ts`
**Traces to:** AC6

- [ ] Step 1: Write cross-checker tests

**File:** `src/kernel/agents/agent-status-cross-checker.spec.ts`
```typescript
import { describe, expect, it } from "vitest";
import { crossCheckAgentResult } from "./agent-status-cross-checker";
import type { AgentStatusReport } from "./agent-status.schema";

const ALL_PASSED_DIMS = [
  { dimension: "completeness" as const, passed: true },
  { dimension: "quality" as const, passed: true },
  { dimension: "discipline" as const, passed: true },
  { dimension: "verification" as const, passed: true },
];

function makeReport(overrides?: Partial<AgentStatusReport>): AgentStatusReport {
  return {
    status: "DONE",
    concerns: [],
    selfReview: { dimensions: ALL_PASSED_DIMS, overallConfidence: "high" },
    ...overrides,
  };
}

function makeTransport(overrides?: Record<string, unknown>) {
  return {
    filesChanged: ["src/file.ts"],
    durationMs: 5000,
    cost: { provider: "anthropic", modelId: "claude-sonnet-4-6", inputTokens: 1000, outputTokens: 500, costUsd: 0.01 },
    error: undefined as string | undefined,
    ...overrides,
  };
}

describe("crossCheckAgentResult", () => {
  it("returns valid when no discrepancies", () => {
    const result = crossCheckAgentResult(makeReport(), makeTransport(), "fixer");
    expect(result.valid).toBe(true);
    expect(result.discrepancies).toEqual([]);
  });

  it("flags completeness-passed + no filesChanged for fixer", () => {
    const result = crossCheckAgentResult(
      makeReport(),
      makeTransport({ filesChanged: [] }),
      "fixer",
    );
    expect(result.valid).toBe(false);
    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0].area).toBe("files-claim");
  });

  it("does NOT flag empty filesChanged for non-fixer agents", () => {
    const result = crossCheckAgentResult(
      makeReport(),
      makeTransport({ filesChanged: [] }),
      "code-reviewer",
    );
    expect(result.valid).toBe(true);
  });

  it("flags DONE with populated error", () => {
    const result = crossCheckAgentResult(
      makeReport(),
      makeTransport({ error: "Something went wrong" }),
      "fixer",
    );
    expect(result.valid).toBe(false);
    expect(result.discrepancies[0].area).toBe("error-consistency");
  });

  it("flags DONE with non-empty concerns", () => {
    const report = makeReport({
      status: "DONE",
      concerns: [{ area: "test", description: "Flaky", severity: "warning" }],
    });
    const result = crossCheckAgentResult(report, makeTransport(), "fixer");
    expect(result.valid).toBe(false);
    expect(result.discrepancies[0].area).toBe("concern-consistency");
  });

  it("does NOT flag DONE_WITH_CONCERNS with concerns", () => {
    const report = makeReport({
      status: "DONE_WITH_CONCERNS",
      concerns: [{ area: "test", description: "Flaky", severity: "warning" }],
    });
    const result = crossCheckAgentResult(report, makeTransport(), "fixer");
    expect(result.discrepancies.every((d) => d.area !== "concern-consistency")).toBe(true);
  });

  it("flags zero duration with non-zero tokens", () => {
    const result = crossCheckAgentResult(
      makeReport(),
      makeTransport({ durationMs: 0 }),
      "fixer",
    );
    expect(result.valid).toBe(false);
    expect(result.discrepancies[0].area).toBe("cost-sanity");
  });

  it("flags zero cost with non-zero tokens", () => {
    const result = crossCheckAgentResult(
      makeReport(),
      makeTransport({ cost: { provider: "anthropic", modelId: "m", inputTokens: 100, outputTokens: 50, costUsd: 0 } }),
      "fixer",
    );
    expect(result.valid).toBe(false);
    expect(result.discrepancies[0].area).toBe("cost-sanity");
  });
});
```

- [ ] Step 2: Run `npx vitest run src/kernel/agents/agent-status-cross-checker.spec.ts`, verify FAIL

- [ ] Step 3: Implement cross-checker

**File:** `src/kernel/agents/agent-status-cross-checker.ts`
```typescript
import type { AgentType } from "./agent-card.schema";
import type { AgentCost } from "./agent-result.schema";
import type { AgentConcern, AgentStatusReport } from "./agent-status.schema";

export interface AgentResultTransport {
  filesChanged: string[];
  durationMs: number;
  cost: AgentCost;
  error?: string;
}

export interface CrossCheckResult {
  valid: boolean;
  discrepancies: AgentConcern[];
}

export function crossCheckAgentResult(
  report: AgentStatusReport,
  transport: AgentResultTransport,
  agentType: AgentType,
): CrossCheckResult {
  const discrepancies: AgentConcern[] = [];

  // 1. Files claim: completeness passed but no files changed (fixer only)
  if (agentType === "fixer") {
    const completeness = report.selfReview.dimensions.find(
      (d) => d.dimension === "completeness",
    );
    if (completeness?.passed && transport.filesChanged.length === 0) {
      discrepancies.push({
        area: "files-claim",
        description:
          "Agent reported completeness passed but no files were changed (fixer agent expected to modify files)",
        severity: "warning",
      });
    }
  }

  // 2. Error consistency: DONE with populated error
  if (report.status === "DONE" && transport.error) {
    discrepancies.push({
      area: "error-consistency",
      description: `Agent reported DONE but error field is populated: "${transport.error}"`,
      severity: "warning",
    });
  }

  // 3. Concern consistency: DONE with non-empty concerns
  if (report.status === "DONE" && report.concerns.length > 0) {
    discrepancies.push({
      area: "concern-consistency",
      description: `Agent reported DONE but has ${report.concerns.length} concern(s) — should be DONE_WITH_CONCERNS`,
      severity: "warning",
    });
  }

  // 4. Cost sanity: zero duration or zero cost with non-zero tokens
  const totalTokens = transport.cost.inputTokens + transport.cost.outputTokens;
  if (totalTokens > 0 && (transport.durationMs === 0 || transport.cost.costUsd === 0)) {
    discrepancies.push({
      area: "cost-sanity",
      description: `${transport.durationMs === 0 ? "Zero duration" : "Zero cost"} with ${totalTokens} tokens — possible data issue`,
      severity: "warning",
    });
  }

  return { valid: discrepancies.length === 0, discrepancies };
}
```

- [ ] Step 4: Run `npx vitest run src/kernel/agents/agent-status-cross-checker.spec.ts`, verify PASS
- [ ] Step 5: Commit `feat(S06/T05): add agent status cross-checker`

---

## Wave 2 (parallel — depends on Wave 1)

### T06: PI adapter integration
**Modify:** `src/hexagons/execution/infrastructure/pi-agent-dispatch.adapter.ts`
**Traces to:** AC10

**Scope note:** The `stateError` path stays as `err(AgentDispatchError)` — changing it to `ok()` with BLOCKED would require contract test rework and is deferred to S07. Only the normal path (session completes without stateError) adds status parsing.

- [ ] Step 1: Update PI adapter with complete dispatch() method

Add these imports at the top of `pi-agent-dispatch.adapter.ts`:
```typescript
import type { AgentConcern, AgentStatus, SelfReviewChecklist } from "@kernel/agents/agent-status.schema";
import { AGENT_STATUS_PROMPT } from "@kernel/agents/agent-status-prompt";
import { parseAgentStatusReport } from "@kernel/agents/agent-status-parser";
import { crossCheckAgentResult } from "@kernel/agents/agent-status-cross-checker";
```

Add this constant at module level:
```typescript
const FAILED_SELF_REVIEW: SelfReviewChecklist = {
  dimensions: [
    { dimension: "completeness", passed: false },
    { dimension: "quality", passed: false },
    { dimension: "discipline", passed: false },
    { dimension: "verification", passed: false },
  ],
  overallConfidence: "low",
};
```

Replace the `dispatch()` method body (lines 89-148) with:
```typescript
async dispatch(config: AgentDispatchConfig): Promise<Result<AgentResult, AgentDispatchError>> {
  let session: AgentSession | undefined;
  try {
    const model = this.deps.resolveModel(config.model.provider, config.model.modelId);

    const tools = resolveTools(config.tools);
    const { session: created } = await createAgentSession({
      cwd: config.workingDirectory,
      model,
      tools: tools.length > 0 ? tools : undefined,
      sessionManager: SessionManager.inMemory(),
      authStorage: this.deps.authStorage,
      modelRegistry: this.deps.modelRegistry,
    });
    session = created;
    this.running.set(config.taskId, session);

    const startTime = Date.now();
    const fullSystemPrompt = config.systemPrompt
      ? `${config.systemPrompt}\n\n${AGENT_STATUS_PROMPT}`
      : AGENT_STATUS_PROMPT;
    const prompt = `${fullSystemPrompt}\n\n---\n\n${config.taskPrompt}`;

    await session.prompt(prompt);

    const durationMs = Date.now() - startTime;
    const stats = session.getSessionStats();
    const output = session.getLastAssistantText() ?? "";
    const stateError = session.state.error;

    this.running.delete(config.taskId);
    session.dispose();

    if (stateError) {
      return err(AgentDispatchError.unexpectedFailure(config.taskId, stateError));
    }

    // Parse agent status report from output
    const cost = {
      provider: config.model.provider,
      modelId: config.model.modelId,
      inputTokens: stats.tokens.input,
      outputTokens: stats.tokens.output,
      costUsd: stats.cost,
    };

    const parseResult = parseAgentStatusReport(output);
    let status: AgentStatus;
    let concerns: AgentConcern[];
    let selfReview: SelfReviewChecklist;

    if (parseResult.ok) {
      status = parseResult.data.status;
      concerns = [...parseResult.data.concerns];
      selfReview = parseResult.data.selfReview;
    } else {
      status = "BLOCKED";
      concerns = [{
        area: "status-protocol",
        description: `Failed to parse status report: ${parseResult.error.message}`,
        severity: "critical",
      }];
      selfReview = FAILED_SELF_REVIEW;
    }

    // Cross-check agent claims against transport data
    const crossCheck = crossCheckAgentResult(
      { status, concerns, selfReview },
      { filesChanged: [], durationMs, cost },
      config.agentType,
    );
    concerns.push(...crossCheck.discrepancies);

    return ok({
      taskId: config.taskId,
      agentType: config.agentType,
      status,
      output,
      filesChanged: [], // Git diff deferred to execution engine (S07)
      concerns,
      selfReview,
      cost,
      durationMs,
    });
  } catch (e) {
    this.running.delete(config.taskId);
    if (session) {
      session.dispose();
      return err(AgentDispatchError.unexpectedFailure(config.taskId, e));
    }
    return err(AgentDispatchError.sessionCreationFailed(config.taskId, e));
  }
}
```

- [ ] Step 2: Run `npx vitest run src/hexagons/execution/infrastructure/`, verify PASS (existing tests still work with updated builder defaults)
- [ ] Step 3: Commit `feat(S06/T06): integrate status protocol into PI adapter`

---

### T07: In-memory adapter + contract test updates
**Modify:** `src/hexagons/execution/infrastructure/in-memory-agent-dispatch.adapter.spec.ts`, `src/hexagons/execution/infrastructure/agent-dispatch.contract.spec.ts`
**Traces to:** AC1 (end-to-end)

- [ ] Step 1: Update contract spec — assert `result.data.status` instead of `result.data.success`

In `agent-dispatch.contract.spec.ts` line 59:
```typescript
// Before: expect(result.data.success).toBe(true);
// After:
expect(result.data.status).toBe("DONE");
```

- [ ] Step 2: Update in-memory adapter spec configurator — `givenSuccess` now produces status-aware results (via updated `AgentResultBuilder` defaults — no code change needed since builder already defaults to DONE)

- [ ] Step 3: Run `npx vitest run src/hexagons/execution/infrastructure/agent-dispatch.contract.spec.ts src/hexagons/execution/infrastructure/in-memory-agent-dispatch.adapter.spec.ts`, verify PASS
- [ ] Step 4: Commit `feat(S06/T07): update contract tests for status protocol`

---

### T08: Consumer migration + barrel exports + remaining tests
**Modify:** `src/kernel/agents/index.ts`, `src/hexagons/execution/application/record-task-metrics.use-case.ts`, `src/hexagons/execution/application/record-task-metrics.use-case.spec.ts`, `src/hexagons/execution/domain/events/task-execution-completed.event.spec.ts`
**Traces to:** AC8

- [ ] Step 1: Update barrel exports in `src/kernel/agents/index.ts`

Add:
```typescript
// Status protocol
export type {
  AgentConcern,
  AgentConcernSeverity,
  AgentStatus,
  AgentStatusReport,
  OverallConfidence,
  SelfReviewChecklist,
  SelfReviewDimension,
  SelfReviewDimensionName,
} from "./agent-status.schema";
export {
  AgentConcernSchema,
  AgentConcernSeveritySchema,
  AgentStatusReportSchema,
  AgentStatusSchema,
  isSuccessfulStatus,
  OverallConfidenceSchema,
  SelfReviewChecklistSchema,
  SelfReviewDimensionNameSchema,
  SelfReviewDimensionSchema,
} from "./agent-status.schema";
export { AgentStatusParseError } from "./agent-status-parse.error";
export { parseAgentStatusReport } from "./agent-status-parser";
export { AGENT_STATUS_PROMPT } from "./agent-status-prompt";
export type { AgentResultTransport, CrossCheckResult } from "./agent-status-cross-checker";
export { crossCheckAgentResult } from "./agent-status-cross-checker";
```

- [ ] Step 2: Update `record-task-metrics.use-case.ts` line 33

```typescript
// Before: success: event.agentResult.success,
// After:
import { isSuccessfulStatus } from "@kernel/agents";
// ...
success: isSuccessfulStatus(event.agentResult.status),
```

- [ ] Step 3: Update `record-task-metrics.use-case.spec.ts`

```typescript
// Line 61 — before: expect(metrics.success).toBe(agentResult.success);
// After (builder defaults to DONE, isSuccessfulStatus(DONE) = true):
expect(metrics.success).toBe(true);

// Line 69 — before: new AgentResultBuilder().withFailure("timeout").build()
// After (withFailure removed, use asBlocked):
new AgentResultBuilder().asBlocked("timeout").build()

// Line 89 — stays: expect(result.data[0].success).toBe(false);
// (BLOCKED → isSuccessfulStatus = false → TaskMetrics.success = false)
```

- [ ] Step 4: Update `task-execution-completed.event.spec.ts` line 43

```typescript
// Before: expect(event.agentResult.success).toBe(agentResult.success);
// After:
expect(event.agentResult.status).toBe(agentResult.status);
```

- [ ] Step 5: Run full test suite `npx vitest run`, verify all PASS
- [ ] Step 6: Commit `feat(S06/T08): migrate consumers + update barrel exports`
