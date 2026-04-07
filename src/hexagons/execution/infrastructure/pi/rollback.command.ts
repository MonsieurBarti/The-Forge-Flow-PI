import type { SliceRepositoryPort } from "@hexagons/slice/domain/ports/slice-repository.port";
import type { ExtensionAPI, ExtensionCommandContext } from "@infrastructure/pi";
import type { TffDispatcher } from "../../../../cli/tff-dispatcher";
import type { RollbackSliceUseCase } from "../../application/rollback-slice.use-case";
import type { CheckpointRepositoryPort } from "../../domain/ports/checkpoint-repository.port";

export interface RollbackCommandDeps {
  rollback: RollbackSliceUseCase;
  checkpointRepo: CheckpointRepositoryPort;
  sliceRepo: SliceRepositoryPort;
}

export function registerRollbackCommand(
  dispatcher: TffDispatcher,
  api: ExtensionAPI,
  deps: RollbackCommandDeps,
): void {
  dispatcher.register({
    name: "rollback",
    description: "Revert execution commits for a slice",
    handler: async (args: string, _ctx: ExtensionCommandContext) => {
      const baseCommitMatch = args.match(/--base-commit\s+(\S+)/);
      const sliceLabel = args.replace(/--base-commit\s+\S+/, "").trim();

      if (!sliceLabel) {
        api.sendUserMessage("Usage: /tff rollback <slice-label> [--base-commit <hash>]");
        return;
      }

      // Find slice
      const sliceResult = await deps.sliceRepo.findByLabel(sliceLabel);
      if (!sliceResult.ok || !sliceResult.data) {
        api.sendUserMessage(`Slice not found: ${sliceLabel}`);
        return;
      }
      const slice = sliceResult.data;

      // Discover baseCommit
      let baseCommit = baseCommitMatch?.[1];
      if (!baseCommit) {
        const cpResult = await deps.checkpointRepo.findBySliceId(slice.id);
        if (cpResult.ok && cpResult.data) {
          baseCommit = cpResult.data.baseCommit;
        } else {
          api.sendUserMessage("No checkpoint found. Provide --base-commit explicitly.");
          return;
        }
      }

      const result = await deps.rollback.execute({ sliceId: slice.id, baseCommit });

      if (!result.ok) {
        api.sendUserMessage(`Rollback failed: ${result.error.message}`);
        return;
      }

      const lines = [
        "## Rollback Complete",
        "",
        `**Slice:** ${sliceLabel}`,
        `**Reverted commits:** ${result.data.revertedCommits.length}`,
        `**Journal entries processed:** ${result.data.journalEntriesProcessed}`,
        `**New status:** planning`,
      ];

      if (result.data.revertedCommits.length > 0) {
        lines.push("", "### Reverted");
        for (const hash of result.data.revertedCommits) {
          lines.push(`- \`${hash.slice(0, 8)}\``);
        }
      }

      api.sendUserMessage(lines.join("\n"));
    },
  });
}
