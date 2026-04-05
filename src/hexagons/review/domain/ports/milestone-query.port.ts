import type { Result } from "@kernel";
import type { MilestoneQueryError } from "../errors/milestone-query.error";

export interface MilestoneSliceStatus {
  sliceId: string;
  sliceLabel: string;
  status: string;
}

export abstract class MilestoneQueryPort {
  abstract getSliceStatuses(
    milestoneId: string,
  ): Promise<Result<MilestoneSliceStatus[], MilestoneQueryError>>;

  abstract getMilestoneStatus(milestoneId: string): Promise<Result<string, MilestoneQueryError>>;

  abstract getRequirementsContent(
    milestoneLabel: string,
  ): Promise<Result<string, MilestoneQueryError>>;
}
