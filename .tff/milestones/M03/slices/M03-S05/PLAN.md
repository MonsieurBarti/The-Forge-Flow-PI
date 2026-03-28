# M03-S05: Discuss Command — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Build `/tff:discuss` command — multi-turn Q&A producing SPEC.md + complexity classification.
**Architecture:** Workflow hexagon (use cases + tools + command + adapters), Slice hexagon (aggregate mutations).
**Tech Stack:** TypeScript, Zod, Vitest, PI Extension API

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `src/hexagons/workflow/domain/ports/artifact-file.port.ts` | ArtifactFilePort abstract class + ArtifactType schema |
| `src/hexagons/workflow/domain/ports/autonomy-mode.provider.ts` | AutonomyModeProvider interface |
| `src/hexagons/workflow/domain/errors/file-io.error.ts` | FileIOError error class |
| `src/hexagons/workflow/use-cases/start-discuss.use-case.ts` | StartDiscussUseCase |
| `src/hexagons/workflow/use-cases/start-discuss.use-case.spec.ts` | Tests for StartDiscussUseCase |
| `src/hexagons/workflow/use-cases/write-spec.use-case.ts` | WriteSpecUseCase |
| `src/hexagons/workflow/use-cases/write-spec.use-case.spec.ts` | Tests for WriteSpecUseCase |
| `src/hexagons/workflow/use-cases/classify-complexity.use-case.ts` | ClassifyComplexityUseCase |
| `src/hexagons/workflow/use-cases/classify-complexity.use-case.spec.ts` | Tests for ClassifyComplexityUseCase |
| `src/hexagons/workflow/infrastructure/in-memory-artifact-file.adapter.ts` | InMemoryArtifactFileAdapter |
| `src/hexagons/workflow/infrastructure/artifact-file.contract.spec.ts` | Shared contract tests for both adapters |
| `src/hexagons/workflow/infrastructure/node-artifact-file.adapter.ts` | NodeArtifactFileAdapter (fs-based) |
| `src/hexagons/workflow/infrastructure/pi/write-spec.tool.ts` | tff_write_spec tool factory |
| `src/hexagons/workflow/infrastructure/pi/classify-complexity.tool.ts` | tff_classify_complexity tool factory |
| `src/hexagons/workflow/infrastructure/pi/workflow-transition.tool.ts` | tff_workflow_transition tool factory |
| `src/hexagons/workflow/infrastructure/pi/discuss.command.ts` | tff:discuss command handler factory |
| `src/hexagons/workflow/infrastructure/pi/discuss-protocol.ts` | DISCUSS_PROTOCOL_MESSAGE template |

### Modified Files

| File | Changes |
|---|---|
| `src/hexagons/slice/domain/slice.aggregate.ts` | Add `setSpecPath()`, `setComplexity()` methods |
| `src/hexagons/slice/domain/slice.aggregate.spec.ts` | Tests for new methods |
| `src/hexagons/workflow/infrastructure/pi/workflow.extension.ts` | Update `WorkflowExtensionDeps`, register 3 tools + 1 command |
| `src/cli/extension.ts` | Wire `NodeArtifactFileAdapter`, pass new deps |
| `src/hexagons/workflow/index.ts` | Export new ports, errors, use cases, tool/command factories |
| `src/hexagons/slice/index.ts` | Verify `ComplexityTierSchema` already exported (it is) |

---

## Wave 0 (parallel — no dependencies)

### T01: ArtifactFilePort + FileIOError

**Files:** Create `src/hexagons/workflow/domain/ports/artifact-file.port.ts`, `src/hexagons/workflow/domain/errors/file-io.error.ts`
**Traces to:** AC16

No TDD — port and error definitions only.

**Step 1:** Create `artifact-file.port.ts`:

```typescript
// src/hexagons/workflow/domain/ports/artifact-file.port.ts
import { z } from 'zod';
import type { Result } from '@kernel';
import type { FileIOError } from '../errors/file-io.error';

export const ArtifactTypeSchema = z.enum(['spec', 'plan', 'research', 'checkpoint']);
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

export const ARTIFACT_FILENAMES: Record<ArtifactType, string> = {
  spec: 'SPEC.md',
  plan: 'PLAN.md',
  research: 'RESEARCH.md',
  checkpoint: 'CHECKPOINT.md',
};

export abstract class ArtifactFilePort {
  abstract write(
    milestoneLabel: string,
    sliceLabel: string,
    artifactType: ArtifactType,
    content: string,
  ): Promise<Result<string, FileIOError>>;

  abstract read(
    milestoneLabel: string,
    sliceLabel: string,
    artifactType: ArtifactType,
  ): Promise<Result<string | null, FileIOError>>;
}
```

**Step 2:** Create `file-io.error.ts`:

```typescript
// src/hexagons/workflow/domain/errors/file-io.error.ts
import { WorkflowBaseError } from './workflow-base.error';

export class FileIOError extends WorkflowBaseError {
  readonly code = 'WORKFLOW.FILE_IO' as const;

  constructor(message: string, cause?: unknown) {
    super(message, { cause });
  }
}
```

**Commit:** `feat(S05/T01): add ArtifactFilePort and FileIOError`

---

### T02: AutonomyModeProvider interface

**Files:** Create `src/hexagons/workflow/domain/ports/autonomy-mode.provider.ts`
**Traces to:** AC14 (partial)

No TDD — interface definition only.

**Step 1:** Create `autonomy-mode.provider.ts`:

```typescript
// src/hexagons/workflow/domain/ports/autonomy-mode.provider.ts
import type { AutonomyMode } from '@hexagons/settings';

export abstract class AutonomyModeProvider {
  abstract getAutonomyMode(): AutonomyMode;
}
```

Note: `AutonomyMode` is `'guided' | 'plan-to-pr'` from the settings hexagon barrel export. If not exported, import `AutonomyModeSchema` and use `z.infer<typeof AutonomyModeSchema>`.

**Commit:** `feat(S05/T02): add AutonomyModeProvider interface`

