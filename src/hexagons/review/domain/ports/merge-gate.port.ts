import type { MergeGateDecision } from "../ship.schemas";

export interface MergeGateContext {
  sliceId: string;
  prUrl: string;
  prNumber: number;
  cycle: number;
  lastError?: string;
}

export abstract class MergeGatePort {
  abstract askMergeStatus(context: MergeGateContext): Promise<MergeGateDecision>;
}
