import type { ComplexityTier } from "@hexagons/slice";
import type { ExtensionAPI } from "@infrastructure/pi";
import { isErr } from "@kernel";
import type { QuickStartUseCase } from "../../use-cases/quick-start.use-case";

export interface QuickCommandDeps {
  quickStart: QuickStartUseCase;
  tffDir: string;
  withGuard?: () => Promise<void>;
}

interface ParsedQuickArgs {
  title: string;
  complexity: ComplexityTier;
}

function parseQuickArgs(args: string): ParsedQuickArgs {
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

function buildQuickProtocolMessage(output: {
  sliceLabel: string;
  currentPhase: string;
  autonomyMode: string;
  complexity: ComplexityTier;
  sliceId: string;
}): string {
  const autoApproved =
    output.currentPhase === "executing"
      ? "Auto-approved for execution."
      : "Waiting for plan approval.";
  return [
    `Quick slice ${output.sliceLabel} created (${output.complexity})`,
    `Phase: ${output.currentPhase}`,
    `Autonomy: ${output.autonomyMode}`,
    "",
    `You are now working on quick slice ${output.sliceLabel}.`,
    `Skip to planning phase. ${autoApproved}`,
  ].join("\n");
}

export function registerQuickCommand(api: ExtensionAPI, deps: QuickCommandDeps): void {
  api.registerCommand("tff:quick", {
    description: "Quick-start an ad-hoc slice (skip discuss + research)",
    handler: async (args: string, ctx) => {
      if (ctx?.newSession) await ctx.newSession();
      await deps.withGuard?.();

      const { title, complexity } = parseQuickArgs(args);
      if (!title) {
        api.sendUserMessage("Usage: /tff:quick <title> [--complexity S|F-lite|F-full]");
        return;
      }

      const result = await deps.quickStart.execute({
        title,
        description: title,
        complexity,
        tffDir: deps.tffDir,
      });

      if (isErr(result)) {
        api.sendUserMessage(`Error: ${result.error.message}`);
        return;
      }

      api.sendUserMessage(buildQuickProtocolMessage(result.data));
    },
  });
}
