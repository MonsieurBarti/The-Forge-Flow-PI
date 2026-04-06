# M02-S07: CLI Bootstrap + PI SDK Wiring — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Wire the domain layer into a usable CLI tool — PI SDK extension entry point, Zod-to-JSON-Schema bridge, InitProjectUseCase, GetStatusUseCase, and the first two commands (`/tff:new`, `/tff:status`).
**Architecture:** Per-hexagon extensions with CLI aggregator. New workflow hexagon (minimal). New ProjectFileSystemPort.
**Tech Stack:** Zod 4 (native `toJSONSchema()`), Vitest, @faker-js/faker, yaml (already dep)

## Research Deviations from Spec

| Spec Assumption | Research Finding | Plan Adaptation |
|---|---|---|
| `zod-to-json-schema` package | Zod 4 native `toJSONSchema()` works | Use `import { toJSONSchema } from 'zod'` — no new dep |
| `extensions: ['./extension.ts']` | PI SDK uses auto-discovery or `customTools` | `main.ts` passes tools via `customTools`; commands registered post-session |
| `execute(args, signal)` | PI SDK: `execute(toolCallId, params, signal, onUpdate, ctx)` | Bridge wraps 5-param → 3-param `(params, signal, ctx)` |
| PI SDK as runtime dep | PI SDK not yet installed | Define type aliases in `pi.types.ts`; install PI SDK as first task |
| SQLite persistence | SQLite stubs not implemented | Wire in-memory repos for now (spec non-goal) |

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `biome.json` | Modify | Add overrides for test/CLI files to allow deep hexagon imports |
| `src/kernel/infrastructure/system-date-provider.adapter.ts` | Create | `DateProviderPort` impl returning `new Date()` |
| `src/kernel/infrastructure/system-date-provider.adapter.spec.ts` | Create | Verify returns `Date` instance |
| `src/kernel/infrastructure/index.ts` | Modify | Export `SystemDateProvider` |
| `src/kernel/index.ts` | Modify | Re-export `SystemDateProvider` |
| `src/infrastructure/pi/pi.types.ts` | Create | PI SDK type aliases (`ExtensionAPI`, `ToolDefinition`, `AgentToolResult`, etc.) |
| `src/infrastructure/pi/pi.types.spec.ts` | Create | Structural type validation tests |
| `src/infrastructure/pi/create-zod-tool.ts` | Create | Zod → JSON Schema 7 bridge for PI SDK tools |
| `src/infrastructure/pi/create-zod-tool.spec.ts` | Create | Schema conversion + safeParse validation tests |
| `src/infrastructure/pi/index.ts` | Create | Barrel exports |
| `src/hexagons/project/domain/ports/project-filesystem.port.ts` | Create | `ProjectFileSystemPort` abstract class |
| `src/hexagons/project/infrastructure/in-memory-project-filesystem.adapter.ts` | Create | `Map`-based test adapter |
| `src/hexagons/project/infrastructure/in-memory-project-filesystem.adapter.spec.ts` | Create | Adapter tests |
| `src/hexagons/project/infrastructure/node-project-filesystem.adapter.ts` | Create | `node:fs/promises` adapter |
| `src/hexagons/project/infrastructure/node-project-filesystem.adapter.spec.ts` | Create | Integration test (temp dir) |
| `src/hexagons/project/domain/errors/project-already-exists.error.ts` | Create | Domain error for duplicate init |
| `src/hexagons/project/domain/errors/project-already-exists.error.spec.ts` | Create | Error code and message tests |
| `src/hexagons/project/use-cases/init-project.use-case.ts` | Create | Project initialization orchestrator |
| `src/hexagons/project/use-cases/init-project.use-case.spec.ts` | Create | Use case tests with in-memory adapters |
| `src/hexagons/project/index.ts` | Modify | Export new port, error, use case, extension |
| `src/hexagons/project/infrastructure/pi/project.extension.ts` | Create | Register `/tff:new` + `tff_init_project` |
| `src/hexagons/project/infrastructure/pi/project.extension.spec.ts` | Create | Extension registration test |
| `src/hexagons/workflow/domain/workflow-session.schemas.ts` | Create | `WorkflowPhaseSchema`, `WorkflowTriggerSchema`, `WorkflowSessionPropsSchema` |
| `src/hexagons/workflow/domain/workflow-session.schemas.spec.ts` | Create | Parse/reject tests |
| `src/hexagons/workflow/use-cases/get-status.use-case.ts` | Create | Cross-hexagon status aggregation |
| `src/hexagons/workflow/use-cases/get-status.use-case.spec.ts` | Create | Status computation tests |
| `src/hexagons/workflow/infrastructure/pi/workflow.extension.ts` | Create | Register `/tff:status` + `tff_status` |
| `src/hexagons/workflow/infrastructure/pi/workflow.extension.spec.ts` | Create | Extension registration test |
| `src/hexagons/workflow/index.ts` | Create | Barrel exports |
| `src/cli/extension.ts` | Create | Composition root — wires all hexagon extensions |
| `src/cli/extension.spec.ts` | Create | Verifies aggregator calls both registration functions |
| `src/cli/main.ts` | Create | PI session bootstrap |

---

## Wave 0 (parallel — no dependencies)

### T01: SystemDateProvider adapter

**Files:**
- Create: `src/kernel/infrastructure/system-date-provider.adapter.ts`
- Create: `src/kernel/infrastructure/system-date-provider.adapter.spec.ts`
- Modify: `src/kernel/infrastructure/index.ts`
- Modify: `src/kernel/index.ts`

**Traces to:** AC8

**Step 1: Write failing test**
- **File**: `src/kernel/infrastructure/system-date-provider.adapter.spec.ts`
- **Code**:
```typescript
import { describe, expect, it } from "vitest";
import { SystemDateProvider } from "./system-date-provider.adapter";

describe("SystemDateProvider", () => {
  it("returns a Date instance", () => {
    const provider = new SystemDateProvider();
    const result = provider.now();
    expect(result).toBeInstanceOf(Date);
  });

  it("returns a date close to the current time", () => {
    const provider = new SystemDateProvider();
    const before = Date.now();
    const result = provider.now();
    const after = Date.now();
    expect(result.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.getTime()).toBeLessThanOrEqual(after);
  });
});
```
- **Run**: `npx vitest run src/kernel/infrastructure/system-date-provider.adapter.spec.ts`
- **Expect**: FAIL — module not found

**Step 2: Implement**
- **File**: `src/kernel/infrastructure/system-date-provider.adapter.ts`
- **Code**:
```typescript
import { DateProviderPort } from "@kernel/ports/date-provider.port";

export class SystemDateProvider extends DateProviderPort {
  now(): Date {
    return new Date();
  }
}
```
- **File**: `src/kernel/infrastructure/index.ts` — add export:
```typescript
export { SystemDateProvider } from "./system-date-provider.adapter";
```
- **File**: `src/kernel/index.ts` — add to infrastructure re-exports (line 19):
```typescript
export {
  ConsoleLoggerAdapter,
  InProcessEventBus,
  SilentLoggerAdapter,
  SystemDateProvider,
} from "./infrastructure";
```
- **Run**: `npx vitest run src/kernel/infrastructure/system-date-provider.adapter.spec.ts`
- **Expect**: PASS — 2 tests passing
- **Commit**: `feat(S07/T01): add SystemDateProvider adapter`

---

### T02: ProjectFileSystemPort + InMemory adapter

**Files:**
- Create: `src/hexagons/project/domain/ports/project-filesystem.port.ts`
- Create: `src/hexagons/project/infrastructure/in-memory-project-filesystem.adapter.ts`
- Create: `src/hexagons/project/infrastructure/in-memory-project-filesystem.adapter.spec.ts`

**Traces to:** AC2, AC8

