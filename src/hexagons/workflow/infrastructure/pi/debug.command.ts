import type { ComplexityTier } from "@hexagons/slice";
import type { ExtensionAPI } from "@infrastructure/pi";
import { isErr } from "@kernel";
import type { TffDispatcher } from "../../../../cli/tff-dispatcher";
import type { QuickStartUseCase } from "../../use-cases/quick-start.use-case";

export interface DebugCommandDeps {
  quickStart: QuickStartUseCase;
  tffDir: string;
  withGuard?: () => Promise<void>;
}

interface ParsedDebugArgs {
  title: string;
  complexity: ComplexityTier;
}

function parseDebugArgs(args: string): ParsedDebugArgs {
  const complexityFlag = "--complexity";
  const idx = args.indexOf(complexityFlag);

  let title: string;
  let complexity: ComplexityTier = "S";

  if (idx !== -1) {
    title = args.slice(0, idx).trim();
    const rest = args.slice(idx + complexityFlag.length).trim();
    const rawTier = rest.split(/\s+/)[0] ?? "";
    if (rawTier === "S" || rawTier === "F-lite" || rawTier === "F-full") {
      complexity = rawTier;
    }
  } else {
    title = args.trim();
  }

  return { title, complexity };
}

function buildDebugProtocolMessage(
  output: {
    sliceLabel: string;
    currentPhase: string;
    complexity: ComplexityTier;
  },
  bugDescription: string,
): string {
  return [
    `Debug slice ${output.sliceLabel} created (${output.complexity})`,
    `Phase: ${output.currentPhase}`,
    "",
    "## Bug Description",
    bugDescription,
    "",
    "## Debugging Protocol",
    "Follow the systematic-debugging skill (4 phases):",
    "1. **Reproduce** — Confirm the bug with a failing test",
    "2. **Hypothesize** — Form hypotheses about root cause",
    "3. **Test** — Validate hypotheses with targeted investigation",
    "4. **Fix** — Implement minimal fix, verify with tests",
  ].join("\n");
}

export function registerDebugCommand(
  dispatcher: TffDispatcher,
  api: ExtensionAPI,
  deps: DebugCommandDeps,
): void {
  dispatcher.register({
    name: "debug",
    description: "Open a debugging slice with systematic-debugging skill",
    handler: async (args: string, ctx) => {
      await deps.withGuard?.();

      const { title, complexity } = parseDebugArgs(args);
      if (!title) {
        api.sendUserMessage("Usage: /tff debug <bug description> [--complexity S|F-lite|F-full]");
        return;
      }

      const result = await deps.quickStart.execute({
        title: `Debug: ${title}`,
        description: title,
        kind: "debug",
        complexity,
        tffDir: deps.tffDir,
      });

      if (isErr(result)) {
        api.sendUserMessage(`Error: ${result.error.message}`);
        return;
      }

      if (ctx?.newSession) await ctx.newSession();
      api.sendUserMessage(buildDebugProtocolMessage(result.data, title));
    },
  });
}
