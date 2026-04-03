# S01: pi-ai Direct Dependency + Type Cleanup

## Context

- **Milestone:** M06 — PI-Native Integration
- **Slice:** M06-S01
- **Wave:** 1 (parallel with S02)
- **Complexity:** S-tier

## Goal

Promote `@mariozechner/pi-ai` from transitive to direct dependency. Replace hand-written type aliases in `pi.types.ts` with real PI SDK type re-exports. Adapt `createZodTool` bridge to work with real `ToolDefinition` types.

## Scope

### In scope

- Add `@mariozechner/pi-ai` as direct dependency in `package.json`
- Transform `pi.types.ts` from hand-written interfaces to re-export barrel (sourcing from `@mariozechner/pi-coding-agent` and `@mariozechner/pi-ai`)
- Adapt `createZodTool.ts` to bridge Zod→JSON Schema against real `ToolDefinition<TSchema>` type
- Update `tool-result.helper.ts` imports to use real `AgentToolResult` type
- Update `index.ts` barrel to reflect new re-export surface
- Delete `pi.types.spec.ts` (type conformance tested by compilation)

### Out of scope

- Migration from Zod to TypeBox — TFF stays Zod-first
- Domain port changes — no kernel modifications
- New tool registration patterns
- Changes to downstream tool files (preserved by barrel re-exports)
- `@sinclair/typebox` promotion to direct dependency (stays transitive)

## Design

### 1. `pi.types.ts` — Re-export Barrel

Replace all hand-written interfaces with re-exports from real packages:

```typescript
// Extension types from pi-coding-agent (originally from pi-agent-core)
export type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  RegisteredCommand,
  ToolDefinition,
} from "@mariozechner/pi-coding-agent";

// AI types from pi-ai
export type {
  Api,
  KnownProvider,
  Model,
  Provider,
  Usage,
} from "@mariozechner/pi-ai";

// Convenience alias (pi-coding-agent uses Omit<RegisteredCommand, "name" | "sourceInfo">)
export type RegisterCommandOptions = Omit<
  import("@mariozechner/pi-coding-agent").RegisteredCommand,
  "name" | "sourceInfo"
>;
```

**R01 AC3 interpretation:** "No indirection layer" means no hand-written type replicas. The barrel re-export is a pass-through — downstream imports resolve to the real SDK types at compilation. The `@infrastructure/pi` import path is an architectural boundary, not an indirection.

**Removed types:**
- `ContentBlock` — replaced by PI SDK's `TextContent | ImageContent` (consumed via `AgentToolResult`, not directly)

**Key type difference — `AgentToolResult.details` is required:**
The real `AgentToolResult<T>` from `pi-agent-core` has `details: T` (required), not optional. All return sites that omit `details` must be updated. See sections 2 and 3.

### 2. `createZodTool.ts` — Zod-to-PI Bridge

```typescript
import type { TSchema } from "@mariozechner/pi-ai";
import type {
  AgentToolResult,
  ExtensionContext,
  ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import type { z } from "zod";
import { toJSONSchema } from "zod";

export interface ZodToolConfig<T extends z.ZodObject<z.ZodRawShape>> {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  schema: T;
  execute: (
    params: z.infer<T>,
    signal: AbortSignal,
    ctx: ExtensionContext,
  ) => Promise<AgentToolResult<undefined>>;
}

export function createZodTool<T extends z.ZodObject<z.ZodRawShape>>(
  config: ZodToolConfig<T>,
): ToolDefinition {
  const jsonSchema = toJSONSchema(config.schema, {
    target: "draft-07",
    unrepresentable: "any",
  });

  return {
    name: config.name,
    label: config.label,
    description: config.description,
    promptSnippet: config.promptSnippet,
    promptGuidelines: config.promptGuidelines,
    parameters: jsonSchema as unknown as TSchema,
    async execute(_toolCallId, rawParams, signal, _onUpdate, ctx) {
      const parsed = config.schema.safeParse(rawParams);
      if (!parsed.success) {
        return {
          content: [{ type: "text" as const, text: `Validation error: ${parsed.error.message}` }],
          details: undefined,
        };
      }
      return config.execute(parsed.data, signal ?? new AbortController().signal, ctx);
    },
  };
}
```

