# M02-S06: Agent Artifact Schemas — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Define Zod-first schemas for agent dispatch configs, results, and card manifests as kernel primitives. Provide a static registry and builders.
**Architecture:** Kernel module (`src/kernel/agents/`) — cross-cutting primitives imported by future hexagons.
**Tech Stack:** Zod 4, Vitest, @faker-js/faker

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/kernel/schemas.ts` | Modify | Add `ModelProfileNameSchema` (promoted from Settings) |
| `src/kernel/schemas.spec.ts` | Modify | Add `ModelProfileNameSchema` tests |
| `src/kernel/index.ts` | Modify | Re-export `ModelProfileNameSchema` + agent barrel |
| `src/hexagons/settings/domain/project-settings.schemas.ts` | Modify | Import `ModelProfileNameSchema` from kernel |
| `src/hexagons/settings/index.ts` | Modify | Re-export from kernel (keep external API stable) |
| `src/kernel/agents/agent-card.schema.ts` | Create | `AgentTypeSchema`, `AgentCapabilitySchema`, `AgentCardSchema` |
| `src/kernel/agents/agent-card.schema.spec.ts` | Create | Card schema tests |
| `src/kernel/agents/agent-dispatch.schema.ts` | Create | `ResolvedModelSchema`, `AgentDispatchConfigSchema` |
| `src/kernel/agents/agent-dispatch.schema.spec.ts` | Create | Dispatch schema tests |
| `src/kernel/agents/agent-result.schema.ts` | Create | `AgentCostSchema`, `AgentResultSchema` |
| `src/kernel/agents/agent-result.schema.spec.ts` | Create | Result schema tests |
| `src/kernel/agents/agent-registry.ts` | Create | `AGENT_REGISTRY`, `getAgentCard()`, `findAgentsByCapability()` |
| `src/kernel/agents/agent-registry.spec.ts` | Create | Registry completeness + query tests |
| `src/kernel/agents/agent-dispatch.builder.ts` | Create | `AgentDispatchConfigBuilder` |
| `src/kernel/agents/agent-dispatch.builder.spec.ts` | Create | Dispatch builder tests |
| `src/kernel/agents/agent-result.builder.ts` | Create | `AgentResultBuilder` |
| `src/kernel/agents/agent-result.builder.spec.ts` | Create | Result builder tests |
| `src/kernel/agents/index.ts` | Create | Barrel exports |

---

## Wave 0

### T01: Promote ModelProfileNameSchema to kernel

**Files:**
- Modify: `src/kernel/schemas.ts`
- Modify: `src/kernel/schemas.spec.ts`
- Modify: `src/hexagons/settings/domain/project-settings.schemas.ts`
- Modify: `src/hexagons/settings/index.ts`
- Modify: `src/kernel/index.ts`

**Traces to:** AC6 (ModelProfileNameSchema promoted to kernel)

**Step 1: Write failing test**
- **File**: `src/kernel/schemas.spec.ts`
- **Code**:
```typescript
describe("ModelProfileNameSchema", () => {
  it("accepts valid profile names", () => {
    expect(ModelProfileNameSchema.parse("quality")).toBe("quality");
    expect(ModelProfileNameSchema.parse("balanced")).toBe("balanced");
    expect(ModelProfileNameSchema.parse("budget")).toBe("budget");
  });

  it("rejects invalid profile name", () => {
    expect(() => ModelProfileNameSchema.parse("premium")).toThrow();
  });
});
```
- Add import `ModelProfileNameSchema` to existing import line.
- **Run**: `npx vitest run src/kernel/schemas.spec.ts`
- **Expect**: FAIL — `ModelProfileNameSchema` not exported from `./schemas`

**Step 2: Implement promotion**
- **File**: `src/kernel/schemas.ts` — add after `ComplexityTierSchema`:
```typescript
export const ModelProfileNameSchema = z.enum(["quality", "balanced", "budget"]);
export type ModelProfileName = z.infer<typeof ModelProfileNameSchema>;
```
- **File**: `src/kernel/index.ts` — add to type exports:
```typescript
export type { ComplexityTier, Id, ModelProfileName, Timestamp } from "./schemas";
export { ComplexityTierSchema, IdSchema, ModelProfileNameSchema, TimestampSchema } from "./schemas";
```
- **File**: `src/hexagons/settings/domain/project-settings.schemas.ts` — replace local definition:
  - Remove lines 10-11 (`export const ModelProfileNameSchema = ...` and `export type ModelProfileName = ...`)
  - Add import: `import { ModelProfileNameSchema } from "@kernel";`
  - Add: `export type ModelProfileName = z.infer<typeof ModelProfileNameSchema>;`
  - Re-export: `export { ModelProfileNameSchema };`
- **File**: `src/hexagons/settings/index.ts` — keep `ModelProfileNameSchema` in exports (now re-exported from kernel via settings schemas)
- **Run**: `npx vitest run src/kernel/schemas.spec.ts`
- **Expect**: PASS

**Step 3: Verify no regressions**
- **Run**: `npx vitest run`
- **Expect**: All tests PASS (Settings hexagon tests still work with re-exported schema)
- **Commit**: `refactor(S06/T01): promote ModelProfileNameSchema to kernel`

---

## Wave 1 (depends on T01)

### T02: AgentType + AgentCapability + AgentCard schemas

**Files:**
- Create: `src/kernel/agents/agent-card.schema.ts`
- Create: `src/kernel/agents/agent-card.schema.spec.ts`

**Depends on:** T01 (ModelProfileNameSchema in kernel)
**Traces to:** AC3 (AgentType enum), AC4 (queryable by capability)

**Step 1: Write failing test**
- **File**: `src/kernel/agents/agent-card.schema.spec.ts`
- **Code**:
```typescript
import { describe, expect, it } from "vitest";
import {
  AgentCapabilitySchema,
  AgentCardSchema,
  AgentTypeSchema,
} from "./agent-card.schema";

