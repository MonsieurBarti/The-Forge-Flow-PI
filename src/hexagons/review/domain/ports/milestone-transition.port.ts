import type { Result } from "@kernel";
import type { MilestoneTransitionError } from "../errors/milestone-transition.error";

export abstract class MilestoneTransitionPort {
  abstract close(milestoneId: string): Promise<Result<void, MilestoneTransitionError>>;
}