---

### T03: Slice setSpecPath + setComplexity

**Files:** Modify `src/hexagons/slice/domain/slice.aggregate.ts`, modify `src/hexagons/slice/domain/slice.aggregate.spec.ts`
**Traces to:** AC15

**Step 1:** Write failing tests in `slice.aggregate.spec.ts`:

```typescript
// Note: SliceBuilder.build() uses Slice.createNew() which defaults specPath=null, complexity=null.
// To test with pre-set values, use Slice.reconstitute(new SliceBuilder().withComplexity('S').buildProps()).

describe('setSpecPath', () => {
  it('should set specPath and update updatedAt', () => {
    const now = new Date('2026-03-27T12:00:00Z');
    const slice = new SliceBuilder().build(); // specPath defaults to null

    slice.setSpecPath('/path/to/SPEC.md', now);

    expect(slice.specPath).toBe('/path/to/SPEC.md');
    expect(slice.updatedAt).toEqual(now);
  });
});

describe('setComplexity', () => {
  it('should set complexity tier directly and update updatedAt', () => {
    const now = new Date('2026-03-27T12:00:00Z');
    const slice = new SliceBuilder().build(); // complexity defaults to null

    slice.setComplexity('F-lite', now);

    expect(slice.complexity).toBe('F-lite');
    expect(slice.updatedAt).toEqual(now);
  });

  it('should allow overriding existing complexity', () => {
    const now = new Date('2026-03-27T12:00:00Z');
    const props = new SliceBuilder().withComplexity('S').buildProps();
    const slice = Slice.reconstitute(props);

    slice.setComplexity('F-full', now);

    expect(slice.complexity).toBe('F-full');
  });
});
```

**Step 2:** Run `npx vitest run src/hexagons/slice/domain/slice.aggregate.spec.ts` — expect FAIL (methods not defined).

**Step 3:** Implement in `slice.aggregate.ts`:

```typescript
setSpecPath(path: string, now: Date): void {
  this.props.specPath = path;
  this.props.updatedAt = now;
}

setComplexity(tier: ComplexityTier, now: Date): void {
  this.props.complexity = tier;
  this.props.updatedAt = now;
}
```

Follow the pattern of existing `classify(criteria, now)` — mutate props + update timestamp. No domain event (metadata update, not status change).

**Step 4:** Run `npx vitest run src/hexagons/slice/domain/slice.aggregate.spec.ts` — expect PASS.

**Commit:** `feat(S05/T03): add Slice setSpecPath and setComplexity methods`

---

### T09: tff_workflow_transition tool

**Files:** Create `src/hexagons/workflow/infrastructure/pi/workflow-transition.tool.ts`
**Traces to:** AC5, AC13 (partial)

No TDD — thin PI adapter. Tested via integration.

**Step 1:** Create `workflow-transition.tool.ts`:

```typescript
import { z } from 'zod';
import { WorkflowTriggerSchema } from '@hexagons/workflow';
import { ComplexityTierSchema } from '@hexagons/slice';
import type { OrchestratePhaseTransitionUseCase } from '../../use-cases/orchestrate-phase-transition.use-case';
import type { WorkflowSessionRepositoryPort } from '../../domain/ports/workflow-session.repository.port';
import type { SliceRepositoryPort } from '@hexagons/slice';
import { createZodTool } from '@infrastructure/pi/create-zod-tool';
import { isErr } from '@kernel';
import type { AgentToolResult } from '@infrastructure/pi/pi.types';

const WorkflowTransitionSchema = z.object({
  milestoneId: z.string().describe('Milestone UUID'),
  trigger: WorkflowTriggerSchema.describe('Workflow trigger'),
  complexityTier: ComplexityTierSchema.optional().describe('Slice complexity tier if known'),
});

export interface WorkflowTransitionToolDeps {
  orchestratePhaseTransition: OrchestratePhaseTransitionUseCase;
  sessionRepo: WorkflowSessionRepositoryPort;
  sliceRepo: SliceRepositoryPort;
  maxRetries: number;
}

export function createWorkflowTransitionTool(deps: WorkflowTransitionToolDeps) {
  const textResult = (text: string): AgentToolResult => ({
    content: [{ type: 'text', text }],
  });

  return createZodTool({
    name: 'tff_workflow_transition',
    label: 'TFF Workflow Transition',
    description: 'Transition the workflow to the next phase. Constructs guard context internally.',
    schema: WorkflowTransitionSchema,
    execute: async (params) => {
      // 1. Load session
      const sessionResult = await deps.sessionRepo.findByMilestoneId(params.milestoneId);
      if (isErr(sessionResult)) return textResult(`Error: ${sessionResult.error.message}`);
      const session = sessionResult.data;
      if (!session) return textResult('Error: No workflow session found for milestone');

      // 2. Resolve complexity tier
      let complexityTier = params.complexityTier ?? null;
      if (!complexityTier && session.sliceId) {
        const sliceResult = await deps.sliceRepo.findById(session.sliceId);
        if (isErr(sliceResult)) return textResult(`Error: ${sliceResult.error.message}`);
        complexityTier = sliceResult.data?.complexity ?? null;
      }

      // 3. Compute allSlicesClosed
      const slicesResult = await deps.sliceRepo.findByMilestoneId(params.milestoneId);
      if (isErr(slicesResult)) return textResult(`Error: ${slicesResult.error.message}`);
      const allSlicesClosed = slicesResult.data.every(s => s.status === 'closed');

      // 4. Call use case with assembled guard context
      const result = await deps.orchestratePhaseTransition.execute({
        milestoneId: params.milestoneId,
        trigger: params.trigger,
        guardContext: {
          complexityTier,
          retryCount: session.retryCount,
          maxRetries: deps.maxRetries,
          allSlicesClosed,
          lastError: session.lastEscalation?.lastError ?? null,
        },
      });

      if (isErr(result)) return textResult(`Error: ${result.error.message}`);
      return textResult(JSON.stringify(result.data));
    },
  });
}
```

