# M02-S07: CLI Bootstrap + PI SDK Wiring

## Problem

The TFF-PI codebase has 5 domain hexagons (Project, Milestone, Slice, Task, Settings), a kernel with base classes, event bus, agent schemas, and a git CLI adapter -- but no way to run it. There is no CLI entry point, no PI SDK integration, and no user-facing commands. The `src/cli/` and `src/infrastructure/` directories contain only `.gitkeep` files.

This slice delivers the runtime wiring that turns the domain layer into a usable tool: a PI SDK extension entry point, the Zod-to-JSON-Schema bridge for tool registration, and the first two commands (`/tff:new` for project init, `/tff:status` for state display).

## Approach

**Per-hexagon extensions with CLI aggregator.** Each hexagon that exposes user-facing functionality provides a `register*Extension(pi, deps)` function. The CLI aggregator (`src/cli/extension.ts`) imports and calls each one, passing wired dependencies. This scales to 30+ commands across 8+ hexagons without a monolithic registration file.

Key decisions:
- **Bootstrap + Extension two-file pattern**: `main.ts` creates the PI agent session, `extension.ts` is the default-export that aggregates hexagon extensions
- **`zod-to-json-schema` npm package** for the Zod-to-JSON-Schema bridge (not hand-rolled) -- well-tested, covers edge cases
- **Per-hexagon extension registration** -- each hexagon owns its command/tool registration
- **New workflow hexagon** (minimal) -- owns `/tff:status` as a cross-hexagon read. The workflow hexagon is planned in the design spec (section 5.9) and will grow to own the full orchestration state machine
- **SQLite persistence** -- Project aggregate saved via `ProjectRepositoryPort` and SQLite adapter. DB path: `${projectRoot}/.tff/state.db`, lazily initialized (created on first write during `/tff:new`)
- **Full `/tff:new` init** -- creates `.tff/` structure, PROJECT.md, settings.yaml with defaults, saves Project to SQLite
- **`ProjectFileSystemPort`** -- new port for directory creation and file writes needed by `InitProjectUseCase`, keeping the use case testable behind in-memory adapters
- **PI SDK types verified during research** -- the exact `ExtensionAPI`, tool registration, and session bootstrap API shapes will be confirmed against the actual `@mariozechner/pi-coding-agent` package before implementation. Code snippets in this spec are illustrative; final signatures adapt to the real SDK.

## File Structure

```
src/
  cli/
    main.ts                              # PI session bootstrap (createAgentSession)
    extension.ts                         # default export: aggregates hexagon extensions
  infrastructure/
    pi/
      create-zod-tool.ts                 # Zod -> JSON Schema bridge for PI SDK tools
      create-zod-tool.spec.ts            # Bridge tests
      pi.types.ts                        # Re-exported/adapted PI SDK types (thin wrapper)
      index.ts                           # Barrel
  hexagons/
    project/
      domain/
        ports/
          project-filesystem.port.ts     # New: directory creation + file writes
      infrastructure/
        pi/
          project.extension.ts           # Registers /tff:new command + tff_init_project tool
        node-project-filesystem.adapter.ts     # node:fs implementation
        in-memory-project-filesystem.adapter.ts # test adapter
      use-cases/
        init-project.use-case.ts         # Creates .tff/ structure, Project aggregate, settings
        init-project.use-case.spec.ts
    workflow/
      domain/
        workflow-session.schemas.ts      # WorkflowPhase, WorkflowTrigger, WorkflowSessionProps
        workflow-session.schemas.spec.ts
      use-cases/
        get-status.use-case.ts           # Cross-hexagon status aggregation
        get-status.use-case.spec.ts
      infrastructure/
        pi/
          workflow.extension.ts          # Registers /tff:status command + tff_status tool
      index.ts                           # Barrel
  kernel/
    infrastructure/
      system-date-provider.adapter.ts    # New: DateProviderPort impl returning new Date()
```

## ProjectFileSystemPort

Location: `src/hexagons/project/domain/ports/project-filesystem.port.ts`

```typescript
export abstract class ProjectFileSystemPort {
  abstract exists(path: string): Promise<Result<boolean, PersistenceError>>;
  abstract createDirectory(path: string, options?: { recursive?: boolean }): Promise<Result<void, PersistenceError>>;
  abstract writeFile(path: string, content: string): Promise<Result<void, PersistenceError>>;
}
```

Adapters:
- `NodeProjectFileSystemAdapter` -- wraps `node:fs/promises` (mkdir, writeFile, access)
- `InMemoryProjectFileSystemAdapter` -- stores files/dirs in a `Map<string, string>` for testing

## createZodTool Bridge

Location: `src/infrastructure/pi/create-zod-tool.ts`