**Step 1: Write failing test**
- **File**: `src/hexagons/project/infrastructure/in-memory-project-filesystem.adapter.spec.ts`
- **Code**:
```typescript
import { describe, expect, it } from "vitest";
import { isOk } from "@kernel";
import { InMemoryProjectFileSystemAdapter } from "./in-memory-project-filesystem.adapter";

describe("InMemoryProjectFileSystemAdapter", () => {
  it("exists returns false for non-existent path", async () => {
    const adapter = new InMemoryProjectFileSystemAdapter();
    const result = await adapter.exists("/project/.tff");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.data).toBe(false);
  });

  it("createDirectory + exists roundtrip", async () => {
    const adapter = new InMemoryProjectFileSystemAdapter();
    await adapter.createDirectory("/project/.tff/milestones", { recursive: true });
    const result = await adapter.exists("/project/.tff/milestones");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.data).toBe(true);
  });

  it("writeFile + exists roundtrip", async () => {
    const adapter = new InMemoryProjectFileSystemAdapter();
    await adapter.writeFile("/project/.tff/PROJECT.md", "# My Project");
    const result = await adapter.exists("/project/.tff/PROJECT.md");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.data).toBe(true);
  });

  it("writeFile stores content retrievable via getContent", async () => {
    const adapter = new InMemoryProjectFileSystemAdapter();
    await adapter.writeFile("/project/.tff/settings.yaml", "key: value");
    expect(adapter.getContent("/project/.tff/settings.yaml")).toBe("key: value");
  });

  it("reset clears all entries", async () => {
    const adapter = new InMemoryProjectFileSystemAdapter();
    await adapter.writeFile("/project/.tff/PROJECT.md", "# My Project");
    adapter.reset();
    const result = await adapter.exists("/project/.tff/PROJECT.md");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.data).toBe(false);
  });

  it("recursive createDirectory creates parent paths", async () => {
    const adapter = new InMemoryProjectFileSystemAdapter();
    await adapter.createDirectory("/a/b/c/d", { recursive: true });
    for (const path of ["/a", "/a/b", "/a/b/c", "/a/b/c/d"]) {
      const result = await adapter.exists(path);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.data).toBe(true);
    }
  });
});
```
- **Run**: `npx vitest run src/hexagons/project/infrastructure/in-memory-project-filesystem.adapter.spec.ts`
- **Expect**: FAIL — module not found

**Step 2: Implement port**
- **File**: `src/hexagons/project/domain/ports/project-filesystem.port.ts`
- **Code**:
```typescript
import type { PersistenceError, Result } from "@kernel";

export abstract class ProjectFileSystemPort {
  abstract exists(path: string): Promise<Result<boolean, PersistenceError>>;
  abstract createDirectory(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<Result<void, PersistenceError>>;
  abstract writeFile(
    path: string,
    content: string,
  ): Promise<Result<void, PersistenceError>>;
}
```

**Step 3: Implement adapter**
- **File**: `src/hexagons/project/infrastructure/in-memory-project-filesystem.adapter.ts`
- **Code**:
```typescript
import { ok, type PersistenceError, type Result } from "@kernel";
import { ProjectFileSystemPort } from "../domain/ports/project-filesystem.port";

export class InMemoryProjectFileSystemAdapter extends ProjectFileSystemPort {
  private entries = new Map<string, string | null>();

  async exists(path: string): Promise<Result<boolean, PersistenceError>> {
    return ok(this.entries.has(path));
  }

  async createDirectory(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<Result<void, PersistenceError>> {
    if (options?.recursive) {
      const parts = path.split("/").filter(Boolean);
      let current = "";
      for (const part of parts) {
        current = `${current}/${part}`;
        this.entries.set(current, null);
      }
    } else {
      this.entries.set(path, null);
    }
    return ok(undefined);
  }

  async writeFile(
    path: string,
    content: string,
  ): Promise<Result<void, PersistenceError>> {
    this.entries.set(path, content);
    return ok(undefined);
  }

  getContent(path: string): string | undefined {
    const value = this.entries.get(path);
    return value === null ? undefined : value;
  }

  reset(): void {
    this.entries.clear();
  }
}
```
- **Run**: `npx vitest run src/hexagons/project/infrastructure/in-memory-project-filesystem.adapter.spec.ts`
- **Expect**: PASS — 6 tests passing
- **Commit**: `feat(S07/T02): add ProjectFileSystemPort and InMemory adapter`

---

### T03: PI SDK type aliases

**Files:**
- Modify: `biome.json` (add overrides for test/CLI files)
- Create: `src/infrastructure/pi/pi.types.ts`
- Create: `src/infrastructure/pi/pi.types.spec.ts`
- Create: `src/infrastructure/pi/index.ts`

**Traces to:** AC1, AC4, AC5, AC8

This is a simple structural task — type aliases that isolate PI SDK types behind a thin boundary. Also adds biome overrides to allow deep hexagon imports in test files and the CLI composition root (these are natural boundary-crossing points in hexagonal architecture).

- **File**: `biome.json` — add `overrides` section to relax `noRestrictedImports` for test and CLI files:
```json
{
  "overrides": [
    {
      "includes": ["**/*.spec.ts", "src/cli/**"],
      "linter": {
        "rules": {
          "style": {
            "noRestrictedImports": "off"
          }
        }
      }
    }
  ]
}
```
> Add this as a top-level key in `biome.json`, alongside `formatter`, `linter`, etc.

- **File**: `src/infrastructure/pi/pi.types.ts`
- **Code**:
```typescript
/**
 * Thin type aliases for PI SDK types.
 *
 * These decouple TFF hexagons from the PI SDK's exact type surface.
 * When the PI SDK is installed, replace `unknown` placeholders with real imports.
 * Until then, these types are structurally compatible for our bridge layer.
 */

/** Content block in a tool result */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "object"; data: unknown };

/** Result returned by a tool execution */
export interface AgentToolResult<TDetails = unknown> {
  content: ContentBlock[];
  details?: TDetails;
}

/** Context passed to tool execute and command handlers */
export interface ExtensionContext {
  cwd: string;
  isIdle(): boolean;
  abort(): void;
}

/** Command handler context (extends ExtensionContext) */
export interface ExtensionCommandContext extends ExtensionContext {
  sendUserMessage(content: string): void;
}

/** Command registration options */
export interface RegisterCommandOptions {
  description?: string;
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

/** Tool definition compatible with PI SDK's ToolDefinition */
export interface ToolDefinition<TDetails = unknown> {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: Record<string, unknown>;
  execute(
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<TDetails>>;
}

/** Extension API surface — subset we use */
export interface ExtensionAPI {
  registerTool(tool: ToolDefinition): void;
  registerCommand(name: string, options: RegisterCommandOptions): void;
}
```
- **File**: `src/infrastructure/pi/index.ts`
- **Code**:
```typescript
export type {
  AgentToolResult,
  ContentBlock,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  RegisterCommandOptions,
  ToolDefinition,
} from "./pi.types";
```
> Note: `createZodTool` export will be added to this barrel in T06 when the module is created.
- **File**: `src/infrastructure/pi/pi.types.spec.ts`
- **Code**:
```typescript
import { describe, expect, it } from "vitest";
import type {
  AgentToolResult,
  ContentBlock,
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "./pi.types";

describe("PI SDK type aliases", () => {
  it("ContentBlock text variant is structurally valid", () => {
    const block: ContentBlock = { type: "text", text: "hello" };
    expect(block.type).toBe("text");
  });

  it("AgentToolResult is structurally valid", () => {
    const result: AgentToolResult = {
      content: [{ type: "text", text: "ok" }],
    };
    expect(result.content).toHaveLength(1);
  });
});
```
- **Commit**: `feat(S07/T03): add PI SDK type aliases`

---

### T04: Workflow hexagon schemas

**Files:**
- Create: `src/hexagons/workflow/domain/workflow-session.schemas.ts`
- Create: `src/hexagons/workflow/domain/workflow-session.schemas.spec.ts`

**Traces to:** AC7

