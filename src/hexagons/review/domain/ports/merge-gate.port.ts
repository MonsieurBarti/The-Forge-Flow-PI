import type { MergeGateDecision } from "../ship.schemas";

export interface MergeGateContext {
  subjectId: string;
  subjectLabel?: string;
  prUrl: string;
  prNumber: number;
  cycle: number;
  lastError?: string;
}

export abstract class MergeGatePort {
  abstract askMergeStatus(context: MergeGateContext): Promise<MergeGateDecision>;
}
