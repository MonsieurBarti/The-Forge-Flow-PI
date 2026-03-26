# M02-S07 Research: CLI Bootstrap + PI SDK Wiring

## 1. PI SDK Extension API Surface

**Status:** PI SDK packages (`@mariozechner/pi-coding-agent`, `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`) are **not yet installed**. Findings below come from inspecting the published npm packages (v0.62.0).

### 1.1 Extension Factory Pattern

Extensions are default-exported functions receiving `ExtensionAPI`:

```typescript
export default function (api: ExtensionAPI): void {
  api.registerCommand('tff:new', { ... });
  api.registerTool({ ... });
}
```

Extensions are **auto-discovered** by the `ResourceLoader` (scanning `pi-packages/` or extension directories), NOT passed as a path array to `createAgentSession()`. The spec's `extensions: ['./extension.ts']` is illustrative — not the actual API.

**Impact on spec:** `main.ts` should either:
- Use a custom `ResourceLoader` that loads our extension directly, OR
- Register tools/commands via `customTools` option in `createAgentSession()`, OR
- Follow PI SDK's extension discovery conventions (place extension where ResourceLoader finds it)

**Recommendation:** Use `customTools` in `createAgentSession()` for tools, and call the extension factory directly after session creation for commands. This keeps us decoupled from PI's discovery mechanism.

### 1.2 Tool Registration

**ToolDefinition interface:**

```typescript
interface ToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown, TState = any> {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;          // One-line for "Available tools" in system prompt
  promptGuidelines?: string[];     // Guideline bullets appended to system prompt
  parameters: TParams;             // TypeBox TSchema
  execute(
    toolCallId: string,
    params: Static<TParams>,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<TDetails>>;
  renderCall?: (...) => Component;   // Custom UI rendering
  renderResult?: (...) => Component; // Custom UI rendering
}
```

