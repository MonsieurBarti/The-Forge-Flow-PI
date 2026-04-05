import type { Result } from "@kernel/result";
import type { Id } from "@kernel/schemas";

export interface OverlayProjectSnapshot {
  project: unknown | null; // Generic — kernel doesn't import domain types
  milestone: unknown | null;
  slices: unknown[];
  taskCounts: Map<string, { done: number; total: number }>;
}

export interface OverlaySliceSnapshot {
  slice: unknown; // Generic — adapters provide concrete types
  tasks: unknown[];
}

export abstract class OverlayDataPort {
  abstract getProjectSnapshot(): Promise<Result<OverlayProjectSnapshot, Error>>;
  abstract getSliceSnapshot(sliceId: Id): Promise<Result<OverlaySliceSnapshot, Error>>;
}
