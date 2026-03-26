# M02-S02: Wave Detection — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Implement wave detection using Kahn's algorithm to determine parallel execution order for tasks with dependency graphs.
**Architecture:** Pure domain logic in task hexagon — no infrastructure dependencies. `DetectWavesUseCase extends WaveDetectionPort`.
**Tech Stack:** TypeScript, Zod, Vitest

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| CREATE | `src/hexagons/task/domain/wave.schemas.ts` | `TaskDependencyInputSchema`, `WaveSchema` + types |
| CREATE | `src/hexagons/task/domain/wave.schemas.spec.ts` | Schema validation tests |
| CREATE | `src/hexagons/task/domain/ports/wave-detection.port.ts` | `WaveDetectionPort` abstract class |
| CREATE | `src/hexagons/task/domain/detect-waves.use-case.ts` | `DetectWavesUseCase` — Kahn's + DFS |
| CREATE | `src/hexagons/task/domain/detect-waves.use-case.spec.ts` | Algorithm tests (AC1-AC7) |
| MODIFY | `src/hexagons/task/domain/errors/cyclic-dependency.error.ts` | Add typed `cyclePath` getter |
| MODIFY | `src/hexagons/task/index.ts` | Barrel exports for wave types + port |

---

## Wave 0 (parallel)

### T01: Wave schemas + validation tests

**Files:**
- Create `src/hexagons/task/domain/wave.schemas.ts`
- Create `src/hexagons/task/domain/wave.schemas.spec.ts`

**Traces to:** AC9

**Steps:**

- [x] Step 1: Write `wave.schemas.spec.ts` with failing tests:

```typescript
// src/hexagons/task/domain/wave.schemas.spec.ts
import { describe, expect, it } from "vitest";
import { TaskDependencyInputSchema, WaveSchema } from "./wave.schemas";

describe("TaskDependencyInputSchema", () => {
  it("accepts valid input with blockedBy", () => {
    const result = TaskDependencyInputSchema.safeParse({
      id: crypto.randomUUID(),
      blockedBy: [crypto.randomUUID()],
    });
    expect(result.success).toBe(true);
  });

  it("defaults blockedBy to empty array when omitted", () => {
    const result = TaskDependencyInputSchema.safeParse({
      id: crypto.randomUUID(),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.blockedBy).toEqual([]);
    }
  });

  it("rejects malformed id", () => {
    const result = TaskDependencyInputSchema.safeParse({
      id: "not-a-uuid",
      blockedBy: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("WaveSchema", () => {
  it("accepts valid wave", () => {
    const result = WaveSchema.safeParse({
      index: 0,
      taskIds: [crypto.randomUUID()],
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative index", () => {
    const result = WaveSchema.safeParse({
      index: -1,
      taskIds: [crypto.randomUUID()],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty taskIds", () => {
    const result = WaveSchema.safeParse({
      index: 0,
      taskIds: [],
    });
    expect(result.success).toBe(false);
  });
});
```

- [x] Step 2: Run `npx vitest run src/hexagons/task/domain/wave.schemas.spec.ts`, verify FAIL

- [x] Step 3: Write `wave.schemas.ts`:

```typescript
// src/hexagons/task/domain/wave.schemas.ts
import { IdSchema } from "@kernel";
import { z } from "zod";

export const TaskDependencyInputSchema = z.object({
  id: IdSchema,
  blockedBy: z.array(IdSchema).default([]),
});
export type TaskDependencyInput = z.infer<typeof TaskDependencyInputSchema>;

export const WaveSchema = z.object({
  index: z.number().int().min(0),
  taskIds: z.array(IdSchema).min(1),
});
export type Wave = z.infer<typeof WaveSchema>;
```

- [x] Step 4: Run `npx vitest run src/hexagons/task/domain/wave.schemas.spec.ts`, verify PASS (6/6)
- [x] Step 5: `git add src/hexagons/task/domain/wave.schemas.ts src/hexagons/task/domain/wave.schemas.spec.ts && git commit -m "feat(S02/T01): add Wave and TaskDependencyInput schemas with tests"`

