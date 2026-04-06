# M08-S02: Research Notes

## 1. PI SDK Extension API (from pi-mono audit)

### Bootstrap Pattern
Extensions must be loaded BEFORE `createAgentSession()` via `DefaultResourceLoader.extensionFactories`:

```typescript
import { createAgentSession, DefaultResourceLoader } from "@mariozechner/pi-coding-agent";

const resourceLoader = new DefaultResourceLoader({
  extensionFactories: [(pi) => createTffExtension(pi, { projectRoot: process.cwd() })],
});
await resourceLoader.reload();
const { session } = await createAgentSession({ resourceLoader });
```

Calling action methods (`sendMessage`, `sendUserMessage`, `setActiveTools`, `appendEntry`) during factory execution throws `"Extension runtime not initialized"`. Only registration methods are safe during load.

### Default Export for Auto-Discovery
PI discovers extensions from `<cwd>/.pi/extensions/` and `~/.pi/agent/extensions/`. Extension files must export a default function:

```typescript
export default function(pi: ExtensionAPI) { ... }
```

### ExtensionCommandContext
Command handlers receive `(args: string, ctx: ExtensionCommandContext)`. `ctx` extends `ExtensionContext` with session control: `newSession()`, `waitForIdle()`, `currentSessionId`.

## 2. createZodTool Compatibility

### JSON Schema Cast
The `as unknown as TSchema` cast works because PI's runtime (AJV + LLM providers) consumes the `parameters` field as plain JSON Schema. AJV is configured with `strict: false`. TypeBox-specific symbols (`[Kind]`, `[Hint]`) are never checked at runtime.

### z.default() Bug (Critical)
PI's AJV does NOT set `useDefaults: true`. When Zod emits:
```json
{ "required": ["mode"], "properties": { "mode": { "type": "string", "default": "full" } } }
```
AJV treats `mode` as required but doesn't fill the default. If the LLM omits it → AJV error before `execute()` runs.

**Affected schemas:**
- `write-plan.tool.ts` — `blockedBy: z.array(z.string()).default([])`
- `map-codebase.tool.ts` — `mode: z.enum(["full", "incremental"]).default("full")`

**Fix:** Replace `.default(x)` with `.optional()`. Apply defaults in execute callback.

### additionalProperties: false
Zod's `toJSONSchema()` emits `additionalProperties: false`. TypeBox doesn't. Low-risk edge case where hallucinated extra properties would cause AJV rejection. Fix: strip from output.

## 3. Resource Path Resolution (from gsd-2 research)

### gsd-2 Pattern
- `src/resources/` shipped in npm tarball via `files` field
- Build copies resources: separate `copy-resources` script compiles TS extensions, copies non-TS files
- Runtime resolver checks `dist/resources/` first, falls back to `src/resources/`
- `import.meta.url`-based resolution for module-relative paths

### Our Approach
Simpler than gsd-2 (we don't have TS extensions in resources — just .md prompts and .yaml agent defs):
1. Add `"copy-resources": "cp -r src/resources dist/resources"` to build scripts
2. Chain into build: `"build": "tsc -p tsconfig.build.json && npm run copy-resources"`
3. Resource resolver function:

```typescript
function resolveResourceRoot(projectRoot: string): string {
  const distResources = join(projectRoot, "dist", "resources");
  if (existsSync(distResources)) return distResources;
  return join(projectRoot, "src", "resources");
}
```

This gives dev mode (src/) and production mode (dist/) parity.

## 4. Composition Root Findings

### void-suppressed Use Cases
Three use cases wired but unreachable:
- `verifyUseCase` (L470) — needs `tff:verify` command
- `shipSliceUseCase` (L537) — needs `tff:ship` command
- `completeMilestoneUseCase` (L573) — needs `tff:complete-milestone` command

These should be registered as PI commands, following the same pattern as existing commands (e.g., `tff:rollback`, `tff:audit-milestone`).

### SQLite Consolidation
4 Database instances → 1. All repositories use `CREATE TABLE IF NOT EXISTS`, so consolidation is safe. Just pass `stateDb` to `SqliteShipRecordRepository`, `SqliteCompletionRecordRepository`, `SqliteMilestoneAuditRecordRepository` instead of separate DB files.

### AlwaysUnderBudgetAdapter
Wired into overlay's `DashboardComponent` via `registerOverlayExtension`. Shows 0% budget. `BudgetCheckRule` in pre-dispatch guardrail uses execution context, not this adapter.

Replace with `LoggingBudgetAdapter` — same behavior but logs a warning on first call.

## 5. Command Signature Gaps

8 commands with incomplete handler signatures. All work at runtime (JS ignores extra args), but prevent access to `ctx`. Fix is mechanical — add `(_args: string, _ctx: ExtensionCommandContext)` or `(args: string, _ctx: ExtensionCommandContext)` depending on whether args is used.

| Command File | Current Signature | Uses args? |
|---|---|---|
| rollback.command.ts | `(args: string)` | Yes |
| audit-milestone.command.ts | `()` | No |
| add-slice.command.ts | `(args: string)` | Yes |
| remove-slice.command.ts | `(args: string)` | Yes |
| health.command.ts | `()` | No |
| help.command.ts | `()` | No |
| map-codebase.command.ts | `(args: string)` | Yes |
| progress.command.ts | `()` | No |
| settings.command.ts | `()` | No |

## 6. Cross-Hexagon Type Imports (Deferred)

`slice ↔ workflow` and `review → workflow` bidirectional `import type` statements. No runtime issue (all type-level). Fixing requires moving shared types to kernel — out of scope for this slice. Document as tech debt.