**Step 1: Write failing test**
- **File**: `src/hexagons/workflow/domain/workflow-session.schemas.spec.ts`
- **Code**:
```typescript
import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";
import {
  WorkflowPhaseSchema,
  WorkflowSessionPropsSchema,
  WorkflowTriggerSchema,
} from "./workflow-session.schemas";

describe("WorkflowPhaseSchema", () => {
  const validPhases = [
    "idle", "discussing", "researching", "planning",
    "executing", "verifying", "reviewing",
    "shipping", "completing-milestone",
    "paused", "blocked",
  ];

  it.each(validPhases)("accepts '%s'", (phase) => {
    expect(WorkflowPhaseSchema.parse(phase)).toBe(phase);
  });

  it("rejects invalid phase", () => {
    expect(() => WorkflowPhaseSchema.parse("coding")).toThrow();
  });
});

describe("WorkflowTriggerSchema", () => {
  const validTriggers = [
    "start", "next", "skip", "back", "fail",
    "approve", "reject", "pause", "resume", "abort",
  ];

  it.each(validTriggers)("accepts '%s'", (trigger) => {
    expect(WorkflowTriggerSchema.parse(trigger)).toBe(trigger);
  });

  it("rejects invalid trigger", () => {
    expect(() => WorkflowTriggerSchema.parse("restart")).toThrow();
  });
});

describe("WorkflowSessionPropsSchema", () => {
  it("parses valid session props", () => {
    const now = new Date();
    const props = WorkflowSessionPropsSchema.parse({
      id: faker.string.uuid(),
      milestoneId: faker.string.uuid(),
      currentPhase: "idle",
      autonomyMode: "guided",
      createdAt: now,
      updatedAt: now,
    });
    expect(props.currentPhase).toBe("idle");
    expect(props.sliceId).toBeUndefined();
    expect(props.retryCount).toBe(0);
  });

  it("parses session with active slice", () => {
    const now = new Date();
    const props = WorkflowSessionPropsSchema.parse({
      id: faker.string.uuid(),
      milestoneId: faker.string.uuid(),
      sliceId: faker.string.uuid(),
      currentPhase: "executing",
      previousPhase: "planning",
      autonomyMode: "plan-to-pr",
      retryCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    expect(props.sliceId).toBeDefined();
    expect(props.previousPhase).toBe("planning");
    expect(props.retryCount).toBe(1);
  });

  it("rejects invalid autonomy mode", () => {
    expect(() =>
      WorkflowSessionPropsSchema.parse({
        id: faker.string.uuid(),
        milestoneId: faker.string.uuid(),
        currentPhase: "idle",
        autonomyMode: "yolo",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).toThrow();
  });
});
```
- **Run**: `npx vitest run src/hexagons/workflow/domain/workflow-session.schemas.spec.ts`
- **Expect**: FAIL — module not found

**Step 2: Implement**
- **File**: `src/hexagons/workflow/domain/workflow-session.schemas.ts`
- **Code**:
```typescript
import { IdSchema, TimestampSchema } from "@kernel";
import { z } from "zod";
import { AutonomyModeSchema } from "@hexagons/settings";

export const WorkflowPhaseSchema = z.enum([
  "idle",
  "discussing",
  "researching",
  "planning",
  "executing",
  "verifying",
  "reviewing",
  "shipping",
  "completing-milestone",
  "paused",
  "blocked",
]);
export type WorkflowPhase = z.infer<typeof WorkflowPhaseSchema>;

export const WorkflowTriggerSchema = z.enum([
  "start",
  "next",
  "skip",
  "back",
  "fail",
  "approve",
  "reject",
  "pause",
  "resume",
  "abort",
]);
export type WorkflowTrigger = z.infer<typeof WorkflowTriggerSchema>;

export const WorkflowSessionPropsSchema = z.object({
  id: IdSchema,
  milestoneId: IdSchema,
  sliceId: IdSchema.optional(),
  currentPhase: WorkflowPhaseSchema,
  previousPhase: WorkflowPhaseSchema.optional(),
  retryCount: z.number().int().min(0).default(0),
  autonomyMode: AutonomyModeSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type WorkflowSessionProps = z.infer<typeof WorkflowSessionPropsSchema>;
```
- **Run**: `npx vitest run src/hexagons/workflow/domain/workflow-session.schemas.spec.ts`
- **Expect**: PASS — 15 tests passing
- **Commit**: `feat(S07/T04): add workflow hexagon schemas`

---

### T05: ProjectAlreadyExistsError

**Files:**
- Create: `src/hexagons/project/domain/errors/project-already-exists.error.ts`
- Create: `src/hexagons/project/domain/errors/project-already-exists.error.spec.ts`

**Traces to:** AC2, AC8

Simple structural task.

- **File**: `src/hexagons/project/domain/errors/project-already-exists.error.ts`
- **Code**:
```typescript
import { BaseDomainError } from "@kernel";

export class ProjectAlreadyExistsError extends BaseDomainError {
  readonly code = "PROJECT.ALREADY_EXISTS";

  constructor(projectRoot: string) {
    super(`Project already initialized at ${projectRoot}/.tff/`);
  }
}
```
- **File**: `src/hexagons/project/domain/errors/project-already-exists.error.spec.ts`
- **Code**:
```typescript
import { describe, expect, it } from "vitest";
import { BaseDomainError } from "@kernel";
import { ProjectAlreadyExistsError } from "./project-already-exists.error";

describe("ProjectAlreadyExistsError", () => {
  it("extends BaseDomainError", () => {
    const error = new ProjectAlreadyExistsError("/workspace");
    expect(error).toBeInstanceOf(BaseDomainError);
  });

  it("has correct error code", () => {
    const error = new ProjectAlreadyExistsError("/workspace");
    expect(error.code).toBe("PROJECT.ALREADY_EXISTS");
  });

  it("includes project root in message", () => {
    const error = new ProjectAlreadyExistsError("/workspace");
    expect(error.message).toContain("/workspace/.tff/");
  });
});
```
- **Commit**: `feat(S07/T05): add ProjectAlreadyExistsError`

---

## Wave 1 (depends on Wave 0)

### T13: NodeProjectFileSystemAdapter

**Files:**
- Create: `src/hexagons/project/infrastructure/node-project-filesystem.adapter.ts`
- Create: `src/hexagons/project/infrastructure/node-project-filesystem.adapter.spec.ts`

**Depends on:** T02 (ProjectFileSystemPort)
**Traces to:** AC8

**Step 1: Write test**
- **File**: `src/hexagons/project/infrastructure/node-project-filesystem.adapter.spec.ts`
- **Code**:
```typescript
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isOk } from "@kernel";
import { NodeProjectFileSystemAdapter } from "./node-project-filesystem.adapter";

describe("NodeProjectFileSystemAdapter", () => {
  let tempDir: string;
  let adapter: NodeProjectFileSystemAdapter;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tff-test-"));
    adapter = new NodeProjectFileSystemAdapter();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("exists returns false for non-existent path", async () => {
    const result = await adapter.exists(join(tempDir, "nope"));
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.data).toBe(false);
  });

  it("createDirectory + exists roundtrip", async () => {
    const dir = join(tempDir, "a", "b", "c");
    await adapter.createDirectory(dir, { recursive: true });
    const result = await adapter.exists(dir);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.data).toBe(true);
  });

  it("writeFile + exists roundtrip", async () => {
    const filePath = join(tempDir, "test.txt");
    await adapter.writeFile(filePath, "hello");
    const result = await adapter.exists(filePath);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.data).toBe(true);
  });
});
```
- **Run**: `npx vitest run src/hexagons/project/infrastructure/node-project-filesystem.adapter.spec.ts`
- **Expect**: FAIL — module not found

**Step 2: Implement**
- **File**: `src/hexagons/project/infrastructure/node-project-filesystem.adapter.ts`
- **Code**:
```typescript
import { access, mkdir, writeFile } from "node:fs/promises";
import { err, ok, PersistenceError, type Result } from "@kernel";
import { ProjectFileSystemPort } from "../domain/ports/project-filesystem.port";

export class NodeProjectFileSystemAdapter extends ProjectFileSystemPort {
  async exists(path: string): Promise<Result<boolean, PersistenceError>> {
    try {
      await access(path);
      return ok(true);
    } catch {
      return ok(false);
    }
  }

  async createDirectory(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<Result<void, PersistenceError>> {
    try {
      await mkdir(path, { recursive: options?.recursive ?? false });
      return ok(undefined);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(
        new PersistenceError(`Failed to create directory: ${path}: ${message}`),
      );
    }
  }

  async writeFile(
    path: string,
    content: string,
  ): Promise<Result<void, PersistenceError>> {
    try {
      await writeFile(path, content, "utf-8");
      return ok(undefined);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(
        new PersistenceError(`Failed to write file: ${path}: ${message}`),
      );
    }
  }
}
```
- **Run**: `npx vitest run src/hexagons/project/infrastructure/node-project-filesystem.adapter.spec.ts`
- **Expect**: PASS — 3 tests passing
- **Commit**: `feat(S07/T13): add NodeProjectFileSystemAdapter`