---

### T02: WaveDetectionPort + CyclicDependencyError getter

**Files:**
- Create `src/hexagons/task/domain/ports/wave-detection.port.ts`
- Modify `src/hexagons/task/domain/errors/cyclic-dependency.error.ts`

**Traces to:** AC5 (getter), AC8

**Steps:**

- [x] Step 1: Create `wave-detection.port.ts`:

```typescript
// src/hexagons/task/domain/ports/wave-detection.port.ts
import type { Result } from "@kernel";
import type { CyclicDependencyError } from "../errors/cyclic-dependency.error";
import type { TaskDependencyInput, Wave } from "../wave.schemas";

export abstract class WaveDetectionPort {
  abstract detectWaves(
    tasks: readonly TaskDependencyInput[]
  ): Result<Wave[], CyclicDependencyError>;
}
```

- [x] Step 2: Modify `cyclic-dependency.error.ts` — add typed getter:

```typescript
// src/hexagons/task/domain/errors/cyclic-dependency.error.ts
import { BaseDomainError } from "@kernel";

export class CyclicDependencyError extends BaseDomainError {
  readonly code = "TASK.CYCLIC_DEPENDENCY";

  constructor(cyclePath: readonly string[]) {
    super(`Cyclic dependency detected: ${cyclePath.join(" -> ")}`, {
      cyclePath,
    });
  }

  get cyclePath(): readonly string[] {
    return (this.metadata as { cyclePath: readonly string[] }).cyclePath;
  }
}
```

- [x] Step 3: Run `npx vitest run src/hexagons/task/` to verify existing tests still pass
- [x] Step 4: `git add src/hexagons/task/domain/ports/wave-detection.port.ts src/hexagons/task/domain/errors/cyclic-dependency.error.ts && git commit -m "feat(S02/T02): add WaveDetectionPort and typed cyclePath getter"`

---

## Wave 1 (depends on Wave 0)

### T03: DetectWavesUseCase — write failing tests

**Files:**
- Create `src/hexagons/task/domain/detect-waves.use-case.spec.ts`

**Traces to:** AC1, AC2, AC3, AC4, AC5, AC6, AC7
**Depends on:** T01, T02

**Steps:**

- [x] Step 1: Write `detect-waves.use-case.spec.ts`:

```typescript
// src/hexagons/task/domain/detect-waves.use-case.spec.ts
import { isErr, isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { CyclicDependencyError } from "./errors/cyclic-dependency.error";
import { DetectWavesUseCase } from "./detect-waves.use-case";
import type { TaskDependencyInput } from "./wave.schemas";

function makeInput(id: string, blockedBy: string[] = []): TaskDependencyInput {
  return { id, blockedBy };
}

describe("DetectWavesUseCase", () => {
  const useCase = new DetectWavesUseCase();

  describe("AC1: empty input", () => {
    it("returns ok([])", () => {
      const result = useCase.detectWaves([]);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toEqual([]);
      }
    });
  });

  describe("AC2: all independent tasks", () => {
    it("lands all in wave 0 with sorted taskIds", () => {
      const result = useCase.detectWaves([
        makeInput("ccc"),
        makeInput("aaa"),
        makeInput("bbb"),
      ]);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].index).toBe(0);
        expect(result.data[0].taskIds).toEqual(["aaa", "bbb", "ccc"]);
      }
    });
  });

  describe("AC3: sequential dependencies", () => {
    it("produces contiguous ordered waves (A->B->C = 3 waves)", () => {
      const result = useCase.detectWaves([
        makeInput("C", ["B"]),
        makeInput("B", ["A"]),
        makeInput("A"),
      ]);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toEqual([
          { index: 0, taskIds: ["A"] },
          { index: 1, taskIds: ["B"] },
          { index: 2, taskIds: ["C"] },
        ]);
      }
    });
  });

  describe("AC4: diamond dependencies", () => {
    it("parallel tasks share a wave", () => {
      // A has no deps, B and C depend on A, D depends on B and C
      const result = useCase.detectWaves([
        makeInput("D", ["B", "C"]),
        makeInput("B", ["A"]),
        makeInput("C", ["A"]),
        makeInput("A"),
      ]);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toEqual([
          { index: 0, taskIds: ["A"] },
          { index: 1, taskIds: ["B", "C"] },
          { index: 2, taskIds: ["D"] },
        ]);
      }
    });
  });

  describe("AC5: cyclic dependency", () => {
    it("returns err with CyclicDependencyError containing cycle path", () => {
      const result = useCase.detectWaves([
        makeInput("A", ["C"]),
        makeInput("B", ["A"]),
        makeInput("C", ["B"]),
      ]);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toBeInstanceOf(CyclicDependencyError);
        expect(result.error.cyclePath.length).toBeGreaterThanOrEqual(2);
      }
    });

    it("detects self-referential cycle", () => {
      const result = useCase.detectWaves([makeInput("A", ["A"])]);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toBeInstanceOf(CyclicDependencyError);
      }
    });
  });

  describe("AC6: determinism", () => {
    it("same input in different order produces identical output", () => {
      const input1: TaskDependencyInput[] = [
        makeInput("C", ["A"]),
        makeInput("B", ["A"]),
        makeInput("A"),
      ];
      const input2: TaskDependencyInput[] = [
        makeInput("A"),
        makeInput("B", ["A"]),
        makeInput("C", ["A"]),
      ];

      const result1 = useCase.detectWaves(input1);
      const result2 = useCase.detectWaves(input2);

      expect(isOk(result1)).toBe(true);
      expect(isOk(result2)).toBe(true);
      if (isOk(result1) && isOk(result2)) {
        expect(result1.data).toEqual(result2.data);
      }
    });
  });

  describe("AC7: unknown IDs in blockedBy", () => {
    it("ignores unknown dependency IDs", () => {
      const result = useCase.detectWaves([
        makeInput("A", ["nonexistent"]),
        makeInput("B"),
      ]);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toEqual([
          { index: 0, taskIds: ["A", "B"] },
        ]);
      }
    });
  });
});
```

- [x] Step 2: Run `npx vitest run src/hexagons/task/domain/detect-waves.use-case.spec.ts`, verify FAIL (cannot find module)

---

### T04: DetectWavesUseCase — implement

**Files:**
- Create `src/hexagons/task/domain/detect-waves.use-case.ts`

**Traces to:** AC1, AC2, AC3, AC4, AC5, AC6, AC7
**Depends on:** T03

**Steps:**

- [x] Step 1: Write `detect-waves.use-case.ts`:

