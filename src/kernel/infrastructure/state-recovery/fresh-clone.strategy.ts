import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SyncError } from "@kernel/errors";
import type { RecoveryStrategy } from "@kernel/ports/recovery-strategy";
import type { StateBranchOpsPort } from "@kernel/ports/state-branch-ops.port";
import type { Result } from "@kernel/result";
import { ok } from "@kernel/result";
import type { RecoveryReport, RecoveryScenario } from "@kernel/schemas/recovery.schemas";
import type { BackupService } from "@kernel/services/backup-service";
import type { HealthCheckService } from "@kernel/services/health-check.service";
import type { RestoreStateUseCase } from "@kernel/services/restore-state.use-case";

const SLICE_PATTERN = /^slice\/(M\d+)-S\d+$/;
const MILESTONE_PATTERN = /^milestone\/(M\d+)$/;

function resolveParentStateBranch(currentBranch: string): string | null {
  const sliceMatch = SLICE_PATTERN.exec(currentBranch);
  if (sliceMatch) return `tff-state/milestone/${sliceMatch[1]}`;

  const milestoneMatch = MILESTONE_PATTERN.exec(currentBranch);
  if (milestoneMatch) return "tff-state/main";

  return null;
}

export class FreshCloneStrategy implements RecoveryStrategy {
  readonly handles = "fresh-clone" as const;

  constructor(
    private readonly backupService: BackupService,
    private readonly stateBranchOps: StateBranchOpsPort,
    private readonly restoreUseCase: RestoreStateUseCase,
    private readonly healthCheckService: HealthCheckService,
    readonly _projectRoot: string,
  ) {}

  async execute(
    scenario: RecoveryScenario,
    tffDir: string,
  ): Promise<Result<RecoveryReport, SyncError>> {
    // Step 1: Backup files present → restore newest
    if (scenario.backupPaths.length > 0) {
      const sorted = [...scenario.backupPaths].sort().reverse();
      const newestBackup = sorted[0];
      this.backupService.restoreFromBackup(newestBackup, tffDir);
      await this.healthCheckService.runAll(tffDir);
      return ok({
        type: "fresh-clone",
        action: "restored",
        source: newestBackup,
        filesRestored: 0,
        warnings: [],
      });
    }

    const currentBranch = scenario.currentBranch ?? "main";

    // Step 2: Own state branch exists → restore from it
    const ownStateBranch = `tff-state/${currentBranch}`;
    if (scenario.stateBranchExists) {
      const restoreResult = await this.restoreUseCase.execute(currentBranch);
      const filesRestored = restoreResult.ok ? restoreResult.data.filesRestored : 0;
      await this.healthCheckService.runAll(tffDir);
      return ok({
        type: "fresh-clone",
        action: "restored",
        source: ownStateBranch,
        filesRestored,
        warnings: [],
      });
    }

    // Step 3: Discover parent via naming convention
    const parentStateBranch = resolveParentStateBranch(currentBranch);
    if (parentStateBranch !== null) {
      const existsResult = await this.stateBranchOps.branchExists(parentStateBranch);
      if (existsResult.ok && existsResult.data) {
        // Derive the code branch name from the state branch for restoreUseCase
        const parentCodeBranch = parentStateBranch.replace(/^tff-state\//, "");
        const restoreResult = await this.restoreUseCase.execute(parentCodeBranch);
        const filesRestored = restoreResult.ok ? restoreResult.data.filesRestored : 0;
        await this.healthCheckService.runAll(tffDir);
        return ok({
          type: "fresh-clone",
          action: "restored",
          source: parentStateBranch,
          filesRestored,
          warnings: [],
        });
      }
    }

    // Step 4: Scaffold fresh .tff/
    return this.scaffold(tffDir, currentBranch);
  }

  private async scaffold(
    tffDir: string,
    currentBranch: string,
  ): Promise<Result<RecoveryReport, SyncError>> {
    mkdirSync(tffDir, { recursive: true });

    writeFileSync(join(tffDir, "PROJECT.md"), "# Project\n\nFresh TFF workspace.\n", "utf-8");

    writeFileSync(
      join(tffDir, "settings.yaml"),
      `${[
        "# TFF Project Settings",
        "model-profiles:",
        "  quality:",
        "    model: opus",
        "  balanced:",
        "    model: sonnet",
        "  budget:",
        "    model: sonnet",
        "autonomy:",
        "  mode: plan-to-pr",
        "  max-retries: 2",
      ].join("\n")}\n`,
      "utf-8",
    );

    const branchMeta = {
      version: 1,
      stateId: crypto.randomUUID(),
      codeBranch: currentBranch,
      stateBranch: `tff-state/${currentBranch}`,
      parentStateBranch: null,
      lastSyncedAt: null,
      lastJournalOffset: 0,
      dirty: false,
      lastSyncedHash: null,
    };

    writeFileSync(join(tffDir, "branch-meta.json"), JSON.stringify(branchMeta, null, 2), "utf-8");

    await this.healthCheckService.runAll(tffDir);

    const files = readdirSync(tffDir);
    return ok({
      type: "fresh-clone",
      action: "created-fresh",
      source: tffDir,
      filesRestored: files.length,
      warnings: [],
    });
  }
}