---

### T06: createZodTool bridge

**Files:**
- Create: `src/infrastructure/pi/create-zod-tool.ts`
- Create: `src/infrastructure/pi/create-zod-tool.spec.ts`
- Modify: `src/infrastructure/pi/index.ts` (add createZodTool export)

**Depends on:** T03 (PI SDK type aliases)
**Traces to:** AC4, AC5

**Step 1: Write failing test**
- **File**: `src/infrastructure/pi/create-zod-tool.spec.ts`
- **Code**:
```typescript
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createZodTool } from "./create-zod-tool";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getProps(params: Record<string, unknown>): Record<string, unknown> {
  const props = params["properties"];
  if (!isRecord(props)) throw new Error("Expected properties to be an object");
  return props;
}

describe("createZodTool", () => {
  const schema = z.object({
    name: z.string(),
    count: z.number(),
    active: z.boolean(),
    status: z.enum(["open", "closed"]),
    tags: z.array(z.string()),
    desc: z.string().optional(),
    priority: z.number().default(0),
  });

  const makeTool = () =>
    createZodTool({
      name: "test_tool",
      label: "Test Tool",
      description: "A test tool",
      schema,
      execute: async (params) => ({
        content: [{ type: "text", text: JSON.stringify(params) }],
      }),
    });

  describe("JSON Schema conversion (AC4)", () => {
    it("produces valid JSON Schema 7 for z.object", () => {
      const tool = makeTool();
      expect(tool.parameters["$schema"]).toBe("http://json-schema.org/draft-07/schema#");
      expect(tool.parameters["type"]).toBe("object");
    });

    it("converts z.string to { type: 'string' }", () => {
      const props = getProps(makeTool().parameters);
      expect(props["name"]).toEqual({ type: "string" });
    });

    it("converts z.number to { type: 'number' }", () => {
      const props = getProps(makeTool().parameters);
      expect(props["count"]).toEqual({ type: "number" });
    });

    it("converts z.boolean to { type: 'boolean' }", () => {
      const props = getProps(makeTool().parameters);
      expect(props["active"]).toEqual({ type: "boolean" });
    });

    it("converts z.enum to { type: 'string', enum: [...] }", () => {
      const props = getProps(makeTool().parameters);
      expect(props["status"]).toEqual({ type: "string", enum: ["open", "closed"] });
    });

    it("converts z.array(z.string()) to { type: 'array', items: { type: 'string' } }", () => {
      const props = getProps(makeTool().parameters);
      expect(props["tags"]).toEqual({ type: "array", items: { type: "string" } });
    });

    it("z.optional removes field from required", () => {
      const tool = makeTool();
      const required = tool.parameters["required"];
      expect(Array.isArray(required) ? required : []).not.toContain("desc");
    });

    it("z.default includes default value in schema", () => {
      const props = getProps(makeTool().parameters);
      const priority = props["priority"];
      expect(isRecord(priority) ? priority["default"] : undefined).toBe(0);
    });
  });

  describe("safeParse validation (AC5)", () => {
    it("passes valid input through to execute", async () => {
      const tool = makeTool();
      const result = await tool.execute(
        "call-1",
        { name: "test", count: 1, active: true, status: "open", tags: ["a"] },
        undefined,
        undefined,
        { cwd: "/tmp", isIdle: () => true, abort: () => {} },
      );
      const text = result.content[0];
      expect(text.type).toBe("text");
      if (text.type === "text") {
        const parsed = JSON.parse(text.text);
        expect(parsed.name).toBe("test");
        expect(parsed.priority).toBe(0); // default applied
      }
    });

    it("returns validation error for invalid input (not exception)", async () => {
      const tool = makeTool();
      const result = await tool.execute(
        "call-2",
        { name: 123, count: "not-a-number" }, // invalid types
        undefined,
        undefined,
        { cwd: "/tmp", isIdle: () => true, abort: () => {} },
      );
      expect(result.content[0].type).toBe("text");
      if (result.content[0].type === "text") {
        expect(result.content[0].text).toContain("Validation error");
      }
    });
  });
});
```
- **Run**: `npx vitest run src/infrastructure/pi/create-zod-tool.spec.ts`
- **Expect**: FAIL — module not found

**Step 2: Implement**
- **File**: `src/infrastructure/pi/create-zod-tool.ts`
- **Code**:
```typescript
import { toJSONSchema } from "zod";
import type { z } from "zod";
import type {
  AgentToolResult,
  ExtensionContext,
  ToolDefinition,
} from "./pi.types";

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
  ) => Promise<AgentToolResult>;
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
    parameters: Object.assign({}, jsonSchema),
    async execute(toolCallId, rawParams, signal, onUpdate, ctx) {
      const parsed = config.schema.safeParse(rawParams);
      if (!parsed.success) {
        return {
          content: [
            {
              type: "text",
              text: `Validation error: ${parsed.error.message}`,
            },
          ],
        };
      }
      return config.execute(
        parsed.data,
        signal ?? new AbortController().signal,
        ctx,
      );
    },
  };
}
```
- **File**: `src/infrastructure/pi/index.ts` — add `createZodTool` export:
```typescript
export { createZodTool } from "./create-zod-tool";
export type { ZodToolConfig } from "./create-zod-tool";
```
> Append to the existing barrel created in T03.
- **Run**: `npx vitest run src/infrastructure/pi/create-zod-tool.spec.ts`
- **Expect**: PASS — 10 tests passing
- **Commit**: `feat(S07/T06): add createZodTool Zod-to-JSON-Schema bridge`

---

### T07: InitProjectUseCase

**Files:**
- Create: `src/hexagons/project/use-cases/init-project.use-case.ts`
- Create: `src/hexagons/project/use-cases/init-project.use-case.spec.ts`

**Depends on:** T01 (SystemDateProvider), T02 (ProjectFileSystemPort), T05 (ProjectAlreadyExistsError)
**Traces to:** AC2

**Step 1: Write failing test**
- **File**: `src/hexagons/project/use-cases/init-project.use-case.spec.ts`
- **Code**:
```typescript
import { describe, expect, it } from "vitest";
import {
  InProcessEventBus,
  SilentLoggerAdapter,
  isOk,
  isErr,
  EVENT_NAMES,
  type DomainEvent,
  DateProviderPort,
} from "@kernel";
import { MergeSettingsUseCase } from "@hexagons/settings";
import { InMemoryProjectRepository } from "../infrastructure/in-memory-project.repository";
import { InMemoryProjectFileSystemAdapter } from "../infrastructure/in-memory-project-filesystem.adapter";
import { InitProjectUseCase } from "./init-project.use-case";
import { ProjectAlreadyExistsError } from "../domain/errors/project-already-exists.error";

class StubDateProvider extends DateProviderPort {
  private readonly date: Date;
  constructor(date: Date = new Date("2026-01-15T12:00:00Z")) {
    super();
    this.date = date;
  }
  now(): Date {
    return this.date;
  }
}

function setup() {
  const projectRepo = new InMemoryProjectRepository();
  const projectFs = new InMemoryProjectFileSystemAdapter();
  const mergeSettings = new MergeSettingsUseCase();
  const eventBus = new InProcessEventBus(new SilentLoggerAdapter());
  const dateProvider = new StubDateProvider();
  const useCase = new InitProjectUseCase(
    projectRepo,
    projectFs,
    mergeSettings,
    eventBus,
    dateProvider,
  );
  return { useCase, projectRepo, projectFs, eventBus };
}

describe("InitProjectUseCase", () => {
  it("creates .tff directory structure", async () => {
    const { useCase, projectFs } = setup();
    const result = await useCase.execute({
      name: "My Project",
      vision: "Build something great",
      projectRoot: "/workspace",
    });
    expect(isOk(result)).toBe(true);

    for (const dir of [
      "/workspace/.tff/milestones",
      "/workspace/.tff/skills",
      "/workspace/.tff/observations",
    ]) {
      const exists = await projectFs.exists(dir);
      expect(isOk(exists) && exists.data).toBe(true);
    }
  });

  it("writes PROJECT.md with name and vision", async () => {
    const { useCase, projectFs } = setup();
    await useCase.execute({
      name: "My Project",
      vision: "Build something great",
      projectRoot: "/workspace",
    });
    const content = projectFs.getContent("/workspace/.tff/PROJECT.md");
    expect(content).toContain("My Project");
    expect(content).toContain("Build something great");
  });

  it("writes settings.yaml with defaults", async () => {
    const { useCase, projectFs } = setup();
    await useCase.execute({
      name: "My Project",
      vision: "Build something great",
      projectRoot: "/workspace",
    });
    const content = projectFs.getContent("/workspace/.tff/settings.yaml");
    expect(content).toBeDefined();
    expect(content).toContain("modelRouting");
  });

  it("saves Project aggregate to repository", async () => {
    const { useCase, projectRepo } = setup();
    await useCase.execute({
      name: "My Project",
      vision: "Build something great",
      projectRoot: "/workspace",
    });
    const found = await projectRepo.findSingleton();
    expect(isOk(found)).toBe(true);
    if (isOk(found)) {
      expect(found.data).not.toBeNull();
      expect(found.data!.name).toBe("My Project");
    }
  });

  it("publishes ProjectInitializedEvent", async () => {
    const { useCase, eventBus } = setup();
    const events: DomainEvent[] = [];
    eventBus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, async (e) => {
      events.push(e);
    });
    await useCase.execute({
      name: "My Project",
      vision: "Build something great",
      projectRoot: "/workspace",
    });
    expect(events).toHaveLength(1);
  });

  it("returns error if .tff/ already exists", async () => {
    const { useCase, projectFs } = setup();
    await projectFs.createDirectory("/workspace/.tff");
    const result = await useCase.execute({
      name: "My Project",
      vision: "Build something great",
      projectRoot: "/workspace",
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ProjectAlreadyExistsError);
    }
  });
});
```
- **Run**: `npx vitest run src/hexagons/project/use-cases/init-project.use-case.spec.ts`
- **Expect**: FAIL — module not found