describe("AgentTypeSchema", () => {
  it("accepts valid agent types", () => {
    expect(AgentTypeSchema.parse("spec-reviewer")).toBe("spec-reviewer");
    expect(AgentTypeSchema.parse("code-reviewer")).toBe("code-reviewer");
    expect(AgentTypeSchema.parse("security-auditor")).toBe("security-auditor");
    expect(AgentTypeSchema.parse("fixer")).toBe("fixer");
  });

  it("rejects unknown agent type", () => {
    expect(() => AgentTypeSchema.parse("brainstormer")).toThrow();
  });
});

describe("AgentCapabilitySchema", () => {
  it("accepts valid capabilities", () => {
    expect(AgentCapabilitySchema.parse("review")).toBe("review");
    expect(AgentCapabilitySchema.parse("fix")).toBe("fix");
  });

  it("rejects unknown capability", () => {
    expect(() => AgentCapabilitySchema.parse("design")).toThrow();
  });
});

describe("AgentCardSchema", () => {
  it("parses a valid agent card", () => {
    const card = AgentCardSchema.parse({
      type: "code-reviewer",
      displayName: "Code Reviewer",
      description: "Reviews code for correctness, patterns, and security",
      capabilities: ["review"],
      defaultModelProfile: "quality",
      requiredTools: ["Read", "Glob", "Grep"],
    });
    expect(card.type).toBe("code-reviewer");
    expect(card.optionalTools).toEqual([]);
  });

  it("rejects card with empty capabilities", () => {
    expect(() =>
      AgentCardSchema.parse({
        type: "code-reviewer",
        displayName: "Code Reviewer",
        description: "Reviews code",
        capabilities: [],
        defaultModelProfile: "quality",
        requiredTools: [],
      }),
    ).toThrow();
  });

  it("rejects card with invalid model profile", () => {
    expect(() =>
      AgentCardSchema.parse({
        type: "code-reviewer",
        displayName: "Code Reviewer",
        description: "Reviews code",
        capabilities: ["review"],
        defaultModelProfile: "premium",
        requiredTools: [],
      }),
    ).toThrow();
  });
});
```
- **Run**: `npx vitest run src/kernel/agents/agent-card.schema.spec.ts`
- **Expect**: FAIL — module not found

**Step 2: Implement**
- **File**: `src/kernel/agents/agent-card.schema.ts`
- **Code**:
```typescript
import { z } from "zod";
import { ModelProfileNameSchema } from "@kernel/schemas";