The bridge converts a Zod-schema-based tool config into the PI SDK's tool registration format. The exact PI SDK types (`ExtensionAPI.registerTool` signature, `ToolResult` shape) will be confirmed during research. The core logic is stable regardless:

```typescript
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';

// Thin type aliases -- replaced with real PI SDK types after research
type ToolResult = { content: Array<{ type: string; text: string }>; details: Record<string, unknown> };

export function createZodTool<T extends z.ZodObject<z.ZodRawShape>>(config: {
  name: string;
  label: string;
  description: string;
  schema: T;
  execute: (params: z.infer<T>, signal: AbortSignal) => Promise<ToolResult>;
}): Record<string, unknown> {
  // Convert at registration time (fail-fast on unsupported Zod features)
  const jsonSchema = zodToJsonSchema(config.schema, {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  });

  return {
    name: config.name,
    label: config.label,
    description: config.description,
    parameters: jsonSchema,
    async execute(toolCallId: string, rawParams: unknown, signal: AbortSignal, onUpdate: unknown, ctx: unknown) {
      const parsed = config.schema.safeParse(rawParams);
      if (!parsed.success) {
        return {
          content: [{ type: 'text', text: `Validation error: ${parsed.error.message}` }],
          details: {},
        };
      }
      return config.execute(parsed.data, signal);
    },
  };
}
```

**Constraint:** Tool parameter schemas passed through `createZodTool` must use only JSON-Schema-compatible Zod features: `z.object()`, `z.string()`, `z.number()`, `z.boolean()`, `z.enum()`, `z.array()`, `z.optional()`, `z.default()`. No `.transform()`, `.pipe()`, `.preprocess()`, `.brand()`, or `.refine()`.

## CLI Bootstrap

### main.ts

The exact `createAgentSession` API will be confirmed during research. Illustrative shape:

```typescript
// src/cli/main.ts
import {
  createAgentSession,
  AuthStorage,
  ModelRegistry,
  SessionManager,
} from '@mariozechner/pi-coding-agent';

const authStorage = AuthStorage.create();
const modelRegistry = new ModelRegistry(authStorage);

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  authStorage,
  modelRegistry,
  extensions: ['./extension.ts'],
});
```

### extension.ts — Composition Root

The aggregator acts as composition root: creates adapters, wires dependencies, passes them to hexagon extensions.

```typescript
// src/cli/extension.ts
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { registerProjectExtension } from '@hexagons/project';
import { registerWorkflowExtension } from '@hexagons/workflow';
import { InProcessEventBus } from '@kernel/infrastructure';
import { SystemDateProvider } from '@kernel/infrastructure';

export default function (pi: ExtensionAPI) {
  const projectRoot = process.cwd();
  const eventBus = new InProcessEventBus();
  const dateProvider = new SystemDateProvider();

  // DB path: ${projectRoot}/.tff/state.db
  // Lazily initialized — DB + tables created during /tff:new
  // For /tff:status outside a project: use case returns null report gracefully

  registerProjectExtension(pi, { projectRoot, eventBus, dateProvider });
  registerWorkflowExtension(pi, { projectRoot });
}
```

**DB lifecycle:** SQLite database at `${projectRoot}/.tff/state.db`. Created lazily during `/tff:new` (the init use case creates the `.tff/` directory first, then SQLite repos initialize their tables on first access). `/tff:status` called outside a project (no `.tff/` dir) returns a null project report gracefully — no crash, no DB creation.

**`SystemDateProvider`:** New trivial adapter in kernel/infrastructure (`{ now: () => new Date() }`). The existing `DateProviderPort` has no concrete production adapter yet.

## /tff:new — Project Initialization

### InitProjectUseCase

Location: `src/hexagons/project/use-cases/init-project.use-case.ts`

Dependencies (constructor injection):
- `ProjectRepositoryPort` -- save Project aggregate
- `ProjectFileSystemPort` -- create dirs, write files (new port)
- `MergeSettingsUseCase` -- generate default settings (from Settings hexagon)
- `EventBusPort` -- publish ProjectInitializedEvent
- `DateProviderPort` -- timestamps

Input:
```typescript
const InitProjectParamsSchema = z.object({
  name: z.string().min(1),
  vision: z.string().min(1),
  projectRoot: z.string(),
});
```

Flow:
1. Check `.tff/` exists via `ProjectFileSystemPort.exists()` — if yes, return `err(ProjectAlreadyExistsError)`
2. Create directories via `ProjectFileSystemPort.createDirectory()` (recursive):
   - `${projectRoot}/.tff/milestones/`
   - `${projectRoot}/.tff/skills/`
   - `${projectRoot}/.tff/observations/`
