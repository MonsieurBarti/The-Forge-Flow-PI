import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { SyncError } from "@kernel/errors";
import { ok, err, type Result } from "@kernel/result";
import type { StateBranchOpsPort } from "@kernel/ports/state-branch-ops.port";
import type { RecoveryStrategy } from "@kernel/ports/recovery-strategy";
import type { RecoveryScenario, RecoveryReport, RecoveryType } from "@kernel/schemas/recovery.schemas";
import type { BranchMeta } from "@kernel/schemas/branch-meta.schemas";

export class RenameRecoveryStrategy implements RecoveryStrategy {
  readonly handles: RecoveryType = "rename";

  constructor(private readonly stateBranchOps: StateBranchOpsPort) {}

  async execute(
    scenario: RecoveryScenario,
    tffDir: string,
  ): Promise<Result<RecoveryReport, SyncError>> {
    const meta = scenario.branchMeta!;
    const currentBranch = scenario.currentBranch!;

    const oldStateBranch = meta.stateBranch;
    const newStateBranch = `tff-state/${currentBranch}`;

    const renameResult = await this.stateBranchOps.renameBranch(oldStateBranch, newStateBranch);
    if (!renameResult.ok) {
      return err(new SyncError("RENAME_FAILED", `Failed to rename state branch: ${renameResult.error.message}`));
    }

    const updatedMeta: BranchMeta = {
      ...meta,
      codeBranch: currentBranch,
      stateBranch: newStateBranch,
    };
    const metaPath = join(tffDir, "branch-meta.json");
    writeFileSync(metaPath, JSON.stringify(updatedMeta, null, 2), "utf-8");

    const report: RecoveryReport = {
      type: "rename",
      action: "renamed",
      source: oldStateBranch,
      filesRestored: 0,
      warnings: [],
    };

    return ok(report);
  }
}