**Step 2: Implement**
- **File**: `src/hexagons/project/use-cases/init-project.use-case.ts`
- **Code**:
```typescript
import {
  type DateProviderPort,
  type EventBusPort,
  type PersistenceError,
  type Result,
  err,
  isErr,
  ok,
} from "@kernel";
import { stringify } from "yaml";
import { z } from "zod";
import { ProjectAlreadyExistsError } from "../domain/errors/project-already-exists.error";
import { ProjectRepositoryPort } from "../domain/ports/project-repository.port";
import { ProjectFileSystemPort } from "../domain/ports/project-filesystem.port";
import { Project } from "../domain/project.aggregate";
import type { ProjectDTO } from "../domain/project.schemas";
import { MergeSettingsUseCase } from "@hexagons/settings";

export const InitProjectParamsSchema = z.object({
  name: z.string().min(1),
  vision: z.string().min(1),
  projectRoot: z.string().min(1),
});
export type InitProjectParams = z.infer<typeof InitProjectParamsSchema>;

export type InitProjectError = ProjectAlreadyExistsError | PersistenceError;

export class InitProjectUseCase {
  constructor(
    private readonly projectRepo: ProjectRepositoryPort,
    private readonly projectFs: ProjectFileSystemPort,
    private readonly mergeSettings: MergeSettingsUseCase,
    private readonly eventBus: EventBusPort,
    private readonly dateProvider: DateProviderPort,
  ) {}

  async execute(
    params: InitProjectParams,
  ): Promise<Result<ProjectDTO, InitProjectError>> {
    const tffDir = `${params.projectRoot}/.tff`;

    // 1. Guard: project already exists
    const existsResult = await this.projectFs.exists(tffDir);
    if (isErr(existsResult)) return existsResult;
    if (existsResult.data) {
      return err(new ProjectAlreadyExistsError(params.projectRoot));
    }

    // 2. Create directory structure
    for (const dir of [
      `${tffDir}/milestones`,
      `${tffDir}/skills`,
      `${tffDir}/observations`,
    ]) {
      const mkdirResult = await this.projectFs.createDirectory(dir, {
        recursive: true,
      });
      if (isErr(mkdirResult)) return mkdirResult;
    }

    // 3. Write PROJECT.md
    const projectMd = `# ${params.name}\n\n${params.vision}\n`;
    const writeProjResult = await this.projectFs.writeFile(
      `${tffDir}/PROJECT.md`,
      projectMd,
    );
    if (isErr(writeProjResult)) return writeProjResult;

    // 4. Generate + write settings.yaml
    const settingsResult = this.mergeSettings.execute({
      team: null,
      local: null,
      env: {},
    });
    if (isErr(settingsResult)) return settingsResult;
    const settingsYaml = stringify(settingsResult.data.toJSON());
    const writeSettingsResult = await this.projectFs.writeFile(
      `${tffDir}/settings.yaml`,
      settingsYaml,
    );
    if (isErr(writeSettingsResult)) return writeSettingsResult;

    // 5. Create + save Project aggregate
    const now = this.dateProvider.now();
    const project = Project.init({
      id: crypto.randomUUID(),
      name: params.name,
      vision: params.vision,
      now,
    });

    const saveResult = await this.projectRepo.save(project);
    if (isErr(saveResult)) return saveResult;

    // 6. Publish domain events
    for (const event of project.pullEvents()) {
      await this.eventBus.publish(event);
    }

    return ok(project.toJSON());
  }
}
```
- **Run**: `npx vitest run src/hexagons/project/use-cases/init-project.use-case.spec.ts`
- **Expect**: PASS — 6 tests passing
- **Commit**: `feat(S07/T07): add InitProjectUseCase`

---

### T08: GetStatusUseCase

**Files:**
- Create: `src/hexagons/workflow/use-cases/get-status.use-case.ts`
- Create: `src/hexagons/workflow/use-cases/get-status.use-case.spec.ts`

**Depends on:** T04 (workflow barrel for schema re-exports)
**Traces to:** AC3

**Step 1: Write failing test**
- **File**: `src/hexagons/workflow/use-cases/get-status.use-case.spec.ts`
- **Code**:
```typescript
import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";
import { isOk } from "@kernel";
import { InMemoryProjectRepository } from "@hexagons/project/infrastructure/in-memory-project.repository";
import { InMemoryMilestoneRepository } from "@hexagons/milestone/infrastructure/in-memory-milestone.repository";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { InMemoryTaskRepository } from "@hexagons/task/infrastructure/in-memory-task.repository";
import { Project } from "@hexagons/project/domain/project.aggregate";
import { Milestone } from "@hexagons/milestone/domain/milestone.aggregate";
import { Slice } from "@hexagons/slice/domain/slice.aggregate";
import { Task } from "@hexagons/task/domain/task.aggregate";
import { GetStatusUseCase } from "./get-status.use-case";

function setup() {
  const projectRepo = new InMemoryProjectRepository();
  const milestoneRepo = new InMemoryMilestoneRepository();
  const sliceRepo = new InMemorySliceRepository();
  const taskRepo = new InMemoryTaskRepository();
  const useCase = new GetStatusUseCase(projectRepo, milestoneRepo, sliceRepo, taskRepo);
  return { useCase, projectRepo, milestoneRepo, sliceRepo, taskRepo };
}

