import type { ExtensionAPI, ExtensionCommandContext } from "@infrastructure/pi";

export function registerHelpCommand(api: ExtensionAPI): void {
  api.registerCommand("tff:help", {
    description: "Show TFF command reference",
    handler: async (_args: string, _ctx: ExtensionCommandContext) => {
      const commands = api.getCommands();
      const tffCommands = commands
        .filter((cmd) => cmd.name.startsWith("tff:"))
        .sort((a, b) => a.name.localeCompare(b.name));

      let md = "# TFF Command Reference\n\n";
      md += "| Command | Description |\n";
      md += "|---|---|\n";

      for (const cmd of tffCommands) {
        md += `| /${cmd.name} | ${cmd.description ?? ""} |\n`;
      }

      api.sendUserMessage(md);
    },
  });
}