export const AgentTypeSchema = z.enum([
  "spec-reviewer",
  "code-reviewer",
  "security-auditor",
  "fixer",
]);
export type AgentType = z.infer<typeof AgentTypeSchema>;

export const AgentCapabilitySchema = z.enum([
  "review",
  "fix",
]);
export type AgentCapability = z.infer<typeof AgentCapabilitySchema>;

export const AgentCardSchema = z.object({
  type: AgentTypeSchema,
  displayName: z.string().min(1),
  description: z.string().min(1),
  capabilities: z.array(AgentCapabilitySchema).min(1),
  defaultModelProfile: ModelProfileNameSchema,
  requiredTools: z.array(z.string()),
  optionalTools: z.array(z.string()).default([]),
});
export type AgentCard = z.infer<typeof AgentCardSchema>;
```
- **Run**: `npx vitest run src/kernel/agents/agent-card.schema.spec.ts`
- **Expect**: PASS — 5 tests passing
- **Commit**: `feat(S06/T02): add AgentType, AgentCapability, and AgentCard schemas`

---

## Wave 2 (parallel — depends on T02)

### T03: ResolvedModel + AgentDispatchConfig schemas

**Files:**
- Create: `src/kernel/agents/agent-dispatch.schema.ts`
- Create: `src/kernel/agents/agent-dispatch.schema.spec.ts`

**Depends on:** T02 (AgentTypeSchema)
**Traces to:** AC1 (AgentDispatchConfigSchema validates dispatch configs)

**Step 1: Write failing test**
- **File**: `src/kernel/agents/agent-dispatch.schema.spec.ts`
- **Code**:
```typescript
import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";
import {
  AgentDispatchConfigSchema,
  ResolvedModelSchema,
} from "./agent-dispatch.schema";

describe("ResolvedModelSchema", () => {
  it("parses valid model", () => {
    const model = ResolvedModelSchema.parse({
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
    });
    expect(model.provider).toBe("anthropic");
  });

  it("rejects empty provider", () => {
    expect(() =>
      ResolvedModelSchema.parse({ provider: "", modelId: "claude-sonnet-4-6" }),
    ).toThrow();
  });
});

describe("AgentDispatchConfigSchema", () => {
  it("parses valid dispatch config", () => {
    const config = AgentDispatchConfigSchema.parse({
      taskId: faker.string.uuid(),
      sliceId: faker.string.uuid(),
      agentType: "fixer",
      workingDirectory: "/tmp/work",
      systemPrompt: "You are a backend developer.",
      taskPrompt: "Implement the feature.",
      model: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      tools: ["Read", "Write", "Bash"],
    });
    expect(config.filePaths).toEqual([]);
    expect(config.tools).toHaveLength(3);
  });

  it("rejects config with empty tools array", () => {
    expect(() =>
      AgentDispatchConfigSchema.parse({
        taskId: faker.string.uuid(),
        sliceId: faker.string.uuid(),
        agentType: "fixer",
        workingDirectory: "/tmp/work",
        systemPrompt: "",
        taskPrompt: "Do it.",
        model: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
        tools: [],
      }),
    ).toThrow();
  });

  it("rejects config with invalid agentType", () => {
    expect(() =>
      AgentDispatchConfigSchema.parse({
        taskId: faker.string.uuid(),
        sliceId: faker.string.uuid(),
        agentType: "wizard",
        workingDirectory: "/tmp/work",
        systemPrompt: "",
        taskPrompt: "Do it.",
        model: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
        tools: ["Read"],
      }),
    ).toThrow();
  });
});
```
- **Run**: `npx vitest run src/kernel/agents/agent-dispatch.schema.spec.ts`
- **Expect**: FAIL — module not found

**Step 2: Implement**
- **File**: `src/kernel/agents/agent-dispatch.schema.ts`
- **Code**:
```typescript
import { z } from "zod";
import { IdSchema } from "@kernel/schemas";
import { AgentTypeSchema } from "./agent-card.schema";

