import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SyncError } from "@kernel/errors";
import type { GitPort } from "@kernel/ports/git.port";
import type { RecoveryStrategy } from "@kernel/ports/recovery-strategy";
import type { StateBranchOpsPort } from "@kernel/ports/state-branch-ops.port";
import { StateRecoveryPort } from "@kernel/ports/state-recovery.port";
import { ok, type Result } from "@kernel/result";
import { type BranchMeta, BranchMetaSchema } from "@kernel/schemas/branch-meta.schemas";
import type {
  RecoveryReport,
  RecoveryScenario,
  RecoveryType,
} from "@kernel/schemas/recovery.schemas";
import type { RenameDetectionResult } from "@kernel/schemas/rename-detection.schemas";

export class StateRecoveryAdapter extends StateRecoveryPort {
  constructor(
    private readonly strategies: Map<RecoveryType, RecoveryStrategy>,
    private readonly gitPort: GitPort,
    private readonly stateBranchOps: StateBranchOpsPort,
    private readonly projectRoot: string,
  ) {
    super();
  }

  async detect(tffDir: string): Promise<Result<RecoveryScenario, SyncError>> {
    // Priority 0: get current branch; detached HEAD → healthy
    const branchResult = await this.gitPort.currentBranch();
    const currentBranch = branchResult.ok ? branchResult.data : null;

    if (currentBranch === null) {
      return ok(this.buildScenario("healthy", null, null, [], false, null));
    }

    // Priority 1: .tff/ directory missing → fresh-clone
    if (!existsSync(tffDir)) {
      return ok(this.buildScenario("fresh-clone", currentBranch, null, [], false, null));
    }

    // Scan for backup dirs in projectRoot
    const backupPaths = this.findBackupPaths();

    // Priority 2–3: branch-meta.json missing
    const metaPath = join(tffDir, "branch-meta.json");
    if (!existsSync(metaPath)) {
      // Priority 2: backups exist → crash
      if (backupPaths.length > 0) {
        return ok(this.buildScenario("crash", currentBranch, null, backupPaths, false, null));
      }
      // Priority 3: no backups + .tff/ exists → fresh-clone
      return ok(this.buildScenario("fresh-clone", currentBranch, null, [], false, null));
    }

    // branch-meta.json exists — parse it
    const branchMeta = BranchMetaSchema.parse(JSON.parse(readFileSync(metaPath, "utf-8")));

    // Priority 4: codeBranch matches currentBranch → healthy
    if (branchMeta.codeBranch === currentBranch) {
      const stateBranchExists = await this.checkStateBranchExists(currentBranch);
      return ok(
        this.buildScenario(
          "healthy",
          currentBranch,
          branchMeta,
          backupPaths,
          stateBranchExists,
          branchMeta.parentStateBranch,
        ),
      );
    }

    // Priority 5: codeBranch !== currentBranch → disambiguate
    const detection = await this.disambiguate(branchMeta, currentBranch);
    const stateBranchExists = await this.checkStateBranchExists(currentBranch);

    switch (detection.kind) {
      case "rename":
        return ok(
          this.buildScenario(
            "rename",
            currentBranch,
            branchMeta,
            backupPaths,
            stateBranchExists,
            branchMeta.parentStateBranch,
          ),
        );
      case "switch":
        return ok(
          this.buildScenario(
            "mismatch",
            currentBranch,
            branchMeta,
            backupPaths,
            stateBranchExists,
            branchMeta.parentStateBranch,
          ),
        );
      case "untracked":
        return ok(
          this.buildScenario(
            "untracked",
            currentBranch,
            branchMeta,
            backupPaths,
            stateBranchExists,
            branchMeta.parentStateBranch,
          ),
        );
      case "match":
        return ok(
          this.buildScenario(
            "healthy",
            currentBranch,
            branchMeta,
            backupPaths,
            stateBranchExists,
            branchMeta.parentStateBranch,
          ),
        );
    }
  }

  async recover(
    scenario: RecoveryScenario,
    tffDir: string,
  ): Promise<Result<RecoveryReport, SyncError>> {
    // healthy and untracked are no-ops
    if (scenario.type === "healthy" || scenario.type === "untracked") {
      return ok({
        type: scenario.type,
        action: "skipped",
        source: "none",
        filesRestored: 0,
        warnings: [],
      });
    }

    const strategy = this.strategies.get(scenario.type);
    if (!strategy) {
      return ok({
        type: scenario.type,
        action: "none",
        source: "none",
        filesRestored: 0,
        warnings: [`No strategy registered for recovery type: ${scenario.type}`],
      });
    }

    const result = await strategy.execute(scenario, tffDir);

    // Chain: if crash recovery degrades to fresh-clone signal, invoke fresh-clone strategy
    if (result.ok && result.data.action === "created-fresh" && scenario.type !== "fresh-clone") {
      const freshClone = this.strategies.get("fresh-clone");
      if (freshClone) {
        return freshClone.execute(scenario, tffDir);
      }
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildScenario(
    type: RecoveryType,
    currentBranch: string | null,
    branchMeta: BranchMeta | null,
    backupPaths: string[],
    stateBranchExists: boolean,
    parentStateBranch: string | null,
  ): RecoveryScenario {
    return {
      type,
      currentBranch,
      branchMeta,
      backupPaths,
      stateBranchExists,
      parentStateBranch,
    };
  }

  private findBackupPaths(): string[] {
    if (!existsSync(this.projectRoot)) return [];
    try {
      return readdirSync(this.projectRoot)
        .filter((entry) => entry.startsWith(".tff.backup."))
        .map((entry) => join(this.projectRoot, entry));
    } catch {
      return [];
    }
  }

  private async checkStateBranchExists(currentBranch: string): Promise<boolean> {
    const stateBranch = `tff-state/${currentBranch}`;
    const result = await this.stateBranchOps.branchExists(stateBranch);
    return result.ok && result.data;
  }

  private async disambiguate(
    meta: BranchMeta,
    currentBranch: string,
  ): Promise<RenameDetectionResult> {
    const oldExistsResult = await this.gitPort.branchExists(meta.codeBranch);
    const stateForCurrentResult = await this.stateBranchOps.branchExists(
      `tff-state/${currentBranch}`,
    );
    const stateForCurrentExists = stateForCurrentResult.ok && stateForCurrentResult.data;

    if (oldExistsResult.ok && oldExistsResult.data) {
      // Old branch still exists
      return stateForCurrentExists ? { kind: "switch" } : { kind: "untracked" };
    }

    // Old branch gone
    if (!stateForCurrentExists) {
      return { kind: "rename", newBranch: currentBranch };
    }

    // Ambiguous: state exists for current AND old branch is gone — compare stateId
    const remoteMetaResult = await this.stateBranchOps.readFromStateBranch(
      `tff-state/${currentBranch}`,
      "branch-meta.json",
    );
    if (remoteMetaResult.ok && remoteMetaResult.data) {
      try {
        const remoteMeta = BranchMetaSchema.parse(JSON.parse(remoteMetaResult.data));
        if (remoteMeta.stateId === meta.stateId) {
          return { kind: "rename", newBranch: currentBranch };
        }
      } catch {
        // Parse failure → treat as switch (safe fallback)
      }
    }

    // stateId mismatch or unreadable → switch
    return { kind: "switch" };
  }
}
