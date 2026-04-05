import { ok, type Result } from "@kernel";
import type { ReviewUIError } from "../../../domain/errors/review-ui.error";
import { ReviewUIPort } from "../../../domain/ports/review-ui.port";
import type {
  ApprovalUIContext,
  ApprovalUIResponse,
  FindingsUIContext,
  FindingsUIResponse,
  VerificationUIContext,
  VerificationUIResponse,
} from "../../../domain/schemas/review-ui.schemas";

interface PresentationRecord {
  method: "presentFindings" | "presentVerification" | "presentForApproval";
  context: FindingsUIContext | VerificationUIContext | ApprovalUIContext;
}

interface InMemoryOptions {
  findingsResponses?: FindingsUIResponse[];
  verificationResponses?: VerificationUIResponse[];
  approvalResponses?: ApprovalUIResponse[];
}

export class InMemoryReviewUIAdapter extends ReviewUIPort {
  readonly presentations: PresentationRecord[] = [];
  private findingsQueue: FindingsUIResponse[];
  private verificationQueue: VerificationUIResponse[];
  private approvalQueue: ApprovalUIResponse[];

  constructor(options?: InMemoryOptions) {
    super();
    this.findingsQueue = [...(options?.findingsResponses ?? [])];
    this.verificationQueue = [...(options?.verificationResponses ?? [])];
    this.approvalQueue = [...(options?.approvalResponses ?? [])];
  }

  async presentFindings(
    ctx: FindingsUIContext,
  ): Promise<Result<FindingsUIResponse, ReviewUIError>> {
    this.presentations.push({ method: "presentFindings", context: ctx });
    const response = this.findingsQueue.shift() ?? {
      acknowledged: true,
      formattedOutput: "[in-memory] findings presented",
    };
    return ok(response);
  }

  async presentVerification(
    ctx: VerificationUIContext,
  ): Promise<Result<VerificationUIResponse, ReviewUIError>> {
    this.presentations.push({ method: "presentVerification", context: ctx });
    const response = this.verificationQueue.shift() ?? {
      accepted: true,
      formattedOutput: "[in-memory] verification presented",
    };
    return ok(response);
  }

  async presentForApproval(
    ctx: ApprovalUIContext,
  ): Promise<Result<ApprovalUIResponse, ReviewUIError>> {
    this.presentations.push({ method: "presentForApproval", context: ctx });
    const response = this.approvalQueue.shift() ?? {
      decision: "approved",
      formattedOutput: "[in-memory] approval presented",
    };
    return ok(response);
  }
}
