import type {
  PreDispatchContext,
  PreDispatchViolation,
} from "../../../../domain/pre-dispatch.schemas";
import type { PreDispatchGuardrailRule } from "../../../../domain/pre-dispatch-guardrail-rule";

/**
 * Minimal contract for the git operations this rule needs.
 * Avoids coupling to the full GitPort abstract class.
 */
export interface WorktreeStateGitOps {
  statusAt(
    cwd: string,
  ): Promise<
    { ok: true; value: { branch: string; clean: boolean } } | { ok: false; error: unknown }
  >;
}

export class WorktreeStateRule implements PreDispatchGuardrailRule {
  readonly id = "worktree-state";

  constructor(private readonly git: WorktreeStateGitOps) {}

  async evaluate(context: PreDispatchContext): Promise<PreDispatchViolation[]> {
    if (!context.worktreePath) return [];

    const result = await this.git.statusAt(context.worktreePath);

    if (!result.ok) {
      return [
        {
          ruleId: this.id,
          severity: "blocker",
          message: `Failed to read worktree status at "${context.worktreePath}"`,
        },
      ];
    }

    const violations: PreDispatchViolation[] = [];
    const { branch, clean } = result.value;

    if (branch !== context.expectedBranch) {
      violations.push({
        ruleId: this.id,
        severity: "blocker",
        message: `Wrong branch: expected "${context.expectedBranch}", got "${branch}"`,
      });
    }

    if (!clean) {
      violations.push({
        ruleId: this.id,
        severity: "blocker",
        message: "Worktree has uncommitted changes",
      });
    }

    return violations;
  }
}
