import type { Result } from "@kernel";
import type { CyclicDependencyError } from "../errors/cyclic-dependency.error";
import type { TaskDependencyInput, Wave } from "../wave.schemas";

export abstract class WaveDetectionPort {
  abstract detectWaves(
    tasks: readonly TaskDependencyInput[],
  ): Result<Wave[], CyclicDependencyError>;
}
