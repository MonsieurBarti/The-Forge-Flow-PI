import type { Result } from "@kernel";

export abstract class PhaseTransitionPort {
  abstract transition(sliceId: string, from: string, to: string): Promise<Result<void, Error>>;
}
