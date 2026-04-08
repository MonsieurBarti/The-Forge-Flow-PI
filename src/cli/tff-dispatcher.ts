import type { ExtensionAPI, ExtensionCommandContext } from "@infrastructure/pi";
import type { AutocompleteItem } from "@mariozechner/pi-tui";

export type SubcommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;

export interface SubcommandEntry {
  name: string;
  description: string;
  handler: SubcommandHandler;
  getArgumentCompletions?: (
    prefix: string,
  ) => AutocompleteItem[] | null | Promise<AutocompleteItem[] | null>;
}

export class TffDispatcher {
  private subcommands = new Map<string, SubcommandEntry>();

  register(entry: SubcommandEntry): void {
    this.subcommands.set(entry.name, entry);
  }

  getSubcommands(): SubcommandEntry[] {
    return [...this.subcommands.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  getArgumentCompletions(
    prefix: string,
  ): AutocompleteItem[] | null | Promise<AutocompleteItem[] | null> {
    const spaceIdx = prefix.indexOf(" ");
    if (spaceIdx === -1) {
      // Completing subcommand name
      const matches = this.getSubcommands()
        .filter((s) => s.name.startsWith(prefix))
        .map((s) => ({ value: s.name, label: s.name, description: s.description }));
      return matches.length > 0 ? matches : null;
    }
    // Delegate to subcommand's own argument completer
    const subcmd = prefix.slice(0, spaceIdx);
    const subArgs = prefix.slice(spaceIdx + 1);
    const entry = this.subcommands.get(subcmd);
    return entry?.getArgumentCompletions?.(subArgs) ?? null;
  }

  async handle(args: string, ctx: ExtensionCommandContext, api: ExtensionAPI): Promise<void> {
    const spaceIdx = args.indexOf(" ");
    const subcmd = spaceIdx === -1 ? args.trim() : args.slice(0, spaceIdx).trim();
    const subArgs = spaceIdx === -1 ? "" : args.slice(spaceIdx + 1);

    if (!subcmd) {
      const helpEntry = this.subcommands.get("help");
      if (helpEntry) return helpEntry.handler(subArgs, ctx);
      api.sendUserMessage("Usage: /tff <command> [args]");
      return;
    }

    const entry = this.subcommands.get(subcmd);
    if (!entry) {
      const available = this.getSubcommands()
        .map((s) => s.name)
        .join(", ");
      api.sendUserMessage(`Unknown command: ${subcmd}\nAvailable: ${available}`);
      return;
    }
    return entry.handler(subArgs, ctx);
  }

  mount(api: ExtensionAPI): void {
    api.registerCommand("tff", {
      description: "The Forge Flow — workflow engine for structured development",
      getArgumentCompletions: (prefix) => this.getArgumentCompletions(prefix),
      handler: (args, ctx) => this.handle(args, ctx, api),
    });
  }
}