describe("GetStatusUseCase", () => {
  it("returns null project when no project exists", async () => {
    const { useCase } = setup();
    const result = await useCase.execute();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.project).toBeNull();
      expect(result.data.activeMilestone).toBeNull();
      expect(result.data.slices).toEqual([]);
    }
  });

  it("returns project info with null milestone when none exist", async () => {
    const { useCase, projectRepo } = setup();
    const now = new Date();
    const project = Project.init({ id: faker.string.uuid(), name: "Test", vision: "Vision", now });
    projectRepo.seed(project);

    const result = await useCase.execute();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.project).toEqual({ name: "Test", vision: "Vision" });
      expect(result.data.activeMilestone).toBeNull();
    }
  });

  it("returns active milestone (first non-closed)", async () => {
    const { useCase, projectRepo, milestoneRepo } = setup();
    const now = new Date();
    const projectId = faker.string.uuid();
    const project = Project.init({ id: projectId, name: "Test", vision: "Vision", now });
    projectRepo.seed(project);

    const m1 = Milestone.reconstitute({
      id: faker.string.uuid(), projectId, label: "M01", title: "First",
      status: "closed", createdAt: now, updatedAt: now,
    });
    const m2 = Milestone.reconstitute({
      id: faker.string.uuid(), projectId, label: "M02", title: "Second",
      status: "open", createdAt: now, updatedAt: now,
    });
    milestoneRepo.seed(m1);
    milestoneRepo.seed(m2);

    const result = await useCase.execute();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.activeMilestone!.label).toBe("M02");
    }
  });

  it("computes slice and task totals correctly", async () => {
    const { useCase, projectRepo, milestoneRepo, sliceRepo, taskRepo } = setup();
    const now = new Date();
    const projectId = faker.string.uuid();
    const milestoneId = faker.string.uuid();
    const sliceId = faker.string.uuid();

    projectRepo.seed(Project.init({ id: projectId, name: "Test", vision: "V", now }));
    milestoneRepo.seed(Milestone.reconstitute({
      id: milestoneId, projectId, label: "M01", title: "First",
      status: "in_progress", createdAt: now, updatedAt: now,
    }));
    sliceRepo.seed(Slice.reconstitute({
      id: sliceId, milestoneId, label: "M01-S01", title: "Slice One",
      status: "executing", createdAt: now, updatedAt: now,
    }));

    const t1Id = faker.string.uuid();
    const t2Id = faker.string.uuid();
    taskRepo.seed(Task.reconstitute({
      id: t1Id, sliceId, label: "T01", title: "Task 1",
      description: "Do thing", acceptanceCriteria: "AC1",
      filePaths: [], status: "closed", blockedBy: [],
      createdAt: now, updatedAt: now,
    }));
    taskRepo.seed(Task.reconstitute({
      id: t2Id, sliceId, label: "T02", title: "Task 2",
      description: "Do other", acceptanceCriteria: "AC2",
      filePaths: [], status: "open", blockedBy: [],
      createdAt: now, updatedAt: now,
    }));

    const result = await useCase.execute();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.slices).toHaveLength(1);
      expect(result.data.slices[0].taskCount).toBe(2);
      expect(result.data.slices[0].completedTaskCount).toBe(1);
      expect(result.data.totals).toEqual({
        totalSlices: 1,
        completedSlices: 0,
        totalTasks: 2,
        completedTasks: 1,
      });
    }
  });
});
```
- **Run**: `npx vitest run src/hexagons/workflow/use-cases/get-status.use-case.spec.ts`
- **Expect**: FAIL — module not found

**Step 2: Implement**
- **File**: `src/hexagons/workflow/use-cases/get-status.use-case.ts`
- **Code**:
```typescript
import { type PersistenceError, type Result, isErr, ok } from "@kernel";
import { ProjectRepositoryPort } from "@hexagons/project";
import { MilestoneRepositoryPort } from "@hexagons/milestone";
import { SliceRepositoryPort } from "@hexagons/slice";
import { TaskRepositoryPort } from "@hexagons/task";
import { z } from "zod";
import { MilestoneStatusSchema } from "@hexagons/milestone";
import { SliceStatusSchema, ComplexityTierSchema } from "@hexagons/slice";

export const StatusReportSchema = z.object({
  project: z
    .object({
      name: z.string(),
      vision: z.string(),
    })
    .nullable(),
  activeMilestone: z
    .object({
      label: z.string(),
      title: z.string(),
      status: MilestoneStatusSchema,
    })
    .nullable(),
  slices: z.array(
    z.object({
      label: z.string(),
      title: z.string(),
      status: SliceStatusSchema,
      complexity: ComplexityTierSchema.nullable(),
      taskCount: z.number().int(),
      completedTaskCount: z.number().int(),
    }),
  ),
  totals: z.object({
    totalSlices: z.number().int(),
    completedSlices: z.number().int(),
    totalTasks: z.number().int(),
    completedTasks: z.number().int(),
  }),
});
export type StatusReport = z.infer<typeof StatusReportSchema>;

export class GetStatusUseCase {
  constructor(
    private readonly projectRepo: ProjectRepositoryPort,
    private readonly milestoneRepo: MilestoneRepositoryPort,
    private readonly sliceRepo: SliceRepositoryPort,
    private readonly taskRepo: TaskRepositoryPort,
  ) {}

  async execute(): Promise<Result<StatusReport, PersistenceError>> {
    // 1. Load project
    const projectResult = await this.projectRepo.findSingleton();
    if (isErr(projectResult)) return projectResult;

    if (!projectResult.data) {
      return ok({
        project: null,
        activeMilestone: null,
        slices: [],
        totals: { totalSlices: 0, completedSlices: 0, totalTasks: 0, completedTasks: 0 },
      });
    }

    const project = projectResult.data;

    // 2. Find active milestone (first non-closed)
    const msResult = await this.milestoneRepo.findByProjectId(project.id);
    if (isErr(msResult)) return msResult;

    const activeMilestone = msResult.data.find((m) => m.toJSON().status !== "closed") ?? null;

    if (!activeMilestone) {
      return ok({
        project: { name: project.name, vision: project.vision },
        activeMilestone: null,
        slices: [],
        totals: { totalSlices: 0, completedSlices: 0, totalTasks: 0, completedTasks: 0 },
      });
    }

    // 3. Load slices for active milestone
    const sliceResult = await this.sliceRepo.findByMilestoneId(activeMilestone.id);
    if (isErr(sliceResult)) return sliceResult;

    // 4. For each slice, load tasks and compute counts
    const slices = [];
    let totalTasks = 0;
    let completedTasks = 0;
    let completedSlices = 0;

    for (const slice of sliceResult.data) {
      const taskResult = await this.taskRepo.findBySliceId(slice.id);
      if (isErr(taskResult)) return taskResult;

      const tasks = taskResult.data;
      const sliceProps = slice.toJSON();
      const done = tasks.filter((t) => t.toJSON().status === "closed").length;

      totalTasks += tasks.length;
      completedTasks += done;
      if (sliceProps.status === "closed") completedSlices++;

      slices.push({
        label: sliceProps.label,
        title: sliceProps.title,
        status: sliceProps.status,
        complexity: sliceProps.complexity ?? null,
        taskCount: tasks.length,
        completedTaskCount: done,
      });
    }

    const msProps = activeMilestone.toJSON();
    return ok({
      project: { name: project.name, vision: project.vision },
      activeMilestone: {
        label: msProps.label,
        title: msProps.title,
        status: msProps.status,
      },
      slices,
      totals: {
        totalSlices: slices.length,
        completedSlices,
        totalTasks,
        completedTasks,
      },
    });
  }
}
```
- **Run**: `npx vitest run src/hexagons/workflow/use-cases/get-status.use-case.spec.ts`
- **Expect**: PASS — 4 tests passing
- **Commit**: `feat(S07/T08): add GetStatusUseCase`

---

## Wave 2 (depends on Wave 1)

### T09: Project extension

**Files:**
- Create: `src/hexagons/project/infrastructure/pi/project.extension.ts`
- Create: `src/hexagons/project/infrastructure/pi/project.extension.spec.ts`

**Depends on:** T06 (createZodTool), T07 (InitProjectUseCase)
**Traces to:** AC6

**Step 1: Write failing test**
- **File**: `src/hexagons/project/infrastructure/pi/project.extension.spec.ts`
- **Code**:
```typescript
import { describe, expect, it, vi } from "vitest";
import {
  InProcessEventBus,
  SilentLoggerAdapter,
  DateProviderPort,
} from "@kernel";
import { MergeSettingsUseCase } from "@hexagons/settings";
import { InMemoryProjectRepository } from "../in-memory-project.repository";
import { InMemoryProjectFileSystemAdapter } from "../in-memory-project-filesystem.adapter";
import { registerProjectExtension } from "./project.extension";

class StubDateProvider extends DateProviderPort {
  now(): Date {
    return new Date("2026-01-15T12:00:00Z");
  }
}

function makeMockApi() {
  return {
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
  };
}