**Commit:** `feat(S05/T09): add tff_workflow_transition tool`

---

### T12: DISCUSS_PROTOCOL_MESSAGE

**Files:** Create `src/hexagons/workflow/infrastructure/pi/discuss-protocol.ts`
**Traces to:** AC8, AC12

No TDD — template string.

**Step 1:** Create `discuss-protocol.ts`:

```typescript
export interface DiscussProtocolParams {
  sliceId: string;
  sliceLabel: string;
  sliceTitle: string;
  sliceDescription: string;
  milestoneLabel: string;
  milestoneId: string;
  autonomyMode: string;
}

export function buildDiscussProtocolMessage(params: DiscussProtocolParams): string {
  return `You are now in the DISCUSS phase for slice ${params.sliceLabel}: ${params.sliceTitle}.

## Context
- Slice ID: ${params.sliceId}
- Milestone: ${params.milestoneLabel} (ID: ${params.milestoneId})
- Description: ${params.sliceDescription}
- Autonomy mode: ${params.autonomyMode}

## Instructions

Drive a 3-phase discussion to produce a validated SPEC.md:

### Phase 1 — Scope (2-4 clarifying questions)
Ask the user 2-4 clarifying questions about the slice requirements. Focus on:
- What exactly needs to be built
- What's in scope vs out of scope
- Key constraints or dependencies

### Phase 2 — Approach (2-3 options with recommendation)
Based on user answers, propose 2-3 technical approaches with trade-offs. Recommend one. Let the user choose.

### Phase 3 — Design (section by section)
Present the detailed design section by section. For each section, get user confirmation before moving to the next:
- Ports and interfaces
- Use cases
- Infrastructure adapters
- Wiring and integration points
- Acceptance criteria

### After design is approved:
1. Call \`tff_write_spec\` with milestoneLabel="${params.milestoneLabel}", sliceLabel="${params.sliceLabel}", sliceId="${params.sliceId}", and the full spec content as markdown.
2. Dispatch a spec reviewer via the Agent tool (use subagent_type="the-forge-flow:tff-spec-reviewer"). If the reviewer requests changes, revise and re-submit. Max 3 iterations.
3. Ask the user to approve the final spec.
4. Call \`tff_classify_complexity\` with sliceId="${params.sliceId}" and the user-confirmed tier (S, F-lite, or F-full).
5. Call \`tff_workflow_transition\` with milestoneId="${params.milestoneId}", trigger="next" (or "skip" if user wants to skip research), and the confirmed complexityTier.
6. ${params.autonomyMode === 'plan-to-pr' ? 'Invoke the next phase command automatically.' : 'Suggest the next step: `/tff:research` (if F-lite/F-full) or `/tff:plan` (if S-tier or research skipped).'}`;
}
```

**Commit:** `feat(S05/T12): add DISCUSS_PROTOCOL_MESSAGE template`

---

## Wave 1 (depends on Wave 0)

### T04: InMemoryArtifactFileAdapter + contract tests

**Files:** Create `src/hexagons/workflow/infrastructure/in-memory-artifact-file.adapter.ts`, create `src/hexagons/workflow/infrastructure/artifact-file.contract.spec.ts`
**Depends on:** T01 (ArtifactFilePort)
**Traces to:** AC7

**Step 1:** Write contract tests in `artifact-file.contract.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { ArtifactFilePort } from '@hexagons/workflow';
import { isOk } from '@kernel';
import { InMemoryArtifactFileAdapter } from '../infrastructure/in-memory-artifact-file.adapter';

// Shared contract — parameterized test suite
export function artifactFileContractTests(
  name: string,
  factory: () => { adapter: ArtifactFilePort; cleanup?: () => Promise<void> },
) {
  describe(`ArtifactFilePort contract: ${name}`, () => {
    it('should write and read back content', async () => {
      const { adapter, cleanup } = factory();
      const writeResult = await adapter.write('M03', 'M03-S05', 'spec', '# My Spec');
      expect(isOk(writeResult)).toBe(true);

      const readResult = await adapter.read('M03', 'M03-S05', 'spec');
      expect(isOk(readResult)).toBe(true);
      if (isOk(readResult)) expect(readResult.data).toBe('# My Spec');

      await cleanup?.();
    });

    it('should return null for missing artifact', async () => {
      const { adapter, cleanup } = factory();
      const result = await adapter.read('M03', 'M03-S99', 'spec');
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.data).toBeNull();

      await cleanup?.();
    });

    it('should overwrite existing artifact', async () => {
      const { adapter, cleanup } = factory();
      await adapter.write('M03', 'M03-S05', 'spec', 'v1');
      await adapter.write('M03', 'M03-S05', 'spec', 'v2');
      const result = await adapter.read('M03', 'M03-S05', 'spec');
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.data).toBe('v2');

      await cleanup?.();
    });

    it('should handle all artifact types', async () => {
      const { adapter, cleanup } = factory();
      for (const type of ['spec', 'plan', 'research', 'checkpoint'] as const) {
        const writeResult = await adapter.write('M01', 'M01-S01', type, `content-${type}`);
        expect(isOk(writeResult)).toBe(true);
      }

      await cleanup?.();
    });
  });
}

// Run contract tests for InMemoryArtifactFileAdapter
artifactFileContractTests('InMemoryArtifactFileAdapter', () => ({
  adapter: new InMemoryArtifactFileAdapter(),
}));
```

**Step 2:** Run `npx vitest run src/hexagons/workflow/infrastructure/artifact-file.contract.spec.ts` — expect FAIL (adapter not found).

**Step 3:** Implement `in-memory-artifact-file.adapter.ts`:

```typescript
import { ok, type Result } from '@kernel';
import { ArtifactFilePort, ARTIFACT_FILENAMES, type ArtifactType } from '@hexagons/workflow';
import type { FileIOError } from '@hexagons/workflow';

export class InMemoryArtifactFileAdapter extends ArtifactFilePort {
  private store = new Map<string, string>();

