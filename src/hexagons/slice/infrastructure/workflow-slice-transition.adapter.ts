import { SliceTransitionError } from "@hexagons/workflow/domain/errors/slice-transition.error";
import { SliceTransitionPort } from "@hexagons/workflow/domain/ports/slice-transition.port";
import type { DateProviderPort } from "@kernel";
import { err, isErr, ok, type Result } from "@kernel";
import type { SliceRepositoryPort } from "../domain/ports/slice-repository.port";
import type { SliceStatus } from "../domain/slice.schemas";

export class WorkflowSliceTransitionAdapter extends SliceTransitionPort {
  constructor(
    private readonly sliceRepo: SliceRepositoryPort,
    private readonly dateProvider: DateProviderPort,
  ) {
    super();
  }

  async transition(
    sliceId: string,
    targetStatus: SliceStatus,
  ): Promise<Result<void, SliceTransitionError>> {
    const findResult = await this.sliceRepo.findById(sliceId);
    if (isErr(findResult)) {
      return err(new SliceTransitionError(sliceId, findResult.error.message));
    }

    const slice = findResult.data;
    if (!slice) {
      return err(new SliceTransitionError(sliceId, `Slice '${sliceId}' not found`));
    }

    if (slice.status === targetStatus) {
      return ok(undefined);
    }

    const transitionResult = slice.transitionTo(targetStatus, this.dateProvider.now());
    if (!transitionResult.ok) {
      return err(new SliceTransitionError(sliceId, transitionResult.error.message));
    }

    const saveResult = await this.sliceRepo.save(slice);
    if (isErr(saveResult)) {
      return err(new SliceTransitionError(sliceId, saveResult.error.message));
    }

    return ok(undefined);
  }
}
