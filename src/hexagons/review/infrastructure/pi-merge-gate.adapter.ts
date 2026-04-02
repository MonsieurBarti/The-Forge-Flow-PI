import { type MergeGateContext, MergeGatePort } from "../domain/ports/merge-gate.port";
import type { MergeGateDecision } from "../domain/ship.schemas";

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing and composition)
// ---------------------------------------------------------------------------

export interface MergeGateOption {
  label: string;
  value: MergeGateDecision;
  description: string;
}

export function buildMergeGateOptions(): MergeGateOption[] {
  return [
    {
      label: "Merged",
      value: "merged",
      description: "The PR was successfully merged into the target branch.",
    },
    {
      label: "Needs changes",
      value: "needs_changes",
      description: "The PR requires further fixes before it can be merged.",
    },
    {
      label: "Abort",
      value: "abort",
      description: "Stop the ship pipeline without merging.",
    },
  ];
}

export function buildMergeGateQuestionText(context: MergeGateContext): string {
  const lines: string[] = [
    `Merge gate check for "${context.subjectLabel ?? context.subjectId}"`,
    `PR #${context.prNumber}: ${context.prUrl}`,
    `Fix cycle: ${context.cycle}`,
  ];

  if (context.lastError !== undefined && context.lastError.length > 0) {
    lines.push(`Last error: ${context.lastError}`);
  }

  lines.push("", "What is the current merge status?");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class PiMergeGateAdapter extends MergeGatePort {
  async askMergeStatus(context: MergeGateContext): Promise<MergeGateDecision> {
    // The PI SDK's AskUserQuestion mechanism is invoked by the host (Claude Code).
    // This adapter formats the question using the pure helpers above.
    // Full PI SDK integration is deferred until the AskUserQuestion transport is available.
    const _text = buildMergeGateQuestionText(context);
    const _options = buildMergeGateOptions();

    throw new Error(
      "PiMergeGateAdapter.askMergeStatus: PI SDK AskUserQuestion not available in this context",
    );
  }
}