**Key finding:** `parameters` is typed as TypeBox `TSchema`. TypeBox schemas are JSON Schema objects with a `Symbol` tag at the type level. At runtime, PI SDK serializes them as plain JSON Schema for the LLM. A plain JSON Schema object (from Zod's `toJSONSchema()`) will work at runtime; we only need a type-level cast to satisfy TypeScript.

**AgentToolResult:**

```typescript
interface AgentToolResult<TDetails = unknown> {
  content: Array<ContentBlock>;
  details?: TDetails;
}
// ContentBlock = { type: "text"; text: string } | { type: "object"; data: any }
```

### 1.3 Command Registration

```typescript
pi.registerCommand('tff:new', {
  description?: string;
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
  getArgumentCompletions?: (prefix: string) => AutocompleteItem[] | null;
});
```

`args` is the raw unparsed string after the command name. `ExtensionCommandContext` extends `ExtensionContext` with methods like `waitForIdle()`, `newSession()`, `fork()`.

### 1.4 createAgentSession Bootstrap

```typescript
async function createAgentSession(options?: CreateAgentSessionOptions): Promise<CreateAgentSessionResult>;

interface CreateAgentSessionOptions {
  cwd?: string;
  agentDir?: string;
  authStorage?: AuthStorage;
  modelRegistry?: ModelRegistry;
  model?: Model<any>;
  thinkingLevel?: ThinkingLevel;
  tools?: Tool[];              // Built-in tools to use
  customTools?: ToolDefinition[];  // Custom tools (in addition to built-in)
  resourceLoader?: ResourceLoader;
  sessionManager?: SessionManager;
  settingsManager?: SettingsManager;
}

interface CreateAgentSessionResult {
  session: AgentSession;
  extensionsResult: LoadExtensionsResult;
  modelFallbackMessage?: string;
}
```

### 1.5 ExtensionContext (available in tool execute)

```typescript
interface ExtensionContext {
  ui: ExtensionUIContext;
  hasUI: boolean;
  cwd: string;
  sessionManager: ReadonlySessionManager;
  modelRegistry: ModelRegistry;
  model: Model<any> | undefined;
  isIdle(): boolean;
  abort(): void;
  shutdown(): void;
  getContextUsage(): ContextUsage | undefined;
  compact(options?: CompactOptions): void;
  getSystemPrompt(): string;
}
```

### 1.6 Spec Deviations

| Spec Assumption | Reality | Impact |
|---|---|---|
| `extensions: ['./extension.ts']` param | No such param; extensions auto-discovered or via `customTools` | Adjust `main.ts` bootstrap |
| `execute(args, signal)` signature | `execute(toolCallId, params, signal, onUpdate, ctx)` — 5 params | Update `createZodTool` wrapper |
| `ToolResult = { content, details }` | `AgentToolResult = { content: ContentBlock[], details? }` | Minor — shape is compatible |
| `parameters: TObject` (TypeBox) | `parameters: TSchema` (TypeBox supertype) | Cast JSON Schema to `TSchema` |

---

## 2. Zod-to-JSON-Schema Bridge

### 2.1 Zod Version

- **Installed:** Zod 4.3.6 (ESM module)
- **Package.json:** `"zod": "^4.3.6"`

### 2.2 Decision: Use Zod 4 Built-in `toJSONSchema()`

Zod 4 ships a native `toJSONSchema()` function. No need for `zod-to-json-schema` npm package.

```typescript
import { toJSONSchema } from 'zod';

const jsonSchema = toJSONSchema(zodSchema, {
  target: 'draft-07',
  unrepresentable: 'any',  // Transforms degrade to {} instead of throwing
});
```

**Verified output for all spec-required types:**

| Zod Type | JSON Schema Output | Notes |
|---|---|---|
| `z.string()` | `{ "type": "string" }` | Correct |
| `z.number()` | `{ "type": "number" }` | Correct |
| `z.boolean()` | `{ "type": "boolean" }` | Correct |
| `z.enum(['a','b'])` | `{ "type": "string", "enum": ["a","b"] }` | Correct |
| `z.array(z.string())` | `{ "type": "array", "items": { "type": "string" } }` | Correct |
| `z.optional()` | Removed from `required` array | Correct |
| `z.default(0)` | `{ "default": 0, ... }`, stays in `required` | Default is a hint; Zod applies it at parse time |
| `z.object({...})` | Full JSON Schema 7 object with `additionalProperties: false` | Correct |

**Transform handling:** `z.string().transform(...)` degrades to `{}` with `unrepresentable: 'any'`. This is acceptable since the spec prohibits transforms in tool schemas.

### 2.3 Implication: Drop `zod-to-json-schema` Dependency

The spec lists `zod-to-json-schema` as a dependency. Since Zod 4 includes this natively, we should **not add `zod-to-json-schema`** — one fewer dependency.

### 2.4 createZodTool Bridge Strategy

```typescript
import { toJSONSchema } from 'zod';
import type { z } from 'zod';
import type { TSchema } from '@sinclair/typebox';  // Transitive via PI SDK

export function createZodTool<T extends z.ZodObject<z.ZodRawShape>>(config: {
  name: string;
  label: string;
  description: string;
  schema: T;
  execute: (params: z.infer<T>, signal: AbortSignal, ctx: ExtensionContext) => Promise<AgentToolResult>;
}): ToolDefinition {
  const jsonSchema = toJSONSchema(config.schema, {
    target: 'draft-07',
    unrepresentable: 'any',
  });

  return {
    name: config.name,
    label: config.label,
    description: config.description,
    parameters: jsonSchema as unknown as TSchema,  // Runtime-compatible cast
    async execute(toolCallId, rawParams, signal, onUpdate, ctx) {
      const parsed = config.schema.safeParse(rawParams);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: `Validation error: ${parsed.error.message}` }],
        };
      }
      return config.execute(parsed.data, signal ?? new AbortController().signal, ctx);
    },
  };
}
```

The `as unknown as TSchema` cast is safe because:
1. TypeBox `TSchema` is structurally a JSON Schema object with a runtime `Symbol` tag
2. PI SDK serializes parameters to JSON for the LLM — it reads `type`, `properties`, `required` etc.
3. Runtime behavior doesn't depend on the TypeBox Symbol
4. We do our own validation via `safeParse` — we don't rely on TypeBox validation

---

## 3. Existing Codebase Integration Points

### 3.1 Hexagon Barrels (What's Already Exported)

| Hexagon | Key Exports |
|---|---|
| **Project** | `ProjectRepositoryPort`, `ProjectDTO`, `ProjectPropsSchema`, `ProjectInitializedEvent` |
| **Milestone** | `MilestoneRepositoryPort`, `MilestoneDTO`, `MilestoneStatusSchema`, `MilestoneCreatedEvent`, `MilestoneClosedEvent` |
| **Slice** | `SliceRepositoryPort`, `SliceDTO`, `SliceStatusSchema`, `ComplexityTierSchema`, `SliceCreatedEvent`, `SliceStatusChangedEvent` |
| **Task** | `TaskRepositoryPort`, `WaveDetectionPort`, `TaskDTO`, `TaskStatusSchema`, `TaskCompletedEvent`, `TaskBlockedEvent`, `TaskCreatedEvent` |
| **Settings** | `ProjectSettings`, `SettingsSchema`, `ModelProfileNameSchema`, `LoadSettingsUseCase`, `MergeSettingsUseCase`, `ResolveModelUseCase`, `SettingsFilePort`, `EnvVarPort`, `BudgetTrackingPort` |

### 3.2 Repository Port Methods

All repos return `Result<T, PersistenceError>`:

- **ProjectRepositoryPort:** `save(project)`, `findById(id)`, `findSingleton()`
- **MilestoneRepositoryPort:** `save(milestone)`, `findById(id)`, `findByLabel(label)`, `findByProjectId(projectId)`
- **SliceRepositoryPort:** `save(slice)`, `findById(id)`, `findByLabel(label)`, `findByMilestoneId(milestoneId)`
- **TaskRepositoryPort:** `save(task)`, `findById(id)`, `findByLabel(label)`, `findBySliceId(sliceId)`

### 3.3 Kernel Infrastructure

Already implemented:
- `InProcessEventBus` (sequential handlers, error-isolated)
- `ConsoleLoggerAdapter`, `SilentLoggerAdapter`
- `EVENT_NAMES` constant (12 event types)
- `DateProviderPort` (abstract — no production adapter yet)
- `EventBusPort` (abstract — `InProcessEventBus` implements it)

**Missing (needed for this slice):**
- `SystemDateProvider` — trivial `{ now: () => new Date() }` adapter

### 3.4 Empty Directories

- `src/cli/` — `.gitkeep` only, no CLI implementation
- `src/infrastructure/` — `.gitkeep` only, no shared adapters
- Infrastructure adapters are colocated within each hexagon's `infrastructure/` directory

### 3.5 Project Hexagon Gaps

- **No use-cases directory** — `InitProjectUseCase` doesn't exist yet
- **No `ProjectFileSystemPort`** — needs to be created
- `SqliteProjectRepository` — stub that throws "Not implemented"

### 3.6 Settings Hexagon (Ready)

All three use cases exist and are tested:
- `LoadSettingsUseCase` — YAML parsing with kebab-case normalization
- `MergeSettingsUseCase` — cascade merge (team < local < env)
- `ResolveModelUseCase` — phase + complexity + budget -> model

### 3.7 Path Aliases

```json
{
  "@kernel": ["./src/kernel"],
  "@kernel/*": ["./src/kernel/*"],
  "@hexagons/*": ["./src/hexagons/*"],
  "@infrastructure/*": ["./src/infrastructure/*"]
}
```

Module resolution: ESNext/Bundler, no `.js` extensions in imports.

---

## 4. SQLite Adapter State

### 4.1 Library

- **`better-sqlite3` v11.0.0** (devDependency)
- `@types/better-sqlite3` v7.6.0

### 4.2 Current State

All four SQLite repository adapters are **stubs** — they extend the port but throw "Not implemented":
- `SqliteProjectRepository`
- `SqliteMilestoneRepository`
- `SqliteSliceRepository`
- `SqliteTaskRepository`

### 4.3 DB Initialization Pattern

No DB connection management exists yet. The spec says:
- DB path: `${projectRoot}/.tff/state.db`
- Lazily initialized: DB + tables created on first write during `/tff:new`
- `/tff:status` outside a project: returns null report gracefully, no DB creation

**Recommended approach:** A shared `DatabaseConnection` class that:
1. Takes a file path (or `:memory:` for tests)
2. Creates tables on construction (`CREATE TABLE IF NOT EXISTS`)
3. Exposes the `better-sqlite3` `Database` instance
4. Passed to all SQLite repo constructors

### 4.4 Contract Tests

All four hexagons have shared contract test suites (`*-repository.contract.spec.ts`) that both in-memory and SQLite adapters must pass. Currently only in-memory adapters pass them.

**Impact:** SQLite adapter implementation is NOT in scope for this slice (spec non-goal). We wire using in-memory adapters for now, with SQLite deferred.

---

## 5. Dependencies to Add

```json
{
  "dependencies": {
    "@mariozechner/pi-coding-agent": "<pin-to-0.62.0>",
    "@mariozechner/pi-agent-core": "<transitive>",
    "@mariozechner/pi-ai": "<transitive>"
  }
}
```

**Removed from spec:** `zod-to-json-schema` — Zod 4 native `toJSONSchema()` replaces it.

**Transitive:** `@sinclair/typebox` comes via `@mariozechner/pi-coding-agent`.

---

## 6. Key Decisions & Recommendations

### D1: Extension Loading Strategy

**Decision:** Do NOT rely on PI SDK's auto-discovery (`ResourceLoader`). Instead:
- `main.ts` creates the session via `createAgentSession()`
- After session creation, call our extension factory directly, passing the session's `ExtensionAPI`
- OR use `customTools` in session options for tools + register commands separately

**Rationale:** Decouples us from PI SDK's filesystem-based discovery conventions. We control exactly what gets registered.

### D2: Use Zod 4 Native `toJSONSchema()` Instead of `zod-to-json-schema` Package

**Decision:** Drop `zod-to-json-schema` dependency, use `import { toJSONSchema } from 'zod'`.

**Rationale:** Fewer dependencies, first-party support, already verified working for all required types.

### D3: TypeBox Cast Strategy

**Decision:** Cast JSON Schema output to `TSchema` via `as unknown as TSchema`.

**Rationale:** PI SDK reads the parameters as JSON Schema at runtime. The TypeBox `Symbol` tag is a compile-time concern. Our `safeParse` handles actual validation. This is a boundary adapter — type-level pragmatism is acceptable here.

### D4: Wire In-Memory Adapters (Not SQLite) for Initial Bootstrap

**Decision:** `extension.ts` composition root wires in-memory repos. SQLite implementation is out of scope.

**Rationale:** Spec non-goal. Contract tests ensure any adapter is swappable. SQLite wiring happens in a later slice.

### D5: `execute` Signature Adaptation

**Decision:** `createZodTool` wraps the 5-param PI SDK execute signature, exposing a simplified 3-param signature to consumers: `(params, signal, ctx)`.

**Rationale:** Hexagon code shouldn't know about `toolCallId` or `onUpdate` — those are PI SDK concerns. The bridge absorbs that complexity.

### D6: Workflow Hexagon Bootstrapped Minimal

**Decision:** Create workflow hexagon with schemas only (WorkflowPhaseSchema, WorkflowTriggerSchema, WorkflowSessionPropsSchema) + `GetStatusUseCase`. No WorkflowSession aggregate yet.

**Rationale:** Establishes the hexagon's domain vocabulary and barrel exports. State machine deferred per spec.

---

## 7. Risk Assessment Update

| Risk | Status | Notes |
|---|---|---|
| PI SDK API instability | Mitigated | All PI-specific code isolated in `infrastructure/pi/`. Types aliased through bridge. |
| Zod 4 + JSON Schema compat | Resolved | Verified: native `toJSONSchema()` produces correct draft-07 for all required types |
| TypeBox cast safety | Low risk | PI SDK uses parameters as JSON Schema at runtime. Cast is boundary-only. |
| SQLite repos are stubs | Accepted | Wire in-memory for now. Swappable via contract tests. |
| Extension discovery mechanism | Mitigated | Avoid reliance on ResourceLoader; call extension factory directly |
| `createZodTool` execute signature | Resolved | 5-param PI SDK signature mapped to 3-param consumer API |

---

## 8. Open Questions (To Resolve During Planning)

1. **PI SDK version pinning:** Exact version to install (0.62.0 is latest known). Need to verify availability on npm.
2. **`main.ts` as bin entry:** Spec says "no `bin/tff` script (deferred)". How do we run the CLI? `npx`? Direct `node dist/cli/main.js`? Or just `tsx src/cli/main.ts` during dev?
3. **Command handler → tool invocation:** The spec shows command handlers telling the agent to "gather name/vision conversationally, then call the tff_init_project tool". How does a command handler trigger the LLM to use a tool? Likely via `ctx.sendUserMessage()` or returning a steer message.
4. **Settings YAML serialization:** `InitProjectUseCase` needs to serialize default settings to YAML. The `yaml` package is already a dependency — use its `stringify()`.