  private key(milestoneLabel: string, sliceLabel: string, artifactType: ArtifactType): string {
    return `${milestoneLabel}/${sliceLabel}/${artifactType}`;
  }

  async write(
    milestoneLabel: string,
    sliceLabel: string,
    artifactType: ArtifactType,
    content: string,
  ): Promise<Result<string, FileIOError>> {
    this.store.set(this.key(milestoneLabel, sliceLabel, artifactType), content);
    const path = `.tff/milestones/${milestoneLabel}/slices/${sliceLabel}/${ARTIFACT_FILENAMES[artifactType]}`;
    return ok(path);
  }

  async read(
    milestoneLabel: string,
    sliceLabel: string,
    artifactType: ArtifactType,
  ): Promise<Result<string | null, FileIOError>> {
    return ok(this.store.get(this.key(milestoneLabel, sliceLabel, artifactType)) ?? null);
  }

  reset(): void {
    this.store.clear();
  }
}
```

**Step 4:** Run `npx vitest run src/hexagons/workflow/infrastructure/artifact-file.contract.spec.ts` — expect PASS.

**Commit:** `feat(S05/T04): add InMemoryArtifactFileAdapter with contract tests`

---

### T05: NodeArtifactFileAdapter + contract tests

**Files:** Create `src/hexagons/workflow/infrastructure/node-artifact-file.adapter.ts`, add to `artifact-file.contract.spec.ts`
**Depends on:** T01 (ArtifactFilePort)
**Traces to:** AC7

**Step 1:** Add contract test runner for Node adapter in `artifact-file.contract.spec.ts`:

```typescript
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeArtifactFileAdapter } from './node-artifact-file.adapter';

artifactFileContractTests('NodeArtifactFileAdapter', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'tff-test-'));

  return {
    adapter: new NodeArtifactFileAdapter(projectRoot),
    cleanup: async () => { rmSync(projectRoot, { recursive: true, force: true }); },
  };
});
```

**Step 2:** Run `npx vitest run src/hexagons/workflow/infrastructure/artifact-file.contract.spec.ts` — expect FAIL (NodeArtifactFileAdapter not found).

**Step 3:** Implement `node-artifact-file.adapter.ts`:

```typescript
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ok, err, type Result } from '@kernel';
import { ArtifactFilePort, ARTIFACT_FILENAMES, type ArtifactType } from '@hexagons/workflow';
import { FileIOError } from '@hexagons/workflow';

export class NodeArtifactFileAdapter extends ArtifactFilePort {
  constructor(private readonly projectRoot: string) {
    super();
  }

  private resolvePath(milestoneLabel: string, sliceLabel: string, artifactType: ArtifactType): string {
    return join(
      this.projectRoot,
      '.tff', 'milestones', milestoneLabel, 'slices', sliceLabel,
      ARTIFACT_FILENAMES[artifactType],
    );
  }

  async write(
    milestoneLabel: string,
    sliceLabel: string,
    artifactType: ArtifactType,
    content: string,
  ): Promise<Result<string, FileIOError>> {
    const path = this.resolvePath(milestoneLabel, sliceLabel, artifactType);
    try {
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, content, 'utf-8');
      return ok(path);
    } catch (cause) {
      return err(new FileIOError(`Failed to write ${path}`, cause));
    }
  }

  async read(
    milestoneLabel: string,
    sliceLabel: string,
    artifactType: ArtifactType,
  ): Promise<Result<string | null, FileIOError>> {
    const path = this.resolvePath(milestoneLabel, sliceLabel, artifactType);
    try {
      const content = await readFile(path, 'utf-8');
      return ok(content);
    } catch (cause: unknown) {
      if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') {
        return ok(null);
      }
      return err(new FileIOError(`Failed to read ${path}`, cause));
    }
  }
}
```

**Step 4:** Run `npx vitest run src/hexagons/workflow/infrastructure/artifact-file.contract.spec.ts` — expect PASS (both adapters).

**Commit:** `feat(S05/T05): add NodeArtifactFileAdapter with contract tests`

---

### T06: StartDiscussUseCase

**Files:** Create `src/hexagons/workflow/use-cases/start-discuss.use-case.ts`, create `src/hexagons/workflow/use-cases/start-discuss.use-case.spec.ts`
**Depends on:** T02 (AutonomyModeProvider)
**Traces to:** AC2, AC9, AC6

**Step 1:** Write failing tests in `start-discuss.use-case.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isOk, isErr } from '@kernel';

// Note: No FixedDateProvider exists in kernel. Use inline object conforming to DateProviderPort.
function setup(overrides?: { autonomyMode?: 'guided' | 'plan-to-pr' }) {
  const sliceRepo = new InMemorySliceRepository();
  const sessionRepo = new InMemoryWorkflowSessionRepository();
  const eventBus = new InProcessEventBus();
  const fixedNow = new Date('2026-03-27T12:00:00Z');
  const dateProvider = { now: () => fixedNow };
  const autonomyModeProvider = {
    getAutonomyMode: () => overrides?.autonomyMode ?? ('plan-to-pr' as const),
  };

  const useCase = new StartDiscussUseCase(
    sliceRepo, sessionRepo, eventBus, dateProvider, autonomyModeProvider,
  );
  return { useCase, sliceRepo, sessionRepo, eventBus, dateProvider };
}