3. Write `${projectRoot}/.tff/PROJECT.md` via `ProjectFileSystemPort.writeFile()` (contains name + vision)
4. `MergeSettingsUseCase.execute({ team: null, local: null, env: {} })` -> default `ProjectSettings`
5. Serialize default settings to YAML, write `${projectRoot}/.tff/settings.yaml` via `ProjectFileSystemPort.writeFile()`
6. `Project.init({ name, vision, dateProvider })` -> save to `ProjectRepositoryPort`
7. Publish `ProjectInitializedEvent` via `EventBusPort`
8. Return `Result<ProjectDTO, InitProjectError>`

Errors:
- `ProjectAlreadyExistsError` -- `.tff/` directory already exists (extends `BaseDomainError`)
- `PersistenceError` -- SQLite or filesystem failure

### Project Extension

Location: `src/hexagons/project/infrastructure/pi/project.extension.ts`

```typescript
export function registerProjectExtension(pi: ExtensionAPI, deps: ProjectExtensionDeps): void {
  // Command: /tff:new — tells agent to gather name/vision conversationally
  pi.registerCommand('tff:new', {
    description: 'Initialize a new TFF project in the current directory',
    handler: async (args, ctx) => {
      // Agent gathers name/vision, then calls the tff_init_project tool
    },
  });

  // Tool: tff_init_project — does the actual initialization
  pi.registerTool(createZodTool({
    name: 'tff_init_project',
    label: 'Initialize TFF Project',
    description: 'Create .tff/ directory structure, PROJECT.md, settings.yaml, and Project aggregate',
    schema: InitProjectParamsSchema,
    execute: async (params, signal) => {
      const useCase = new InitProjectUseCase(
        deps.projectRepo,
        deps.projectFs,
        deps.mergeSettings,
        deps.eventBus,
        deps.dateProvider,
      );
      const result = await useCase.execute(params);
      if (!result.ok) {
        return { content: [{ type: 'text', text: `Init failed: ${result.error.message}` }], details: {} };
      }
      return { content: [{ type: 'text', text: `Project "${params.name}" initialized at ${params.projectRoot}/.tff/` }], details: {} };
    },
  }));
}
```

## /tff:status — Project Status Display

### GetStatusUseCase

Location: `src/hexagons/workflow/use-cases/get-status.use-case.ts`

Dependencies (constructor injection):
- `ProjectRepositoryPort`
- `MilestoneRepositoryPort`
- `SliceRepositoryPort`
- `TaskRepositoryPort`

Output:
```typescript
const StatusReportSchema = z.object({
  project: z.object({
    name: z.string(),
    vision: z.string(),
  }).nullable(),
  activeMilestone: z.object({
    label: z.string(),
    title: z.string(),
    status: MilestoneStatusSchema,
  }).nullable(),
  slices: z.array(z.object({
    label: z.string(),
    title: z.string(),
    status: SliceStatusSchema,
    complexity: ComplexityTierSchema.nullable(),
    taskCount: z.number().int(),
    completedTaskCount: z.number().int(),
  })),
  totals: z.object({
    totalSlices: z.number().int(),
    completedSlices: z.number().int(),
    totalTasks: z.number().int(),
    completedTasks: z.number().int(),
  }),
});
type StatusReport = z.infer<typeof StatusReportSchema>;
```

Flow:
1. Load all projects from `ProjectRepositoryPort` — if none, return `StatusReport` with null project/milestone and empty slices
2. Load all milestones via `MilestoneRepositoryPort.findByProjectId()`, filter in application code for first non-closed milestone (no new port method needed)
3. If active milestone found, load slices via `SliceRepositoryPort.findByMilestoneId()`
4. For each slice, load tasks via `TaskRepositoryPort.findBySliceId()`, count where `status === 'closed'`
5. Compute totals (completedSlices = slices where status === 'closed')
6. Return `Result<StatusReport, PersistenceError>`

### Workflow Extension

Location: `src/hexagons/workflow/infrastructure/pi/workflow.extension.ts`

Registers `/tff:status` command and `tff_status` tool. The tool takes an optional `projectRoot` string parameter (defaults to `process.cwd()`). Returns a formatted text report with project name, milestone progress, per-slice status, and task counts.

## Workflow Hexagon (Minimal Bootstrap)

For this slice, the workflow hexagon is minimal:
- **Schemas**: `WorkflowPhaseSchema`, `WorkflowTriggerSchema`, `WorkflowSessionPropsSchema` (from design spec section 5.9)
- **Use case**: `GetStatusUseCase`
- **Extension**: `workflow.extension.ts`
- **No aggregate yet** -- `WorkflowSession` aggregate with state machine is deferred to the Workflow Engine milestone

The schemas are defined now to establish the hexagon's domain vocabulary even though the state machine logic comes later.

