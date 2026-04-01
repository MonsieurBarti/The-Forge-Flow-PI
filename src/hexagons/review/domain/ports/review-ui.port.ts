import type { Result } from "@kernel";
import type { ReviewUIError } from "../errors/review-ui.error";
import type {
  ApprovalUIContext,
  ApprovalUIResponse,
  FindingsUIContext,
  FindingsUIResponse,
  VerificationUIContext,
  VerificationUIResponse,
} from "../review-ui.schemas";

export abstract class ReviewUIPort {
  abstract presentFindings(
    context: FindingsUIContext,
  ): Promise<Result<FindingsUIResponse, ReviewUIError>>;

  abstract presentVerification(
    context: VerificationUIContext,
  ): Promise<Result<VerificationUIResponse, ReviewUIError>>;

  abstract presentForApproval(
    context: ApprovalUIContext,
  ): Promise<Result<ApprovalUIResponse, ReviewUIError>>;
}