Key changes:
- `parameters: jsonSchema as unknown as TSchema` — nominal cast from Zod JSON Schema to TypeBox's `TSchema`. Both produce structurally identical JSON Schema Draft-07 at runtime.
- `TSchema` imported from `@mariozechner/pi-ai` (which re-exports from `@sinclair/typebox`) to avoid promoting TypeBox to a direct dependency.
- `ZodToolConfig.execute` return type narrowed to `AgentToolResult<undefined>` — TFF tools don't use the `details` field for custom rendering.
- Error branch includes `details: undefined` to satisfy the required field.

### 3. `tool-result.helper.ts`

```typescript
import type { AgentToolResult } from "@mariozechner/pi-coding-agent";

export const textResult = (text: string): AgentToolResult<undefined> => ({
  content: [{ type: "text", text }],
  details: undefined,
});
```

`details: undefined` satisfies the required `details: T` field on the real `AgentToolResult<T>`. Return type explicitly `AgentToolResult<undefined>`.

### 4. `index.ts` Barrel

```typescript
// Types (re-exported via pi.types.ts barrel)
export type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  RegisterCommandOptions,
  ToolDefinition,
} from "./pi.types";

// Also export AI types for consumers that need them
export type { Api, KnownProvider, Model, Provider, Usage } from "./pi.types";

// Values
export { createZodTool } from "./create-zod-tool";
export type { ZodToolConfig } from "./create-zod-tool";
export { textResult } from "./tool-result.helper";
```

### 5. `package.json`

```json
"dependencies": {
  "@mariozechner/pi-ai": "^0.64.0",
  "@mariozechner/pi-coding-agent": "^0.64.0",
  "yaml": "^2.8.3",
  "zod": "^4.3.6"
}
```

### 6. Deleted Files

- `pi.types.spec.ts` — type conformance is now tested by TypeScript compilation, not runtime assertions

## File Impact

| File | Action |
|------|--------|
| `package.json` | Add `@mariozechner/pi-ai` direct dependency |
| `src/infrastructure/pi/pi.types.ts` | Rewrite: hand-written → re-export barrel |
| `src/infrastructure/pi/create-zod-tool.ts` | Update imports, add `TSchema` cast |
| `src/infrastructure/pi/tool-result.helper.ts` | Update import source |
| `src/infrastructure/pi/index.ts` | Update re-export list |
| `src/infrastructure/pi/pi.types.spec.ts` | Delete |

**Downstream consumers (0 changes):** All `*.tool.ts`, `*.extension.ts` files keep importing from `@infrastructure/pi` unchanged.

## Acceptance Criteria

1. `@mariozechner/pi-ai` is a direct dependency in `package.json`
2. `pi.types.ts` contains only re-exports — no hand-written interface definitions
3. All infrastructure adapters compile against real PI SDK types
4. `createZodTool` bridges Zod→JSON Schema with `TSchema` cast
5. `tool-result.helper.ts` imports from real types
6. `pi.types.spec.ts` deleted
7. All existing tests pass (`npm test` green)
8. `index.ts` barrel preserves `@infrastructure/pi` import path — zero downstream changes

## Risks

| Risk | Mitigation |
|------|------------|
| `TSchema` cast hides type drift if PI SDK changes JSON Schema expectations | Covered by integration tests — tools register and execute via PI runtime |
| Real `ExtensionContext` has more members than hand-written subset | Superset — all current usages valid, no breaking change |
| `ContentBlock` removal breaks consumers | Grep confirms no direct `ContentBlock` imports outside deleted spec file |
