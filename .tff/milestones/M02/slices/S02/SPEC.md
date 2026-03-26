# M02-S02: Wave Detection

## Problem

The execution engine needs to determine which tasks can run in parallel and which must wait for dependencies. Given a set of tasks with `blockedBy` relationships, produce an ordered sequence of waves where each wave contains tasks whose dependencies are all satisfied by prior waves.

## Approach

Pure function style: `DetectWavesUseCase.execute()` accepts `TaskDependencyInput[]` (id + blockedBy) and returns `Result<Wave[], CyclicDependencyError>`. No repository dependency — the caller provides the task graph.

Algorithm: Kahn's algorithm for topological sorting, producing waves (each BFS "level" = one wave). If unprocessed nodes remain after Kahn's completes, a DFS extracts one specific cycle path for the error message.

`WaveDetectionPort` abstract class exported via barrel for cross-hexagon consumption by the future Execution hexagon.

## Design

### Directory Structure

```
src/hexagons/task/
  domain/
    wave.schemas.ts              <- NEW
    wave.schemas.spec.ts         <- NEW
    detect-waves.use-case.ts     <- NEW
    detect-waves.use-case.spec.ts <- NEW
    ports/
      task-repository.port.ts       (existing)
      wave-detection.port.ts        <- NEW
  index.ts                       (updated)
```

### Schemas

```typescript
// domain/wave.schemas.ts
import { z } from "zod";
import { IdSchema } from "@kernel";

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

Deterministic: `taskIds` within each wave are always sorted alphabetically.

### DetectWavesUseCase

`DetectWavesUseCase` extends `WaveDetectionPort`, providing the concrete implementation. The port is the public contract exported via barrel; the use case class is internal to the hexagon.

```typescript
// domain/detect-waves.use-case.ts
export class DetectWavesUseCase extends WaveDetectionPort {
  detectWaves(
    tasks: readonly TaskDependencyInput[]
  ): Result<Wave[], CyclicDependencyError> {
    // 1. Build adjacency map: Map<id, dependsOn[]>
    //    - Only include blockedBy IDs that exist in the input set
    //    - Unknown IDs in blockedBy are silently ignored
    // 2. Compute in-degree per node
    // 3. Kahn's algorithm:
    //    - Queue starts with in-degree 0 nodes
    //    - Each "round" of the queue = one wave
    //    - Process all current-queue nodes,
    //      decrement dependents' in-degree
    //    - New zero-in-degree nodes = next wave
    // 4. If unprocessed nodes remain:
    //    - DFS on remaining to find one cycle path
    //    - Return err(CyclicDependencyError(cyclePath))
    // 5. Return ok(waves) with sorted taskIds per wave
  }

  private findCyclePath(
    remaining: Set<string>,
    adj: Map<string, string[]>
  ): string[] {
    // DFS with visited/recursion-stack tracking
    // Returns the first cycle found as an ordered path
  }
}
```

Edge cases:
- Empty input -> `ok([])`
- All independent tasks -> `ok([Wave{ index: 0, taskIds: sorted }])`
- Unknown ID in `blockedBy` -> ignored (treated as already resolved)

### WaveDetectionPort

```typescript
// domain/ports/wave-detection.port.ts
import type { Result } from "@kernel";
import type { CyclicDependencyError } from "../errors/cyclic-dependency.error";
import type { TaskDependencyInput, Wave } from "../wave.schemas";

export abstract class WaveDetectionPort {
  abstract detectWaves(
    tasks: readonly TaskDependencyInput[]
  ): Result<Wave[], CyclicDependencyError>;
}
```

### Barrel Export Updates

```typescript
// index.ts (additions)
export type { TaskDependencyInput, Wave } from "./domain/wave.schemas";
export { TaskDependencyInputSchema, WaveSchema } from "./domain/wave.schemas";
export { WaveDetectionPort } from "./domain/ports/wave-detection.port";
// DetectWavesUseCase NOT exported (internal to hexagon)
```

## Acceptance Criteria

- [x] AC1: Empty input returns `ok([])`
- [x] AC2: All independent tasks land in wave 0 with sorted taskIds
- [x] AC3: Sequential dependencies produce contiguous ordered waves starting at 0 (A->B->C = waves 0, 1, 2)
- [x] AC4: Diamond dependencies produce `[{0, [A]}, {1, [B,C]}, {2, [D]}]` — parallel tasks share a wave
- [x] AC5: Cyclic input returns `err(CyclicDependencyError)` where `cyclePath` is a non-empty array forming a valid cycle in the input graph
- [x] AC6: Deterministic: same input in any order always produces identical wave assignments (sorted taskIds)
- [x] AC7: Unknown IDs in `blockedBy` are ignored (no crash, treated as resolved)
- [x] AC8: `WaveDetectionPort` abstract class exported via barrel
- [x] AC9: Schemas accept valid data and reject invalid data (negative wave index, empty taskIds, malformed id)
- [x] AC10: `DetectWavesUseCase` is not exported from the barrel (encapsulation boundary)
- [x] AC11: All tests pass
- [x] AC12: `biome check` passes on all new files

## Non-Goals

- Execution integration (that's a later slice)
- Persisting wave assignments to tasks (caller's responsibility)
- Cross-slice dependency detection
- Performance optimization for large graphs (not needed at current scale)

## Minor Changes to Existing Code

### CyclicDependencyError — typed `cyclePath` getter

`CyclicDependencyError` currently stores `cyclePath` in `metadata` (typed `Record<string, unknown>`), making type-safe access impossible without `as` casts (which this project forbids). Add a typed getter:

```typescript
// domain/errors/cyclic-dependency.error.ts (modified)
export class CyclicDependencyError extends BaseDomainError {
  readonly code = "TASK.CYCLIC_DEPENDENCY";

  constructor(cyclePath: readonly string[]) {
    super(`Cyclic dependency detected: ${cyclePath.join(" -> ")}`, { cyclePath });
  }

  get cyclePath(): readonly string[] {
    return this.metadata?.cyclePath as readonly string[];
  }
}
```

The `as` cast here is safe because the constructor guarantees the shape. This is an internal implementation detail of the error class, not a consumer-facing cast.

## Dependencies

- kernel/ base classes (Result, IdSchema)
- `CyclicDependencyError` from task hexagon (created in S01, modified in this slice)
