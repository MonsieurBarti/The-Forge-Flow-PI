import type { ExtensionAPI, ExtensionCommandContext } from "@infrastructure/pi";
import type { TffDispatcher } from "../../../../cli/tff-dispatcher";

export function registerHelpCommand(dispatcher: TffDispatcher, api: ExtensionAPI): void {
  dispatcher.register({
    name: "help",
    description: "Show TFF command reference",
    handler: async (_args: string, _ctx: ExtensionCommandContext) => {
      const subcommands = dispatcher.getSubcommands();

      let md = "# The Forge Flow (TFF) — Command Reference\n\n";
      md += "| Command | Description |\n";
      md += "|---|---|\n";

      for (const cmd of subcommands) {
        md += `| /tff ${cmd.name} | ${cmd.description} |\n`;
      }

      api.sendUserMessage(md);
    },
  });
}