## New Dependencies

```json
{
  "dependencies": {
    "zod-to-json-schema": "^3.x",
    "@mariozechner/pi-coding-agent": "<pinned-version>",
    "@mariozechner/pi-ai": "<pinned-version>"
  }
}
```

Pin versions tightly given PI SDK is evolving rapidly. Exact versions determined during research.

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| PI SDK API stability | Pin dependency versions. Isolate PI-specific code in `infrastructure/pi/` adapters. All PI types aliased through `pi.types.ts` — single point of change. |
| Zod 4 + zod-to-json-schema compat | Verify during research phase. Fallback: hand-rolled converter for the 8 supported types. |
| TypeBox cast safety | PI SDK likely validates JSON Schema structure, not TypeBox runtime. Test at integration level. |
| SQLite repos are stubs | Implement SQLite repos as part of this slice or use in-memory repos for initial wiring. |
| `createZodTool` execute signature | Exact signature confirmed during research. Core logic (Zod conversion + safeParse validation) is stable regardless of PI SDK surface. |

## Non-Goals

- No agent dispatch logic (M03: Execution & Recovery)
- No journal or checkpoint system (M03)
- No orphan branch sync (M06)
- No WorkflowSession state machine (Workflow Engine milestone)
- No commands beyond `/tff:new` and `/tff:status`
- No `bin/tff` executable script (deferred -- run via `npx` or direct `node` for now)
- No SQLite DB schema migration system (tables created on first access; versioned migrations deferred)

## Testing Strategy

- **createZodTool**: Schema conversion tests for each supported Zod type (object, string, number, boolean, enum, array, optional, default). Validation error response test. All tests use plain function calls — no PI SDK mock needed for the bridge itself.
- **InitProjectUseCase**: Uses `InMemoryProjectFileSystemAdapter`, `InMemoryProjectRepository`, in-memory event bus. Tests: successful init (verify dirs + files + aggregate + event), duplicate project guard (`ProjectAlreadyExistsError`), settings defaults correctness.
- **GetStatusUseCase**: Uses in-memory repos pre-loaded via builders. Tests: no project (null report), no milestone (null milestone), slices with mixed statuses, task progress computation, totals accuracy.
- **WorkflowSession schemas**: Parse/reject tests for valid/invalid phases, triggers, and session props. Values match design spec section 5.9.
- **Extension registration**: Integration test with `ExtensionAPI` mock/spy asserting `registerCommand` and `registerTool` called with expected names.
- **Barrel exports**: All public types accessible from hexagon `index.ts` files.
- **SystemDateProvider**: Trivial — returns `Date` instance, verifiable by `instanceof`.

## Acceptance Criteria

- [ ] AC1: `main.ts` calls `createAgentSession` with an extensions list that includes the TFF extension aggregator; the resulting session resolves without error
- [ ] AC2: `InitProjectUseCase` creates `.tff/milestones/`, `.tff/skills/`, `.tff/observations/` directories, writes `.tff/PROJECT.md` (containing project name and vision), writes `.tff/settings.yaml` (containing merged defaults), saves the `Project` aggregate via `ProjectRepositoryPort`, and publishes `ProjectInitializedEvent` via `EventBusPort`
- [ ] AC3: `GetStatusUseCase` returns a `StatusReport` matching `StatusReportSchema` containing: project name/vision (or null if no project), active milestone label/title/status (or null if no non-closed milestone), per-slice label/title/status/complexity/taskCount/completedTaskCount, and computed totals (totalSlices, completedSlices, totalTasks, completedTasks)
- [ ] AC4: `createZodTool` converts each supported Zod type (`z.object`, `z.string`, `z.number`, `z.boolean`, `z.enum`, `z.array`, `z.optional`, `z.default`) to its correct JSON Schema 7 equivalent
- [ ] AC5: `createZodTool`-generated tools validate input via `safeParse` at runtime; invalid input returns a `ToolResult` containing a validation error message (not an exception)
- [ ] AC6: `extension.ts` default export calls `registerProjectExtension` and `registerWorkflowExtension`; after execution, the `ExtensionAPI` has received `registerCommand` calls for `tff:new` and `tff:status`, and `registerTool` calls for `tff_init_project` and `tff_status`
- [ ] AC7: `WorkflowPhaseSchema`, `WorkflowTriggerSchema`, and `WorkflowSessionPropsSchema` are defined (values matching design spec section 5.9), parse valid inputs, reject invalid inputs, and are exported from `workflow/index.ts`
- [ ] AC8: Every new module under `src/` has a colocated `.spec.ts` file; unit tests use only in-memory adapters and port stubs (no `node:fs` real I/O, no real SQLite connections)