describe("registerProjectExtension", () => {
  it("registers tff:new command", () => {
    const api = makeMockApi();
    registerProjectExtension(api, {
      projectRoot: "/workspace",
      projectRepo: new InMemoryProjectRepository(),
      projectFs: new InMemoryProjectFileSystemAdapter(),
      mergeSettings: new MergeSettingsUseCase(),
      eventBus: new InProcessEventBus(new SilentLoggerAdapter()),
      dateProvider: new StubDateProvider(),
    });
    expect(api.registerCommand).toHaveBeenCalledWith(
      "tff:new",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });

  it("registers tff_init_project tool", () => {
    const api = makeMockApi();
    registerProjectExtension(api, {
      projectRoot: "/workspace",
      projectRepo: new InMemoryProjectRepository(),
      projectFs: new InMemoryProjectFileSystemAdapter(),
      mergeSettings: new MergeSettingsUseCase(),
      eventBus: new InProcessEventBus(new SilentLoggerAdapter()),
      dateProvider: new StubDateProvider(),
    });
    expect(api.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "tff_init_project" }),
    );
  });
});
```
- **Run**: `npx vitest run src/hexagons/project/infrastructure/pi/project.extension.spec.ts`
- **Expect**: FAIL — module not found

**Step 2: Implement**
- **File**: `src/hexagons/project/infrastructure/pi/project.extension.ts`
- **Code**:
```typescript
import type { DateProviderPort, EventBusPort } from "@kernel";
import type { MergeSettingsUseCase } from "@hexagons/settings";
import type { ExtensionAPI } from "@infrastructure/pi";
import { createZodTool } from "@infrastructure/pi";
import { ProjectRepositoryPort } from "../../domain/ports/project-repository.port";
import { ProjectFileSystemPort } from "../../domain/ports/project-filesystem.port";
import {
  InitProjectUseCase,
  InitProjectParamsSchema,
} from "../../use-cases/init-project.use-case";

export interface ProjectExtensionDeps {
  projectRoot: string;
  projectRepo: ProjectRepositoryPort;
  projectFs: ProjectFileSystemPort;
  mergeSettings: MergeSettingsUseCase;
  eventBus: EventBusPort;
  dateProvider: DateProviderPort;
}

export function registerProjectExtension(
  api: ExtensionAPI,
  deps: ProjectExtensionDeps,
): void {
  api.registerCommand("tff:new", {
    description: "Initialize a new TFF project in the current directory",
    handler: async (_args, ctx) => {
      ctx.sendUserMessage(
        "I'll initialize a TFF project. Please provide a project name and vision, then I'll call the tff_init_project tool.",
      );
    },
  });

  api.registerTool(
    createZodTool({
      name: "tff_init_project",
      label: "Initialize TFF Project",
      description:
        "Create .tff/ directory structure, PROJECT.md, settings.yaml, and Project aggregate",
      schema: InitProjectParamsSchema,
      execute: async (params) => {
        const useCase = new InitProjectUseCase(
          deps.projectRepo,
          deps.projectFs,
          deps.mergeSettings,
          deps.eventBus,
          deps.dateProvider,
        );
        const result = await useCase.execute(params);
        if (!result.ok) {
          return {
            content: [
              { type: "text", text: `Init failed: ${result.error.message}` },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `Project "${params.name}" initialized at ${params.projectRoot}/.tff/`,
            },
          ],
        };
      },
    }),
  );
}
```
- **Run**: `npx vitest run src/hexagons/project/infrastructure/pi/project.extension.spec.ts`
- **Expect**: PASS — 2 tests passing
- **Commit**: `feat(S07/T09): add project extension with /tff:new command`

---

### T10: Workflow extension

**Files:**
- Create: `src/hexagons/workflow/infrastructure/pi/workflow.extension.ts`
- Create: `src/hexagons/workflow/infrastructure/pi/workflow.extension.spec.ts`

**Depends on:** T06 (createZodTool), T08 (GetStatusUseCase)
**Traces to:** AC6

**Step 1: Write failing test**
- **File**: `src/hexagons/workflow/infrastructure/pi/workflow.extension.spec.ts`
- **Code**:
```typescript
import { describe, expect, it, vi } from "vitest";
import { registerWorkflowExtension } from "./workflow.extension";
import { InMemoryProjectRepository } from "@hexagons/project/infrastructure/in-memory-project.repository";
import { InMemoryMilestoneRepository } from "@hexagons/milestone/infrastructure/in-memory-milestone.repository";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { InMemoryTaskRepository } from "@hexagons/task/infrastructure/in-memory-task.repository";

function makeMockApi() {
  return {
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
  };
}

describe("registerWorkflowExtension", () => {
  it("registers tff:status command", () => {
    const api = makeMockApi();
    registerWorkflowExtension(api, {
      projectRepo: new InMemoryProjectRepository(),
      milestoneRepo: new InMemoryMilestoneRepository(),
      sliceRepo: new InMemorySliceRepository(),
      taskRepo: new InMemoryTaskRepository(),
    });
    expect(api.registerCommand).toHaveBeenCalledWith(
      "tff:status",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });

  it("registers tff_status tool", () => {
    const api = makeMockApi();
    registerWorkflowExtension(api, {
      projectRepo: new InMemoryProjectRepository(),
      milestoneRepo: new InMemoryMilestoneRepository(),
      sliceRepo: new InMemorySliceRepository(),
      taskRepo: new InMemoryTaskRepository(),
    });
    expect(api.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "tff_status" }),
    );
  });
});
```
- **Run**: `npx vitest run src/hexagons/workflow/infrastructure/pi/workflow.extension.spec.ts`
- **Expect**: FAIL — module not found

**Step 2: Implement**
- **File**: `src/hexagons/workflow/infrastructure/pi/workflow.extension.ts`
- **Code**:
```typescript
import type { ExtensionAPI } from "@infrastructure/pi";
import { createZodTool } from "@infrastructure/pi";
import { ProjectRepositoryPort } from "@hexagons/project";
import { MilestoneRepositoryPort } from "@hexagons/milestone";
import { SliceRepositoryPort } from "@hexagons/slice";
import { TaskRepositoryPort } from "@hexagons/task";
import { GetStatusUseCase, type StatusReport } from "../use-cases/get-status.use-case";
import { z } from "zod";

export interface WorkflowExtensionDeps {
  projectRepo: ProjectRepositoryPort;
  milestoneRepo: MilestoneRepositoryPort;
  sliceRepo: SliceRepositoryPort;
  taskRepo: TaskRepositoryPort;
}

function formatStatusReport(report: StatusReport): string {
  const lines: string[] = [];

  if (!report.project) {
    lines.push("No TFF project found. Run /tff:new to initialize.");
    return lines.join("\n");
  }

  lines.push(`# ${report.project.name}`);
  lines.push(`Vision: ${report.project.vision}`);
  lines.push("");

  if (!report.activeMilestone) {
    lines.push("No active milestone. Run /tff:new-milestone to create one.");
    return lines.join("\n");
  }

  const ms = report.activeMilestone;
  lines.push(`## ${ms.label}: ${ms.title} (${ms.status})`);
  lines.push("");

  if (report.slices.length > 0) {
    lines.push("| Slice | Status | Tasks |");
    lines.push("|---|---|---|");
    for (const s of report.slices) {
      lines.push(`| ${s.label}: ${s.title} | ${s.status} | ${s.completedTaskCount}/${s.taskCount} |`);
    }
    lines.push("");
  }

  const t = report.totals;
  lines.push(`Slices: ${t.completedSlices}/${t.totalSlices} | Tasks: ${t.completedTasks}/${t.totalTasks}`);
  return lines.join("\n");
}

