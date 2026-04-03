# M02-S06: Agent Artifact Schemas

## Problem

The TFF orchestrator dispatches multiple specialized agents (brainstormer, code-reviewer, fixer, etc.) to perform tasks. Currently there are no validated schemas for the data passed between the orchestrator and agents. Without structured contracts, agent dispatch configs and results are free-form, leading to runtime surprises and making dynamic routing impossible.

## Approach

Define Zod-first schemas for all agent-to-agent data as kernel primitives in `src/kernel/agents/`. Provide a static Agent Card registry mapping each agent type to its capabilities, required tools, and default model profile. Include builders for test ergonomics.

Key decisions:
- **Static registry** over runtime-loaded manifests — agent types are known at build time
- **Kernel placement** — schemas are cross-cutting primitives used by Execution, CLI, and Settings hexagons
- **Self-contained model reference** — `ResolvedModel { provider, modelId }` with no import dependency on Settings hexagon
- **Promote ModelProfileName to kernel** — move `ModelProfileNameSchema` from Settings to `kernel/schemas.ts` to prevent duplication drift; both Settings hexagon and agent schemas import from kernel
- **Direct return for exhaustive registry** — `getAgentCard()` returns `AgentCard` directly (not `Result`) since exhaustiveness is enforced by tests; no `AgentNotFoundError` needed

## File Structure

```
src/kernel/agents/
  agent-dispatch.schema.ts    # AgentDispatchConfigSchema + ResolvedModelSchema
  agent-result.schema.ts      # AgentResultSchema + AgentCostSchema
  agent-card.schema.ts        # AgentTypeSchema + AgentCapabilitySchema + AgentCardSchema (imports ModelProfileNameSchema from kernel)
  agent-registry.ts           # AGENT_REGISTRY + findAgentsByCapability() + getAgentCard()
  agent-dispatch.builder.ts   # AgentDispatchConfigBuilder
  agent-result.builder.ts     # AgentResultBuilder
  index.ts                    # Barrel exports
```

## Schemas

### ResolvedModel

```typescript
export const ResolvedModelSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
});
export type ResolvedModel = z.infer<typeof ResolvedModelSchema>;
```

### AgentDispatchConfig

```typescript
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

### AgentCost

```typescript
export const AgentCostSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
});
export type AgentCost = z.infer<typeof AgentCostSchema>;
```

### AgentResult

```typescript
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

### AgentType & AgentCapability

```typescript
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

// ModelProfileNameSchema promoted to kernel/schemas.ts (shared with Settings hexagon)
// import { ModelProfileNameSchema } from "../../schemas";
```

### AgentCard

```typescript
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

## Registry

Static `AGENT_REGISTRY: ReadonlyMap<AgentType, AgentCard>` with one entry per `AgentType` enum value.

Query helpers:
- `getAgentCard(type: AgentType): AgentCard` — direct return with runtime assertion (exhaustiveness enforced by tests)
- `findAgentsByCapability(capability: AgentCapability): AgentCard[]` — returns empty array if no match

## Builders

### AgentDispatchConfigBuilder

Chainable builder with faker defaults. Methods: `withTaskId()`, `withSliceId()`, `withAgentType()`, `withWorkingDirectory()`, `withSystemPrompt()`, `withTaskPrompt()`, `withModel()`, `withTools()`, `withFilePaths()`. `build()` returns parsed `AgentDispatchConfig`.

### AgentResultBuilder

Chainable builder with faker defaults. Methods: `withTaskId()`, `withAgentType()`, `withSuccess()`, `withOutput()`, `withFilesChanged()`, `withCost()`, `withDurationMs()`, `withError()`, `withFailure(error)` (sets success=false + error). `build()` returns parsed `AgentResult`.

## Non-Goals

- No runtime agent dispatch logic (Execution hexagon, M04)
- No YAML/JSON manifest file loading
- No agent lifecycle management
- No PI SDK tool registration integration (M02-S07)
- No `AgentPort` or infrastructure adapters — pure domain schemas

## Testing Strategy

- **Schema validation**: valid inputs parse, invalid inputs rejected with Zod errors
- **Builder defaults**: `new XBuilder().build()` produces valid schema output
- **Builder chaining**: all `withX()` methods override defaults correctly
- **Registry completeness**: every `AgentType` enum value has a registry entry
- **Registry queries**: `getAgentCard()` returns correct card, `findAgentsByCapability()` returns matching agents
- **Barrel exports**: all public types accessible from `kernel/agents/index.ts`

## Acceptance Criteria

- [ ] `AgentDispatchConfigSchema.parse()` validates all dispatch configs at boundary
- [ ] `AgentResultSchema.parse()` validates all agent results at boundary
- [ ] Every `AgentType` enum value has a corresponding `AgentCard` in the registry
- [ ] `findAgentsByCapability()` returns correct agents for each capability
- [ ] `getAgentCard()` returns `AgentCard` directly with runtime assertion for exhaustive registry
- [ ] `ModelProfileNameSchema` promoted to `kernel/schemas.ts` and imported by both Settings hexagon and agent schemas
- [ ] All schemas, types, and registry are exported from `kernel/agents/index.ts`
- [ ] Builders produce valid schema output with sensible faker defaults
