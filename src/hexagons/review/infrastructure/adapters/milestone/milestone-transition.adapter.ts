import type { MilestoneRepositoryPort } from "@hexagons/milestone/domain/ports/milestone-repository.port";
import { err, isErr, ok, type Result } from "@kernel";
import type { DateProviderPort } from "@kernel/ports";
import { MilestoneTransitionError } from "../../../domain/errors/milestone-transition.error";
import { MilestoneTransitionPort } from "../../../domain/ports/milestone-transition.port";

export class MilestoneTransitionAdapter extends MilestoneTransitionPort {
  constructor(
    private readonly milestoneRepo: MilestoneRepositoryPort,
    private readonly dateProvider: DateProviderPort,
  ) {
    super();
  }

  async close(milestoneId: string): Promise<Result<void, MilestoneTransitionError>> {
    const findResult = await this.milestoneRepo.findById(milestoneId);
    if (isErr(findResult)) {
      return err(MilestoneTransitionError.notFound(milestoneId));
    }

    const milestone = findResult.data;
    if (milestone === null) {
      return err(MilestoneTransitionError.notFound(milestoneId));
    }

    const closeResult = milestone.close(this.dateProvider.now());
    if (!closeResult.ok) {
      return err(MilestoneTransitionError.invalidTransition(milestoneId, milestone.status));
    }

    const saveResult = await this.milestoneRepo.save(milestone);
    if (isErr(saveResult)) {
      return err(MilestoneTransitionError.notFound(milestoneId));
    }

    return ok(undefined);
  }
}