describe('StartDiscussUseCase', () => {
  it('should create a new session, assign slice, and transition to discussing', async () => {
    const { useCase, sliceRepo } = setup();
    const slice = new SliceBuilder().withId('slice-1').build(); // status defaults to 'discussing'
    sliceRepo.seed(slice);

    const result = await useCase.execute({ sliceId: 'slice-1', milestoneId: 'ms-1' });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.fromPhase).toBe('idle');
      expect(result.data.toPhase).toBe('discussing');
      expect(result.data.autonomyMode).toBe('plan-to-pr');
    }
  });

  it('should reuse existing session for the milestone', async () => {
    const { useCase, sliceRepo, sessionRepo } = setup();
    const slice = new SliceBuilder().withId('slice-2').build();
    sliceRepo.seed(slice);
    // Pre-create a session for the milestone (idle, no active slice)
    const existingSession = WorkflowSession.createNew({
      id: 'session-1', milestoneId: 'ms-1', autonomyMode: 'plan-to-pr', now: new Date(),
    });
    sessionRepo.seed(existingSession);

    const result = await useCase.execute({ sliceId: 'slice-2', milestoneId: 'ms-1' });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.data.sessionId).toBe('session-1');
  });

  it('should return SliceNotFoundError if slice does not exist', async () => {
    const { useCase } = setup();
    const result = await useCase.execute({ sliceId: 'nonexistent', milestoneId: 'ms-1' });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toContain('SLICE');
  });

  it('should return SliceAlreadyAssignedError if session has active slice', async () => {
    const { useCase, sliceRepo, sessionRepo } = setup();
    const slice1 = new SliceBuilder().withId('slice-1').build();
    const slice2 = new SliceBuilder().withId('slice-2').build();
    sliceRepo.seed(slice1);
    sliceRepo.seed(slice2);
    // Create session with an already-assigned slice
    const session = WorkflowSession.createNew({
      id: 'session-1', milestoneId: 'ms-1', autonomyMode: 'plan-to-pr', now: new Date(),
    });
    session.assignSlice('slice-1');
    sessionRepo.seed(session);

    const result = await useCase.execute({ sliceId: 'slice-2', milestoneId: 'ms-1' });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toContain('ALREADY_ASSIGNED');
  });

  it('should return NoMatchingTransitionError if session not idle', async () => {
    const { useCase, sliceRepo, sessionRepo } = setup();
    const slice = new SliceBuilder().withId('slice-1').build();
    sliceRepo.seed(slice);
    // Create session already in 'discussing' phase (not idle)
    const props = new WorkflowSessionBuilder().withCurrentPhase('discussing').buildProps();
    const session = WorkflowSession.reconstitute({ ...props, milestoneId: 'ms-1' });
    sessionRepo.seed(session);

    const result = await useCase.execute({ sliceId: 'slice-1', milestoneId: 'ms-1' });
    expect(isErr(result)).toBe(true);
    // assignSlice or trigger will fail since session is not idle
  });
});
```

**Step 2:** Run `npx vitest run src/hexagons/workflow/use-cases/start-discuss.use-case.spec.ts` — expect FAIL.

**Step 3:** Implement `start-discuss.use-case.ts`:

```typescript
import { ok, err, isErr, type Result } from '@kernel';
import type { SliceRepositoryPort, SliceNotFoundError } from '@hexagons/slice';
import type { WorkflowSessionRepositoryPort } from '../domain/ports/workflow-session.repository.port';
import type { EventBusPort, DateProviderPort } from '@kernel';
import type { AutonomyModeProvider } from '../domain/ports/autonomy-mode.provider';
import { WorkflowSession } from '../domain/workflow-session.aggregate';
import type { WorkflowBaseError } from '../domain/errors/workflow-base.error';
import type { PersistenceError } from '@kernel';

export interface StartDiscussInput {
  sliceId: string;
  milestoneId: string;
}

export interface StartDiscussOutput {
  sessionId: string;
  fromPhase: string;
  toPhase: string;
  autonomyMode: string;
}

export class StartDiscussUseCase {
  constructor(
    private readonly sliceRepo: SliceRepositoryPort,
    private readonly sessionRepo: WorkflowSessionRepositoryPort,
    private readonly eventBus: EventBusPort,
    private readonly dateProvider: DateProviderPort,
    private readonly autonomyModeProvider: AutonomyModeProvider,
  ) {}

  async execute(
    input: StartDiscussInput,
  ): Promise<Result<StartDiscussOutput, SliceNotFoundError | WorkflowBaseError | PersistenceError>> {
    // 1. Validate slice exists
    const sliceResult = await this.sliceRepo.findById(input.sliceId);
    if (isErr(sliceResult)) return sliceResult;
    if (!sliceResult.data) return err(/* SliceNotFoundError */);

    // 2. Find or create session
    const sessionResult = await this.sessionRepo.findByMilestoneId(input.milestoneId);
    if (isErr(sessionResult)) return sessionResult;

    const now = this.dateProvider.now();
    let session = sessionResult.data;
    if (!session) {
      session = WorkflowSession.createNew({
        id: crypto.randomUUID(),
        milestoneId: input.milestoneId,
        autonomyMode: this.autonomyModeProvider.getAutonomyMode(),
        now,
      });
    }

    // 3. Assign slice
    const assignResult = session.assignSlice(input.sliceId);
    if (isErr(assignResult)) return assignResult;

    // 4. Trigger start transition
    const fromPhase = session.currentPhase;
    const triggerResult = session.trigger('start', {
      complexityTier: null, retryCount: 0, maxRetries: 2,
      allSlicesClosed: false, lastError: null,
    }, now);
    if (isErr(triggerResult)) return triggerResult;

    // 5. Save session
    const saveResult = await this.sessionRepo.save(session);
    if (isErr(saveResult)) return saveResult;

    // 6. Publish events
    for (const event of session.pullEvents()) {
      await this.eventBus.publish(event);
    }

    return ok({
      sessionId: session.id,
      fromPhase,
      toPhase: session.currentPhase,
      autonomyMode: session.autonomyMode,
    });
  }
}
```

**Step 4:** Run `npx vitest run src/hexagons/workflow/use-cases/start-discuss.use-case.spec.ts` — expect PASS.

**Commit:** `feat(S05/T06): add StartDiscussUseCase`

---

### T08: ClassifyComplexityUseCase

**Files:** Create `src/hexagons/workflow/use-cases/classify-complexity.use-case.ts`, create `src/hexagons/workflow/use-cases/classify-complexity.use-case.spec.ts`
**Depends on:** T03 (Slice.setComplexity)
**Traces to:** AC4, AC11, AC6

**Step 1:** Write failing tests:

```typescript
describe('ClassifyComplexityUseCase', () => {
  it('should set complexity tier on slice', async () => {
    const { useCase, sliceRepo } = setup();
    const slice = new SliceBuilder().withId('s1').build(); // complexity defaults to null
    sliceRepo.seed(slice);

    const result = await useCase.execute({ sliceId: 's1', tier: 'F-lite' });

    expect(isOk(result)).toBe(true);
    const updated = await sliceRepo.findById('s1');
    if (isOk(updated) && updated.data) {
      expect(updated.data.complexity).toBe('F-lite');
    }
  });

  it('should return SliceNotFoundError if slice not found', async () => {
    const { useCase } = setup();
    const result = await useCase.execute({ sliceId: 'none', tier: 'S' });
    expect(isErr(result)).toBe(true);
  });
});
```

**Step 2:** Run `npx vitest run src/hexagons/workflow/use-cases/classify-complexity.use-case.spec.ts` — expect FAIL.

**Step 3:** Implement:

```typescript
export class ClassifyComplexityUseCase {
  constructor(
    private readonly sliceRepo: SliceRepositoryPort,
    private readonly dateProvider: DateProviderPort,
  ) {}

