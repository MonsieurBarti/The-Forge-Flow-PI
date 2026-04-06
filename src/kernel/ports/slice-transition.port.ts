import type { SliceTransitionError } from "../errors/slice-transition.error";
import type { Result } from "../result";

export abstract class SliceTransitionPort {
  abstract transition(
    sliceId: string,
    targetStatus: string,
  ): Promise<Result<void, SliceTransitionError>>;
}
