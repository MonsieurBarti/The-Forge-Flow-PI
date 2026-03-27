import type { SliceStatus } from "@hexagons/slice";
import type { Result } from "@kernel";
import type { SliceTransitionError } from "../errors/slice-transition.error";

export abstract class SliceTransitionPort {
  abstract transition(
    sliceId: string,
    targetStatus: SliceStatus,
  ): Promise<Result<void, SliceTransitionError>>;
}