  async execute(input: { sliceId: string; tier: ComplexityTier }):
    Promise<Result<{ sliceId: string; tier: ComplexityTier }, SliceNotFoundError | PersistenceError>> {
    const result = await this.sliceRepo.findById(input.sliceId);
    if (isErr(result)) return result;
    if (!result.data) return err(new SliceNotFoundError(input.sliceId));

    result.data.setComplexity(input.tier, this.dateProvider.now());

    const saveResult = await this.sliceRepo.save(result.data);
    if (isErr(saveResult)) return saveResult;

    return ok({ sliceId: input.sliceId, tier: input.tier });
  }
}
```

**Step 4:** Run `npx vitest run src/hexagons/workflow/use-cases/classify-complexity.use-case.spec.ts` — expect PASS.

**Commit:** `feat(S05/T08): add ClassifyComplexityUseCase`

---

## Wave 2 (depends on Waves 0-1)

### T07: WriteSpecUseCase

**Files:** Create `src/hexagons/workflow/use-cases/write-spec.use-case.ts`, create `src/hexagons/workflow/use-cases/write-spec.use-case.spec.ts`
**Depends on:** T01 (ArtifactFilePort), T03 (Slice.setSpecPath), T04 (InMemoryArtifactFileAdapter)
**Traces to:** AC3, AC10, AC6

**Step 1:** Write failing tests:

```typescript
describe('WriteSpecUseCase', () => {
  it('should write SPEC.md and update slice specPath', async () => {
    const { useCase, sliceRepo, artifactFile } = setup();
    const slice = new SliceBuilder().withId('s1').build(); // specPath defaults to null
    sliceRepo.seed(slice);

    const result = await useCase.execute({
      milestoneLabel: 'M03', sliceLabel: 'M03-S05',
      sliceId: 's1', content: '# My Spec',
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.data.path).toContain('SPEC.md');

    // Verify file was written
    const readResult = await artifactFile.read('M03', 'M03-S05', 'spec');
    if (isOk(readResult)) expect(readResult.data).toBe('# My Spec');

    // Verify slice specPath updated
    const updated = await sliceRepo.findById('s1');
    if (isOk(updated) && updated.data) expect(updated.data.specPath).toContain('SPEC.md');
  });

  it('should return FileIOError when write fails', async () => {
    // Create a failing adapter by extending ArtifactFilePort
    const failingAdapter: ArtifactFilePort = {
      write: async () => err(new FileIOError('Disk full')),
      read: async () => ok(null),
    } as ArtifactFilePort;
    const { sliceRepo, dateProvider } = setup();
    const failUseCase = new WriteSpecUseCase(failingAdapter, sliceRepo, dateProvider);
    const slice = new SliceBuilder().withId('s1').build();
    sliceRepo.seed(slice);

    const result = await failUseCase.execute({
      milestoneLabel: 'M03', sliceLabel: 'M03-S05', sliceId: 's1', content: '# Spec',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('WORKFLOW.FILE_IO');
  });

  it('should return SliceNotFoundError when slice missing', async () => {
    const { useCase } = setup();
    const result = await useCase.execute({
      milestoneLabel: 'M03', sliceLabel: 'M03-S05', sliceId: 'nonexistent', content: '# Spec',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toContain('SLICE');
  });
});
```

**Step 2:** Run `npx vitest run src/hexagons/workflow/use-cases/write-spec.use-case.spec.ts` — expect FAIL.

**Step 3:** Implement:

```typescript
export class WriteSpecUseCase {
  constructor(
    private readonly artifactFilePort: ArtifactFilePort,
    private readonly sliceRepo: SliceRepositoryPort,
    private readonly dateProvider: DateProviderPort,
  ) {}

  async execute(input: {
    milestoneLabel: string; sliceLabel: string; sliceId: string; content: string;
  }): Promise<Result<{ path: string }, FileIOError | SliceNotFoundError | PersistenceError>> {
    const writeResult = await this.artifactFilePort.write(
      input.milestoneLabel, input.sliceLabel, 'spec', input.content,
    );
    if (isErr(writeResult)) return writeResult;

    const sliceResult = await this.sliceRepo.findById(input.sliceId);
    if (isErr(sliceResult)) return sliceResult;
    if (!sliceResult.data) return err(new SliceNotFoundError(input.sliceId));

    sliceResult.data.setSpecPath(writeResult.data, this.dateProvider.now());

    const saveResult = await this.sliceRepo.save(sliceResult.data);
    if (isErr(saveResult)) return saveResult;

    return ok({ path: writeResult.data });
  }
}
```

**Step 4:** Run `npx vitest run src/hexagons/workflow/use-cases/write-spec.use-case.spec.ts` — expect PASS.

**Commit:** `feat(S05/T07): add WriteSpecUseCase`

---

### T11: tff_classify_complexity tool

**Files:** Create `src/hexagons/workflow/infrastructure/pi/classify-complexity.tool.ts`
**Depends on:** T08 (ClassifyComplexityUseCase)
**Traces to:** AC13 (partial)

No TDD — thin PI adapter.

**Step 1:** Create `classify-complexity.tool.ts`:

```typescript
import { z } from 'zod';
import { ComplexityTierSchema } from '@hexagons/slice';
import type { ClassifyComplexityUseCase } from '../../use-cases/classify-complexity.use-case';
import { createZodTool } from '@infrastructure/pi/create-zod-tool';
import { isErr } from '@kernel';

const ClassifyComplexitySchema = z.object({
  sliceId: z.string().describe('Slice UUID'),
  tier: ComplexityTierSchema.describe('Complexity tier: S, F-lite, or F-full'),
});

export function createClassifyComplexityTool(useCase: ClassifyComplexityUseCase) {
  return createZodTool({
    name: 'tff_classify_complexity',
    label: 'TFF Classify Complexity',
    description: 'Set the complexity tier for a slice after user confirmation.',
    schema: ClassifyComplexitySchema,
    execute: async (params) => {
      const result = await useCase.execute(params);
      if (isErr(result)) return { content: [{ type: 'text', text: `Error: ${result.error.message}` }] };
      return { content: [{ type: 'text', text: JSON.stringify(result.data) }] };
    },
  });
}
```

**Commit:** `feat(S05/T11): add tff_classify_complexity tool`

---

### T13: tff:discuss command handler

**Files:** Create `src/hexagons/workflow/infrastructure/pi/discuss.command.ts`
**Depends on:** T06 (StartDiscussUseCase), T12 (DISCUSS_PROTOCOL_MESSAGE)
**Traces to:** AC1

No TDD — PI command handler.

**Step 1:** Create `discuss.command.ts`:

```typescript
import { isErr } from '@kernel';
import type { StartDiscussUseCase } from '../../use-cases/start-discuss.use-case';
import type { SliceRepositoryPort } from '@hexagons/slice';
import type { MilestoneRepositoryPort } from '@hexagons/milestone';
import { buildDiscussProtocolMessage } from './discuss-protocol';
import type { ExtensionAPI, ExtensionCommandContext } from '@infrastructure/pi/pi.types';

export interface DiscussCommandDeps {
  startDiscuss: StartDiscussUseCase;
  sliceRepo: SliceRepositoryPort;
  milestoneRepo: MilestoneRepositoryPort;
}

export function registerDiscussCommand(
  api: ExtensionAPI,
  deps: DiscussCommandDeps,
): void {
  api.registerCommand('tff:discuss', {
    description: 'Start the discuss phase for a slice — multi-turn Q&A producing SPEC.md',
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      // 1. Resolve target slice from args (label or ID)
      const identifier = args.trim();
      if (!identifier) {
        ctx.sendUserMessage('Usage: /tff:discuss <slice-label-or-id>');
        return;
      }

      // Try findByLabel first (e.g., "M03-S05"), fall back to findById (UUID)
      let sliceResult = await deps.sliceRepo.findByLabel(identifier);
      if (isErr(sliceResult)) {
        ctx.sendUserMessage(`Error loading slice: ${sliceResult.error.message}`);
        return;
      }
      if (!sliceResult.data) {
        sliceResult = await deps.sliceRepo.findById(identifier);
        if (isErr(sliceResult)) {
          ctx.sendUserMessage(`Error loading slice: ${sliceResult.error.message}`);
          return;
        }
      }
      const slice = sliceResult.data;
      if (!slice) {
        ctx.sendUserMessage(`Slice not found: ${identifier}`);
        return;
      }

      // 2. Load milestone
      const msResult = await deps.milestoneRepo.findById(slice.milestoneId);
      if (isErr(msResult) || !msResult.data) {
        ctx.sendUserMessage(`Milestone not found for slice ${slice.label}`);
        return;
      }
      const milestone = msResult.data;

      // 3. Call StartDiscussUseCase
      const result = await deps.startDiscuss.execute({
        sliceId: slice.id,
        milestoneId: milestone.id,
      });

      if (isErr(result)) {
        ctx.sendUserMessage(`Error starting discuss: ${result.error.message}`);
        return;
      }

      // 4. Send protocol message
      ctx.sendUserMessage(buildDiscussProtocolMessage({
        sliceId: slice.id,
        sliceLabel: slice.label,
        sliceTitle: slice.title,
        sliceDescription: slice.description ?? '',
        milestoneLabel: milestone.label,
        milestoneId: milestone.id,
        autonomyMode: result.data.autonomyMode,
      }));
    },
  });
}
```

**Commit:** `feat(S05/T13): add tff:discuss command handler`

---

## Wave 3 (depends on Wave 2)

### T10: tff_write_spec tool

**Files:** Create `src/hexagons/workflow/infrastructure/pi/write-spec.tool.ts`
**Depends on:** T07 (WriteSpecUseCase)
**Traces to:** AC13 (partial)

No TDD — thin PI adapter.

**Step 1:** Create `write-spec.tool.ts`:

```typescript
import { z } from 'zod';
import type { WriteSpecUseCase } from '../../use-cases/write-spec.use-case';
import { createZodTool } from '@infrastructure/pi/create-zod-tool';
import { isErr } from '@kernel';

const WriteSpecSchema = z.object({
  milestoneLabel: z.string().describe('Milestone label, e.g. M03'),
  sliceLabel: z.string().describe('Slice label, e.g. M03-S05'),
  sliceId: z.string().describe('Slice UUID'),
  content: z.string().describe('Markdown spec content'),
});

export function createWriteSpecTool(useCase: WriteSpecUseCase) {
  return createZodTool({
    name: 'tff_write_spec',
    label: 'TFF Write Spec',
    description: 'Write SPEC.md for a slice and update the slice aggregate.',
    schema: WriteSpecSchema,
    execute: async (params) => {
      const result = await useCase.execute(params);
      if (isErr(result)) return { content: [{ type: 'text', text: `Error: ${result.error.message}` }] };
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, path: result.data.path }) }] };
    },
  });
}
```

**Commit:** `feat(S05/T10): add tff_write_spec tool`

---

## Wave 4 (depends on all previous)

### T14: WorkflowExtensionDeps + wiring + barrel exports

**Files:** Modify `src/hexagons/workflow/infrastructure/pi/workflow.extension.ts`, modify `src/cli/extension.ts`, modify `src/hexagons/workflow/index.ts`, modify `src/hexagons/slice/index.ts`
**Depends on:** T04, T05, T06, T07, T08, T09, T10, T11, T13
**Traces to:** AC13, AC14

No TDD — integration wiring.

**Step 1:** Update `WorkflowExtensionDeps` in `workflow.extension.ts`. Add these NEW deps (milestoneRepo already exists in deps):

```typescript
export interface WorkflowExtensionDeps {
  // ... existing deps (projectRepo, milestoneRepo, sliceRepo, taskRepo,
  //   sliceTransitionPort, eventBus, dateProvider, contextStaging) ...
  artifactFile: ArtifactFilePort;           // NEW
  workflowSessionRepo: WorkflowSessionRepositoryPort;  // NEW
  autonomyModeProvider: AutonomyModeProvider;           // NEW
  maxRetries: number;                                   // NEW
}
```

**Step 2:** In `registerWorkflowExtension`, instantiate use cases and register tools + command:

```typescript
// Instantiate use cases
const startDiscuss = new StartDiscussUseCase(
  deps.sliceRepo, deps.workflowSessionRepo, deps.eventBus,
  deps.dateProvider, deps.autonomyModeProvider,
);
const writeSpec = new WriteSpecUseCase(
  deps.artifactFile, deps.sliceRepo, deps.dateProvider,
);
const classifyComplexity = new ClassifyComplexityUseCase(
  deps.sliceRepo, deps.dateProvider,
);
const orchestratePhaseTransition = new OrchestratePhaseTransitionUseCase(
  deps.workflowSessionRepo, deps.sliceTransitionPort, deps.eventBus, deps.dateProvider,
);