```typescript
// src/hexagons/task/domain/detect-waves.use-case.ts
import { type Result, err, ok } from "@kernel";
import { CyclicDependencyError } from "./errors/cyclic-dependency.error";
import { WaveDetectionPort } from "./ports/wave-detection.port";
import type { TaskDependencyInput, Wave } from "./wave.schemas";

export class DetectWavesUseCase extends WaveDetectionPort {
  detectWaves(
    tasks: readonly TaskDependencyInput[],
  ): Result<Wave[], CyclicDependencyError> {
    if (tasks.length === 0) {
      return ok([]);
    }

    const taskIds = new Set(tasks.map((t) => t.id));

    // Build adjacency: dependee -> dependents
    // and compute in-degree per node
    const dependents = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    for (const id of taskIds) {
      dependents.set(id, []);
      inDegree.set(id, 0);
    }

    // blockedBy adjacency (only known IDs)
    const blockedByFiltered = new Map<string, string[]>();
    for (const task of tasks) {
      const known = task.blockedBy.filter((dep) => taskIds.has(dep));
      blockedByFiltered.set(task.id, known);
      inDegree.set(task.id, known.length);
      for (const dep of known) {
        dependents.get(dep)!.push(task.id);
      }
    }

    // Kahn's algorithm — each BFS round = one wave
    const waves: Wave[] = [];
    let queue = [...taskIds].filter((id) => inDegree.get(id) === 0).sort();
    let processed = 0;

    while (queue.length > 0) {
      waves.push({ index: waves.length, taskIds: [...queue].sort() });
      processed += queue.length;

      const nextQueue: string[] = [];
      for (const id of queue) {
        for (const dependent of dependents.get(id)!) {
          const newDegree = inDegree.get(dependent)! - 1;
          inDegree.set(dependent, newDegree);
          if (newDegree === 0) {
            nextQueue.push(dependent);
          }
        }
      }
      queue = nextQueue.sort();
    }

    if (processed < taskIds.size) {
      const remaining = new Set(
        [...taskIds].filter((id) => inDegree.get(id)! > 0),
      );
      const cyclePath = this.findCyclePath(remaining, blockedByFiltered);
      return err(new CyclicDependencyError(cyclePath));
    }

    return ok(waves);
  }

  private findCyclePath(
    remaining: Set<string>,
    blockedBy: Map<string, string[]>,
  ): string[] {
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const parent = new Map<string, string>();

    for (const startNode of [...remaining].sort()) {
      if (visited.has(startNode)) continue;

      const stack: string[] = [startNode];
      while (stack.length > 0) {
        const node = stack[stack.length - 1];

        if (!visited.has(node)) {
          visited.add(node);
          inStack.add(node);
        }

        const deps = (blockedBy.get(node) ?? []).filter(
          (d) => remaining.has(d),
        );
        let pushed = false;

        for (const dep of deps.sort()) {
          if (!visited.has(dep)) {
            parent.set(dep, node);
            stack.push(dep);
            pushed = true;
            break;
          }
          if (inStack.has(dep)) {
            // Found cycle — reconstruct path
            const path: string[] = [dep, node];
            let current = node;
            while (current !== dep) {
              current = parent.get(current)!;
              path.push(current);
            }
            path.reverse();
            return path;
          }
        }

        if (!pushed) {
          stack.pop();
          inStack.delete(node);
        }
      }
    }

    return [...remaining].sort();
  }
}
```

- [x] Step 2: Run `npx vitest run src/hexagons/task/domain/detect-waves.use-case.spec.ts`, verify PASS (all tests)
- [x] Step 3: `git add src/hexagons/task/domain/detect-waves.use-case.ts src/hexagons/task/domain/detect-waves.use-case.spec.ts && git commit -m "feat(S02/T04): implement DetectWavesUseCase with Kahn's algorithm"`

---

## Wave 2 (depends on Wave 1)

### T05: Barrel exports + encapsulation test

**Files:**
- Modify `src/hexagons/task/index.ts`

**Traces to:** AC8, AC10
**Depends on:** T04

**Steps:**

- [x] Step 1: Update barrel `src/hexagons/task/index.ts` — add wave exports:

```typescript
// Append to existing exports:
export type { TaskDependencyInput, Wave } from "./domain/wave.schemas";
export { TaskDependencyInputSchema, WaveSchema } from "./domain/wave.schemas";
export { WaveDetectionPort } from "./domain/ports/wave-detection.port";
```

- [x] Step 2: Verify `DetectWavesUseCase` is NOT exported (AC10) — confirm it does not appear in `index.ts`
- [x] Step 3: Run `npx vitest run src/hexagons/task/`, verify ALL tests pass (existing + new)
- [x] Step 4: Run `npx biome check src/hexagons/task/domain/wave.schemas.ts src/hexagons/task/domain/wave.schemas.spec.ts src/hexagons/task/domain/detect-waves.use-case.ts src/hexagons/task/domain/detect-waves.use-case.spec.ts src/hexagons/task/domain/ports/wave-detection.port.ts`, verify PASS (AC12)
- [x] Step 5: `git add src/hexagons/task/index.ts && git commit -m "feat(S02/T05): add wave detection barrel exports"`

---

## Summary

| Wave | Tasks | Description |
|------|-------|-------------|
| 0 | T01, T02 | Schemas, port, error getter (parallel) |
| 1 | T03, T04 | Tests then implementation (sequential) |
| 2 | T05 | Barrel exports + final verification |

**Total:** 5 tasks, 3 waves, traces to all 12 ACs