export const ResolvedModelSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
});
export type ResolvedModel = z.infer<typeof ResolvedModelSchema>;

export const AgentDispatchConfigSchema = z.object({
  taskId: IdSchema,
  sliceId: IdSchema,
  agentType: AgentTypeSchema,
  workingDirectory: z.string().min(1),
  systemPrompt: z.string(),
  taskPrompt: z.string().min(1),
  model: ResolvedModelSchema,
  tools: z.array(z.string()).min(1),
  filePaths: z.array(z.string()).default([]),
});
export type AgentDispatchConfig = z.infer<typeof AgentDispatchConfigSchema>;
```
- **Run**: `npx vitest run src/kernel/agents/agent-dispatch.schema.spec.ts`
- **Expect**: PASS — 5 tests passing
- **Commit**: `feat(S06/T03): add ResolvedModel and AgentDispatchConfig schemas`

---

### T04: AgentCost + AgentResult schemas

**Files:**
- Create: `src/kernel/agents/agent-result.schema.ts`
- Create: `src/kernel/agents/agent-result.schema.spec.ts`

**Depends on:** T02 (AgentTypeSchema)
**Traces to:** AC2 (AgentResultSchema validates agent results)

**Step 1: Write failing test**
- **File**: `src/kernel/agents/agent-result.schema.spec.ts`
- **Code**:
```typescript
import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";
import { AgentCostSchema, AgentResultSchema } from "./agent-result.schema";

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
  it("parses valid result", () => {
    const result = AgentResultSchema.parse({
      taskId: faker.string.uuid(),
      agentType: "code-reviewer",
      success: true,
      output: "Review complete. No issues found.",
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
    expect(result.error).toBeUndefined();
  });

  it("parses failed result with error", () => {
    const result = AgentResultSchema.parse({
      taskId: faker.string.uuid(),
      agentType: "fixer",
      success: false,
      output: "",
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
    expect(result.success).toBe(false);
    expect(result.error).toBe("Test suite failed after fix attempt");
  });

  it("rejects negative durationMs", () => {
    expect(() =>
      AgentResultSchema.parse({
        taskId: faker.string.uuid(),
        agentType: "fixer",
        success: true,
        output: "Done",
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
- **Run**: `npx vitest run src/kernel/agents/agent-result.schema.spec.ts`
- **Expect**: FAIL — module not found

**Step 2: Implement**
- **File**: `src/kernel/agents/agent-result.schema.ts`
- **Code**:
```typescript
import { z } from "zod";
import { IdSchema } from "@kernel/schemas";
import { AgentTypeSchema } from "./agent-card.schema";

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
  success: z.boolean(),
  output: z.string(),
  filesChanged: z.array(z.string()).default([]),
  cost: AgentCostSchema,
  durationMs: z.number().int().nonnegative(),
  error: z.string().optional(),
});
export type AgentResult = z.infer<typeof AgentResultSchema>;
```
- **Run**: `npx vitest run src/kernel/agents/agent-result.schema.spec.ts`
- **Expect**: PASS — 6 tests passing
- **Commit**: `feat(S06/T04): add AgentCost and AgentResult schemas`

---

### T05: Agent registry + query helpers

**Files:**
- Create: `src/kernel/agents/agent-registry.ts`
- Create: `src/kernel/agents/agent-registry.spec.ts`

**Depends on:** T01 (ModelProfileNameSchema in kernel), T02 (AgentTypeSchema, AgentCardSchema)
**Traces to:** AC3 (every AgentType has card), AC4 (findAgentsByCapability), AC5 (getAgentCard direct return)

**Step 1: Write failing test**
- **File**: `src/kernel/agents/agent-registry.spec.ts`
- **Code**:
```typescript
import { describe, expect, it } from "vitest";
import { AgentTypeSchema } from "./agent-card.schema";
import type { AgentCapability, AgentType } from "./agent-card.schema";
import {
  AGENT_REGISTRY,
  findAgentsByCapability,
  getAgentCard,
} from "./agent-registry";

describe("AGENT_REGISTRY", () => {
  it("has an entry for every AgentType enum value", () => {
    const allTypes = AgentTypeSchema.options;
    for (const agentType of allTypes) {
      expect(
        AGENT_REGISTRY.has(agentType),
        `Missing registry entry for "${agentType}"`,
      ).toBe(true);
    }
  });

  it("has no extra entries beyond AgentType enum", () => {
    const allTypes = new Set<string>(AgentTypeSchema.options);
    for (const key of AGENT_REGISTRY.keys()) {
      expect(allTypes.has(key), `Unexpected registry entry "${key}"`).toBe(
        true,
      );
    }
  });
});

describe("getAgentCard", () => {
  it("returns the card for a valid agent type", () => {
    const card = getAgentCard("spec-reviewer");
    expect(card.type).toBe("spec-reviewer");
    expect(card.capabilities.length).toBeGreaterThan(0);
  });

  it("returns correct card for each agent type", () => {
    const allTypes: readonly AgentType[] = AgentTypeSchema.options;
    for (const agentType of allTypes) {
      const card = getAgentCard(agentType);
      expect(card.type).toBe(agentType);
    }
  });
});

describe("findAgentsByCapability", () => {
  it("returns agents with the review capability", () => {
    const agents = findAgentsByCapability("review");
    expect(agents.length).toBeGreaterThan(0);
    for (const agent of agents) {
      expect(agent.capabilities).toContain("review");
    }
  });

  it("returns agents with the fix capability", () => {
    const agents = findAgentsByCapability("fix");
    expect(agents.length).toBeGreaterThan(0);
    for (const agent of agents) {
      expect(agent.capabilities).toContain("fix");
    }
  });
});
```
- **Run**: `npx vitest run src/kernel/agents/agent-registry.spec.ts`
- **Expect**: FAIL — module not found

**Step 2: Implement**
- **File**: `src/kernel/agents/agent-registry.ts`
- **Code**:
```typescript
import type { AgentCapability, AgentCard, AgentType } from "./agent-card.schema";

export const AGENT_REGISTRY: ReadonlyMap<AgentType, AgentCard> = new Map<AgentType, AgentCard>([
  ["spec-reviewer", {
    type: "spec-reviewer",
    displayName: "Spec Reviewer",
    description: "Reviews specifications for completeness, buildability, and correctness",
    capabilities: ["review"],
    defaultModelProfile: "quality",
    requiredTools: ["Read", "Glob", "Grep"],
    optionalTools: [],
  }],
  ["code-reviewer", {
    type: "code-reviewer",
    displayName: "Code Reviewer",
    description: "Reviews code for correctness, patterns, and security",
    capabilities: ["review"],
    defaultModelProfile: "quality",
    requiredTools: ["Read", "Glob", "Grep"],
    optionalTools: [],
  }],
  ["security-auditor", {
    type: "security-auditor",
    displayName: "Security Auditor",
    description: "Audits code for security vulnerabilities and OWASP compliance",
    capabilities: ["review"],
    defaultModelProfile: "quality",
    requiredTools: ["Read", "Glob", "Grep"],
    optionalTools: [],
  }],
  ["fixer", {
    type: "fixer",
    displayName: "Fixer",
    description: "Diagnoses and fixes bugs, test failures, and review feedback",
    capabilities: ["fix"],
    defaultModelProfile: "budget",
    requiredTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    optionalTools: [],
  }],
]);

export function getAgentCard(type: AgentType): AgentCard {
  const card = AGENT_REGISTRY.get(type);
  if (!card) {
    throw new Error(`[BUG] Missing registry entry for agent type "${type}". This is a programming error — every AgentType must have a card.`);
  }
  return card;
}

export function findAgentsByCapability(capability: AgentCapability): AgentCard[] {
  const result: AgentCard[] = [];
  for (const card of AGENT_REGISTRY.values()) {
    if (card.capabilities.includes(capability)) {
      result.push(card);
    }
  }
  return result;
}
```
- **Run**: `npx vitest run src/kernel/agents/agent-registry.spec.ts`
- **Expect**: PASS — 6 tests passing
- **Commit**: `feat(S06/T05): add agent registry with query helpers`

---

## Wave 3 (depends on T03 + T04)

### T06: AgentDispatchConfigBuilder + AgentResultBuilder

**Files:**
- Create: `src/kernel/agents/agent-dispatch.builder.ts`
- Create: `src/kernel/agents/agent-dispatch.builder.spec.ts`
- Create: `src/kernel/agents/agent-result.builder.ts`
- Create: `src/kernel/agents/agent-result.builder.spec.ts`

**Depends on:** T03 (AgentDispatchConfigSchema), T04 (AgentResultSchema)
**Traces to:** AC8 (builders produce valid schema output with faker defaults)

**Step 1: Write failing tests**
- **File**: `src/kernel/agents/agent-dispatch.builder.spec.ts`
- **Code**:
```typescript
import { describe, expect, it } from "vitest";
import { AgentDispatchConfigSchema } from "./agent-dispatch.schema";
import { AgentDispatchConfigBuilder } from "./agent-dispatch.builder";

describe("AgentDispatchConfigBuilder", () => {
  it("builds valid config with defaults", () => {
    const config = new AgentDispatchConfigBuilder().build();
    expect(() => AgentDispatchConfigSchema.parse(config)).not.toThrow();
  });

  it("overrides taskId", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const config = new AgentDispatchConfigBuilder().withTaskId(id).build();
    expect(config.taskId).toBe(id);
  });

  it("overrides agentType", () => {
    const config = new AgentDispatchConfigBuilder()
      .withAgentType("code-reviewer")
      .build();
    expect(config.agentType).toBe("code-reviewer");
  });

  it("overrides model", () => {
    const config = new AgentDispatchConfigBuilder()
      .withModel({ provider: "openai", modelId: "gpt-4" })
      .build();
    expect(config.model.provider).toBe("openai");
  });

  it("overrides filePaths", () => {
    const config = new AgentDispatchConfigBuilder()
      .withFilePaths(["src/foo.ts", "src/bar.ts"])
      .build();
    expect(config.filePaths).toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  it("is chainable", () => {
    const config = new AgentDispatchConfigBuilder()
      .withAgentType("spec-reviewer")
      .withWorkingDirectory("/workspace")
      .withSystemPrompt("Review the spec.")
      .withTaskPrompt("Check completeness.")
      .withTools(["Read", "Glob"])
      .build();
    expect(config.agentType).toBe("spec-reviewer");
    expect(config.workingDirectory).toBe("/workspace");
  });
});
```
- **File**: `src/kernel/agents/agent-result.builder.spec.ts`
- **Code**:
```typescript
import { describe, expect, it } from "vitest";
import { AgentResultSchema } from "./agent-result.schema";
import { AgentResultBuilder } from "./agent-result.builder";

describe("AgentResultBuilder", () => {
  it("builds valid result with defaults", () => {
    const result = new AgentResultBuilder().build();
    expect(() => AgentResultSchema.parse(result)).not.toThrow();
    expect(result.success).toBe(true);
  });

  it("builds failure result with withFailure()", () => {
    const result = new AgentResultBuilder()
      .withFailure("Test suite failed")
      .build();
    expect(result.success).toBe(false);
    expect(result.error).toBe("Test suite failed");
  });

  it("overrides agentType", () => {
    const result = new AgentResultBuilder()
      .withAgentType("security-auditor")
      .build();
    expect(result.agentType).toBe("security-auditor");
  });

  it("overrides filesChanged", () => {
    const result = new AgentResultBuilder()
      .withFilesChanged(["src/a.ts", "src/b.ts"])
      .build();
    expect(result.filesChanged).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("overrides cost", () => {
    const cost = {
      provider: "anthropic",
      modelId: "claude-opus-4-6",
      inputTokens: 10000,
      outputTokens: 5000,
      costUsd: 0.5,
    };
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
- **Run**: `npx vitest run src/kernel/agents/agent-dispatch.builder.spec.ts src/kernel/agents/agent-result.builder.spec.ts`
- **Expect**: FAIL — modules not found

**Step 2: Implement builders**
- **File**: `src/kernel/agents/agent-dispatch.builder.ts`
- **Code**:
```typescript
import { faker } from "@faker-js/faker";
import type { AgentType } from "./agent-card.schema";
import type { AgentDispatchConfig, ResolvedModel } from "./agent-dispatch.schema";
import { AgentDispatchConfigSchema } from "./agent-dispatch.schema";

export class AgentDispatchConfigBuilder {
  private _taskId: string = faker.string.uuid();
  private _sliceId: string = faker.string.uuid();
  private _agentType: AgentType = "fixer";
  private _workingDirectory = "/tmp/test-workspace";
  private _systemPrompt: string = faker.lorem.paragraph();
  private _taskPrompt: string = faker.lorem.paragraph();
  private _model: ResolvedModel = { provider: "anthropic", modelId: "claude-sonnet-4-6" };
  private _tools: string[] = ["Read", "Write", "Bash"];
  private _filePaths: string[] = [];

  withTaskId(taskId: string): this { this._taskId = taskId; return this; }
  withSliceId(sliceId: string): this { this._sliceId = sliceId; return this; }
  withAgentType(agentType: AgentType): this { this._agentType = agentType; return this; }
  withWorkingDirectory(dir: string): this { this._workingDirectory = dir; return this; }
  withSystemPrompt(prompt: string): this { this._systemPrompt = prompt; return this; }
  withTaskPrompt(prompt: string): this { this._taskPrompt = prompt; return this; }
  withModel(model: ResolvedModel): this { this._model = model; return this; }
  withTools(tools: string[]): this { this._tools = tools; return this; }
  withFilePaths(paths: string[]): this { this._filePaths = paths; return this; }

  build(): AgentDispatchConfig {
    return AgentDispatchConfigSchema.parse({
      taskId: this._taskId,
      sliceId: this._sliceId,
      agentType: this._agentType,
      workingDirectory: this._workingDirectory,
      systemPrompt: this._systemPrompt,
      taskPrompt: this._taskPrompt,
      model: this._model,
      tools: this._tools,
      filePaths: this._filePaths,
    });
  }
}
```
- **File**: `src/kernel/agents/agent-result.builder.ts`
- **Code**:
```typescript
import { faker } from "@faker-js/faker";
import type { AgentType } from "./agent-card.schema";
import type { AgentCost, AgentResult } from "./agent-result.schema";
import { AgentResultSchema } from "./agent-result.schema";

export class AgentResultBuilder {
  private _taskId: string = faker.string.uuid();
  private _agentType: AgentType = "fixer";
  private _success = true;
  private _output: string = faker.lorem.paragraph();
  private _filesChanged: string[] = [];
  private _cost: AgentCost = {
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
    inputTokens: faker.number.int({ min: 100, max: 10000 }),
    outputTokens: faker.number.int({ min: 50, max: 5000 }),
    costUsd: parseFloat(faker.finance.amount({ min: 0.001, max: 1, dec: 4 })),
  };
  private _durationMs: number = faker.number.int({ min: 1000, max: 120000 });
  private _error?: string;

  withTaskId(taskId: string): this { this._taskId = taskId; return this; }
  withAgentType(agentType: AgentType): this { this._agentType = agentType; return this; }
  withSuccess(success: boolean): this { this._success = success; return this; }
  withOutput(output: string): this { this._output = output; return this; }
  withFilesChanged(files: string[]): this { this._filesChanged = files; return this; }
  withCost(cost: AgentCost): this { this._cost = cost; return this; }
  withDurationMs(ms: number): this { this._durationMs = ms; return this; }
  withError(error: string): this { this._error = error; return this; }

  withFailure(error: string): this {
    this._success = false;
    this._error = error;
    return this;
  }

  build(): AgentResult {
    return AgentResultSchema.parse({
      taskId: this._taskId,
      agentType: this._agentType,
      success: this._success,
      output: this._output,
      filesChanged: this._filesChanged,
      cost: this._cost,
      durationMs: this._durationMs,
      error: this._error,
    });
  }
}
```
- **Run**: `npx vitest run src/kernel/agents/agent-dispatch.builder.spec.ts src/kernel/agents/agent-result.builder.spec.ts`
- **Expect**: PASS — 12 tests passing
- **Commit**: `feat(S06/T06): add AgentDispatchConfig and AgentResult builders`

---

## Wave 4 (depends on all previous)

### T07: Barrel exports + full verification

**Files:**
- Create: `src/kernel/agents/index.ts`
- Modify: `src/kernel/index.ts`

**Depends on:** T01-T06
**Traces to:** AC7 (all schemas, types, and registry exported)

**Step 1: Create barrel + update kernel index**
- **File**: `src/kernel/agents/index.ts`
- **Code**:
```typescript
// Schemas
export type { AgentCapability, AgentCard, AgentType } from "./agent-card.schema";
export { AgentCapabilitySchema, AgentCardSchema, AgentTypeSchema } from "./agent-card.schema";

export type { AgentDispatchConfig, ResolvedModel } from "./agent-dispatch.schema";
export { AgentDispatchConfigSchema, ResolvedModelSchema } from "./agent-dispatch.schema";

export type { AgentCost, AgentResult } from "./agent-result.schema";
export { AgentCostSchema, AgentResultSchema } from "./agent-result.schema";

// Registry
export { AGENT_REGISTRY, findAgentsByCapability, getAgentCard } from "./agent-registry";

// Builders
export { AgentDispatchConfigBuilder } from "./agent-dispatch.builder";
export { AgentResultBuilder } from "./agent-result.builder";
```
- **File**: `src/kernel/index.ts` — add at the end:
```typescript
// Agent artifacts
export {
  AGENT_REGISTRY,
  AgentCapabilitySchema,
  AgentCardSchema,
  AgentCostSchema,
  AgentDispatchConfigBuilder,
  AgentDispatchConfigSchema,
  AgentResultBuilder,
  AgentResultSchema,
  AgentTypeSchema,
  findAgentsByCapability,
  getAgentCard,
  ResolvedModelSchema,
} from "./agents";
export type {
  AgentCapability,
  AgentCard,
  AgentCost,
  AgentDispatchConfig,
  AgentResult,
  AgentType,
  ResolvedModel,
} from "./agents";
```
- **Run**: `npx vitest run`
- **Expect**: All tests PASS (full suite, no regressions)
- **Commit**: `feat(S06/T07): add barrel exports for agent artifacts`