// Register tools
api.registerTool(createWriteSpecTool(writeSpec));
api.registerTool(createClassifyComplexityTool(classifyComplexity));
api.registerTool(createWorkflowTransitionTool({
  orchestratePhaseTransition,
  sessionRepo: deps.workflowSessionRepo,
  sliceRepo: deps.sliceRepo,
  maxRetries: deps.maxRetries,
}));

// Register command
registerDiscussCommand(api, {
  startDiscuss,
  sliceRepo: deps.sliceRepo,
  milestoneRepo: deps.milestoneRepo,
});
```

**Step 3:** Update `extension.ts` (CLI wiring):

```typescript
// In createTffExtension — add these new instantiations:
const artifactFile = new NodeArtifactFileAdapter(options.projectRoot);
const workflowSessionRepo = new InMemoryWorkflowSessionRepository();
const autonomyModeProvider = { getAutonomyMode: () => 'plan-to-pr' as const };
// TODO: Read autonomyMode from settings.yaml in future slice

registerWorkflowExtension(api, {
  // ... existing deps (projectRepo, milestoneRepo, sliceRepo, taskRepo,
  //   sliceTransitionPort, eventBus, dateProvider, contextStaging) ...
  artifactFile,
  workflowSessionRepo,
  autonomyModeProvider,
  maxRetries: 2,
});
```

**Step 4:** Update barrel exports:

`src/hexagons/workflow/index.ts` — add:
```typescript
export { ArtifactFilePort, ArtifactTypeSchema, ARTIFACT_FILENAMES, type ArtifactType } from './domain/ports/artifact-file.port';
export { AutonomyModeProvider } from './domain/ports/autonomy-mode.provider';
export { FileIOError } from './domain/errors/file-io.error';
export { StartDiscussUseCase, type StartDiscussInput, type StartDiscussOutput } from './use-cases/start-discuss.use-case';
export { WriteSpecUseCase } from './use-cases/write-spec.use-case';
export { ClassifyComplexityUseCase } from './use-cases/classify-complexity.use-case';
export { createWriteSpecTool } from './infrastructure/pi/write-spec.tool';
export { createClassifyComplexityTool } from './infrastructure/pi/classify-complexity.tool';
export { createWorkflowTransitionTool } from './infrastructure/pi/workflow-transition.tool';
export { registerDiscussCommand } from './infrastructure/pi/discuss.command';
export { buildDiscussProtocolMessage } from './infrastructure/pi/discuss-protocol';
```

`src/hexagons/slice/index.ts` — verify `ComplexityTierSchema` is already exported (it is, line 16). No changes needed.

**Step 5:** Run `npx vitest run` — expect all tests PASS (full suite).

**Commit:** `feat(S05/T14): wire WorkflowExtensionDeps and update barrel exports`

---

## Acceptance Criteria Traceability

| AC | Task(s) |
|---|---|
| AC1: tff:discuss command | T13 |
| AC2: StartDiscussUseCase | T06 |
| AC3: WriteSpecUseCase | T07 |
| AC4: ClassifyComplexityUseCase | T08 |
| AC5: tff_workflow_transition guards | T09 |
| AC6: Result<T, E> everywhere | T06, T07, T08 |
| AC7: Adapter contract tests | T04, T05 |
| AC8: DISCUSS_PROTOCOL_MESSAGE | T12 |
| AC9: StartDiscuss error cases | T06 |
| AC10: WriteSpec error cases | T07 |
| AC11: ClassifyComplexity error cases | T08 |
| AC12: Autonomy mode in protocol | T12 |
| AC13: Tool + command registration | T09, T10, T11, T14 |
| AC14: WorkflowExtensionDeps + CLI wiring | T02, T14 |
| AC15: Slice setSpecPath + setComplexity | T03 |
| AC16: ArtifactFilePort type mapping | T01 |
