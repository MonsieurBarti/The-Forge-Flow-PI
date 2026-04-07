import type { ExtensionAPI, ExtensionCommandContext } from "@infrastructure/pi";
import type { TffDispatcher } from "../../../../cli/tff-dispatcher";
import type { AddSliceUseCase } from "../../application/add-slice.use-case";

export interface AddSliceCommandDeps {
  addSlice: AddSliceUseCase;
  activeMilestoneId: () => Promise<string | null>;
}

export function registerAddSliceCommand(
  dispatcher: TffDispatcher,
  api: ExtensionAPI,
  deps: AddSliceCommandDeps,
): void {
  dispatcher.register({
    name: "add-slice",
    description: "Add a new slice to the active milestone",
    handler: async (args: string, _ctx: ExtensionCommandContext) => {
      const milestoneId = await deps.activeMilestoneId();
      if (!milestoneId) {
        api.sendUserMessage("No active milestone found.");
        return;
      }

      const afterMatch = args.match(/--after\s+(\S+)/);
      const afterLabel = afterMatch?.[1];
      const title = args
        .replace(/--after\s+\S+/, "")
        .replace(/--description\s+"[^"]*"/, "")
        .trim();

      if (!title) {
        api.sendUserMessage("Usage: /tff add-slice <title> [--after <label>]");
        return;
      }

      const descMatch = args.match(/--description\s+"([^"]*)"/);
      const description = descMatch?.[1];

      const result = await deps.addSlice.execute({
        milestoneId,
        title,
        description,
        afterLabel,
      });

      if (!result.ok) {
        api.sendUserMessage(`Failed to add slice: ${result.error.message}`);
        return;
      }

      api.sendUserMessage(
        `Added slice **${result.data.sliceLabel}**: "${title}" at position ${result.data.position}`,
      );
    },
  });
}