export function registerWorkflowExtension(
  api: ExtensionAPI,
  deps: WorkflowExtensionDeps,
): void {
  const useCase = new GetStatusUseCase(
    deps.projectRepo,
    deps.milestoneRepo,
    deps.sliceRepo,
    deps.taskRepo,
  );

  api.registerCommand("tff:status", {
    description: "Show current TFF project status",
    handler: async (_args, ctx) => {
      ctx.sendUserMessage("Fetching project status...");
    },
  });

  api.registerTool(
    createZodTool({
      name: "tff_status",
      label: "TFF Project Status",
      description: "Show project status including milestone progress, slice states, and task counts",
      schema: z.object({}),
      execute: async () => {
        const result = await useCase.execute();
        if (!result.ok) {
          return {
            content: [{ type: "text", text: `Status failed: ${result.error.message}` }],
          };
        }
        return {
          content: [{ type: "text", text: formatStatusReport(result.data) }],
        };
      },
    }),
  );
}
```
- **Run**: `npx vitest run src/hexagons/workflow/infrastructure/pi/workflow.extension.spec.ts`
- **Expect**: PASS — 2 tests passing
- **Commit**: `feat(S07/T10): add workflow extension with /tff:status command`

---

## Wave 3 (depends on Wave 2)

### T11: Workflow + Project barrel exports

**Files:**
- Create: `src/hexagons/workflow/index.ts`
- Modify: `src/hexagons/project/index.ts`

**Depends on:** T04, T07, T08, T09, T10
**Traces to:** AC6, AC7

- **File**: `src/hexagons/workflow/index.ts`
- **Code**:
```typescript
// Domain — Schemas
export type { WorkflowPhase, WorkflowSessionProps, WorkflowTrigger } from "./domain/workflow-session.schemas";
export {
  WorkflowPhaseSchema,
  WorkflowSessionPropsSchema,
  WorkflowTriggerSchema,
} from "./domain/workflow-session.schemas";

// Use Cases
export { GetStatusUseCase } from "./use-cases/get-status.use-case";
export type { StatusReport } from "./use-cases/get-status.use-case";
export { StatusReportSchema } from "./use-cases/get-status.use-case";

// Extensions
export { registerWorkflowExtension } from "./infrastructure/pi/workflow.extension";
export type { WorkflowExtensionDeps } from "./infrastructure/pi/workflow.extension";
```
- **File**: `src/hexagons/project/index.ts` — replace entire content:
```typescript
// Domain — Events
export { ProjectInitializedEvent } from "./domain/events/project-initialized.event";
// Domain — Errors
export { ProjectAlreadyExistsError } from "./domain/errors/project-already-exists.error";
// Domain — Ports
export { ProjectFileSystemPort } from "./domain/ports/project-filesystem.port";
export { ProjectRepositoryPort } from "./domain/ports/project-repository.port";
// Domain — Schemas & Types
export type { ProjectDTO } from "./domain/project.schemas";
export { ProjectPropsSchema } from "./domain/project.schemas";
// Use Cases
export { InitProjectUseCase, InitProjectParamsSchema } from "./use-cases/init-project.use-case";
export type { InitProjectParams } from "./use-cases/init-project.use-case";
// Extensions
export { registerProjectExtension } from "./infrastructure/pi/project.extension";
export type { ProjectExtensionDeps } from "./infrastructure/pi/project.extension";
```
- **Run**: `npx vitest run`
- **Expect**: All tests PASS
- **Commit**: `feat(S07/T11): add barrel exports for workflow and project hexagons`

---

## Wave 4 (depends on Wave 3)

### T12: CLI extension.ts (composition root) + main.ts

**Files:**
- Create: `src/cli/extension.ts`
- Create: `src/cli/extension.spec.ts`
- Create: `src/cli/main.ts`

**Depends on:** T09 (project extension), T10 (workflow extension), T11 (barrels), T13 (NodeProjectFileSystemAdapter)
**Traces to:** AC1, AC6

**Step 1: Write failing test**
- **File**: `src/cli/extension.spec.ts`
- **Code**:
```typescript
import { describe, expect, it, vi } from "vitest";
import { createTffExtension } from "./extension";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function makeMockApi() {
  return {
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
  };
}

describe("createTffExtension", () => {
  it("registers tff:new and tff:status commands", () => {
    const api = makeMockApi();
    createTffExtension(api, { projectRoot: "/workspace" });

    const commandNames = api.registerCommand.mock.calls.map(
      (call: unknown[]) => call[0],
    );
    expect(commandNames).toContain("tff:new");
    expect(commandNames).toContain("tff:status");
  });

  it("registers tff_init_project and tff_status tools", () => {
    const api = makeMockApi();
    createTffExtension(api, { projectRoot: "/workspace" });

    const toolNames = api.registerTool.mock.calls.map(
      (call: unknown[]) => {
        const tool = call[0];
        return isRecord(tool) ? tool["name"] : undefined;
      },
    );
    expect(toolNames).toContain("tff_init_project");
    expect(toolNames).toContain("tff_status");
  });
});
```
- **Run**: `npx vitest run src/cli/extension.spec.ts`
- **Expect**: FAIL — module not found

**Step 2: Implement extension.ts**
- **File**: `src/cli/extension.ts`
- **Code**:
```typescript
import {
  ConsoleLoggerAdapter,
  InProcessEventBus,
  SystemDateProvider,
} from "@kernel";
import type { ExtensionAPI } from "@infrastructure/pi";
import { registerProjectExtension } from "@hexagons/project";
import { registerWorkflowExtension } from "@hexagons/workflow";
import { MergeSettingsUseCase } from "@hexagons/settings";
import { InMemoryProjectRepository } from "@hexagons/project/infrastructure/in-memory-project.repository";
import { NodeProjectFileSystemAdapter } from "@hexagons/project/infrastructure/node-project-filesystem.adapter";
import { InMemoryMilestoneRepository } from "@hexagons/milestone/infrastructure/in-memory-milestone.repository";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { InMemoryTaskRepository } from "@hexagons/task/infrastructure/in-memory-task.repository";

export interface TffExtensionOptions {
  projectRoot: string;
}

export function createTffExtension(
  api: ExtensionAPI,
  options: TffExtensionOptions,
): void {
  // --- Shared infrastructure ---
  const logger = new ConsoleLoggerAdapter();
  const eventBus = new InProcessEventBus(logger);
  const dateProvider = new SystemDateProvider();

  // --- Repositories (in-memory for now; SQLite swap in later slice) ---
  const projectRepo = new InMemoryProjectRepository();
  const milestoneRepo = new InMemoryMilestoneRepository();
  const sliceRepo = new InMemorySliceRepository();
  const taskRepo = new InMemoryTaskRepository();

  // --- Hexagon extensions ---
  registerProjectExtension(api, {
    projectRoot: options.projectRoot,
    projectRepo,
    projectFs: new NodeProjectFileSystemAdapter(),
    mergeSettings: new MergeSettingsUseCase(),
    eventBus,
    dateProvider,
  });

  registerWorkflowExtension(api, {
    projectRepo,
    milestoneRepo,
    sliceRepo,
    taskRepo,
  });
}
```

**Step 3: Implement main.ts**
- **File**: `src/cli/main.ts`
- **Code**:
```typescript
/**
 * TFF-PI CLI entry point.
 *
 * Bootstraps a PI coding agent session with TFF extensions pre-loaded.
 * The exact PI SDK bootstrap API is documented in RESEARCH.md § 1.4.
 *
 * Currently a placeholder — PI SDK packages must be installed before
 * this file becomes fully functional. The extension wiring (extension.ts)
 * is the real composition root and is fully tested independently.
 */

// TODO: Install @mariozechner/pi-coding-agent and wire createAgentSession
// import { createAgentSession } from '@mariozechner/pi-coding-agent';
// import { createTffExtension } from './extension';
//
// const { session } = await createAgentSession({
//   cwd: process.cwd(),
//   customTools: [],  // tools registered via extension
// });
//
// After session creation, call:
// createTffExtension(session.extensionApi, { projectRoot: process.cwd() });

export { createTffExtension } from "./extension";
```
- **Run**: `npx vitest run src/cli/extension.spec.ts`
- **Expect**: PASS — 2 tests passing
- **Run**: `npx vitest run`
- **Expect**: All tests PASS (full suite, no regressions)
- **Commit**: `feat(S07/T12): add CLI composition root and main.ts bootstrap`

---

## AC Traceability

| AC | Tasks |
|----|-------|
| AC1 | T03, T12 (main.ts placeholder; full wiring deferred to PI SDK install) |
| AC2 | T02, T05, T07 |
| AC3 | T08 |
| AC4 | T06 |
| AC5 | T06 |
| AC6 | T09, T10, T11, T12 |
| AC7 | T04 |
| AC8 | T01, T02, T04, T06, T07, T08, T09, T10, T12, T13 |
