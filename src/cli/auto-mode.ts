import type { MilestoneRepositoryPort } from "@hexagons/milestone";
import type { ProjectRepositoryPort } from "@hexagons/project";
import type { SliceRepositoryPort } from "@hexagons/slice";
import type { WorkflowSessionRepositoryPort } from "@hexagons/workflow/domain/ports/workflow-session.repository.port";
import type { SuggestNextStepUseCase } from "@hexagons/workflow/use-cases/suggest-next-step.use-case";
import type { ExtensionAPI, ExtensionCommandContext } from "@infrastructure/pi";
import { isErr, isOk } from "@kernel";
import type { TffDispatcher } from "./tff-dispatcher";

/**
 * Dispatch rules map workflow phases to TFF subcommands.
 */
interface DispatchAction {
  subcommand: string;
  args: string;
}

interface DispatchRule {
  name: string;
  match: (ctx: DispatchContext) => DispatchAction | null;
}

interface DispatchContext {
  phase: string;
  sliceLabel?: string;
  allSlicesClosed: boolean;
}

const DISPATCH_RULES: DispatchRule[] = [
  {
    name: "idle+slicesOpen -> discuss",
    match: (ctx) =>
      ctx.phase === "idle" && !ctx.allSlicesClosed && ctx.sliceLabel
        ? { subcommand: "discuss", args: ctx.sliceLabel }
        : null,
  },
  {
    name: "discussing -> research",
    match: (ctx) =>
      ctx.phase === "discussing" && ctx.sliceLabel
        ? { subcommand: "research", args: ctx.sliceLabel }
        : null,
  },
  {
    name: "researching -> plan",
    match: (ctx) =>
      ctx.phase === "researching" && ctx.sliceLabel
        ? { subcommand: "plan", args: ctx.sliceLabel }
        : null,
  },
  {
    name: "executing -> verify",
    match: (ctx) =>
      ctx.phase === "executing" && ctx.sliceLabel
        ? { subcommand: "verify", args: ctx.sliceLabel }
        : null,
  },
  {
    name: "verifying -> ship",
    match: (ctx) =>
      ctx.phase === "verifying" && ctx.sliceLabel
        ? { subcommand: "ship", args: ctx.sliceLabel }
        : null,
  },
  {
    name: "allClosed -> complete-milestone",
    match: (ctx) =>
      ctx.phase === "idle" && ctx.allSlicesClosed
        ? { subcommand: "complete-milestone", args: "" }
        : null,
  },
];

function resolveDispatch(ctx: DispatchContext): DispatchAction | null {
  for (const rule of DISPATCH_RULES) {
    const action = rule.match(ctx);
    if (action) return action;
  }
  return null;
}

export interface AutoModeDeps {
  projectRepo: ProjectRepositoryPort;
  milestoneRepo: MilestoneRepositoryPort;
  sliceRepo: SliceRepositoryPort;
  sessionRepo: WorkflowSessionRepositoryPort;
  suggestNextStep: SuggestNextStepUseCase;
}

/** Shared auto-mode state — survives across agent_end cycles */
let autoModeActive = false;
let autoDispatchCount = 0;
const MAX_AUTO_DISPATCHES = 50;

async function resolveNextAction(deps: AutoModeDeps): Promise<DispatchAction | string> {
  const projectResult = await deps.projectRepo.findSingleton();
  if (isErr(projectResult) || !projectResult.data) {
    return "No TFF project found. Run /tff new to initialize.";
  }
  const msResult = await deps.milestoneRepo.findByProjectId(projectResult.data.id);
  if (isErr(msResult)) return "Failed to load milestones.";

  const active = msResult.data.find((m) => m.status === "in_progress");
  if (!active) return "No active milestone. Run /tff new-milestone to create one.";

  // Load workflow session for phase info
  const sessionResult = await deps.sessionRepo.findByMilestoneId(active.id);
  const phase = sessionResult.ok && sessionResult.data ? sessionResult.data.currentPhase : "idle";

  // Determine slice label
  let sliceLabel: string | undefined;
  if (sessionResult.ok && sessionResult.data?.sliceId) {
    const sliceResult = await deps.sliceRepo.findById(sessionResult.data.sliceId);
    if (isOk(sliceResult) && sliceResult.data) {
      sliceLabel = sliceResult.data.label;
    }
  }

  // Check if all slices are closed
  const allSlicesResult = await deps.sliceRepo.findByMilestoneId(active.id);
  const allSlicesClosed =
    isOk(allSlicesResult) &&
    allSlicesResult.data.length > 0 &&
    allSlicesResult.data.every((s) => s.status === "closed");

  // If no slice label from session, find first non-closed slice
  if (!sliceLabel && isOk(allSlicesResult)) {
    const nextSlice = allSlicesResult.data.find((s) => s.status !== "closed");
    if (nextSlice) sliceLabel = nextSlice.label;
  }

  const action = resolveDispatch({ phase, sliceLabel, allSlicesClosed });
  if (!action) {
    const nextResult = await deps.suggestNextStep.execute({ milestoneId: active.id });
    const suggestion =
      isOk(nextResult) && nextResult.data ? nextResult.data.displayText : "No next step available";
    return `Auto-mode paused — waiting for user input.\nPhase: ${phase}\n${suggestion}`;
  }
  return action;
}

export function registerAutoMode(
  dispatcher: TffDispatcher,
  api: ExtensionAPI,
  deps: AutoModeDeps,
): void {
  // Register agent_end handler to continue the loop
  api.on("agent_end", async (_event, _ctx) => {
    if (!autoModeActive) return;

    // Budget guard
    if (autoDispatchCount >= MAX_AUTO_DISPATCHES) {
      autoModeActive = false;
      api.sendUserMessage(
        `Auto-mode stopped: reached ${MAX_AUTO_DISPATCHES} dispatch limit. Run /tff auto to restart.`,
        { deliverAs: "followUp" },
      );
      return;
    }

    const result = await resolveNextAction(deps);
    if (typeof result === "string") {
      // Paused — but stay active so we resume after user input
      // Use followUp to avoid "Agent is already processing" error
      api.sendUserMessage(result, { deliverAs: "followUp" });
      return;
    }

    // Dispatch via followUp to safely queue after current turn completes
    autoDispatchCount++;
    api.sendUserMessage(
      `**Auto-mode [${autoDispatchCount}]:** running /tff ${result.subcommand}${result.args ? ` ${result.args}` : ""}`,
      { deliverAs: "followUp" },
    );
  });

  // Register the /tff auto command
  dispatcher.register({
    name: "auto",
    description: "Run the workflow automatically — fresh session per phase, loops until done",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (autoModeActive) {
        autoModeActive = false;
        autoDispatchCount = 0;
        api.sendUserMessage("Auto-mode stopped.");
        return;
      }

      // Start auto-mode
      autoModeActive = true;
      autoDispatchCount = 0;

      const result = await resolveNextAction(deps);
      if (typeof result === "string") {
        api.sendUserMessage(result);
        // Stay active — will resume on next agent_end after user provides input
        return;
      }

      // First dispatch — use handler directly since we have ExtensionCommandContext
      autoDispatchCount++;
      if (ctx?.newSession) await ctx.newSession();

      const entry = dispatcher.getSubcommands().find((s) => s.name === result.subcommand);
      if (!entry) {
        api.sendUserMessage(`Auto-mode error: subcommand "${result.subcommand}" not found.`);
        autoModeActive = false;
        return;
      }

      api.sendUserMessage(
        `**Auto-mode [${autoDispatchCount}]:** /tff ${result.subcommand}${result.args ? ` ${result.args}` : ""}`,
      );
      await entry.handler(result.args, ctx);
    },
  });

  // Register /tff stop to explicitly stop auto-mode
  dispatcher.register({
    name: "stop",
    description: "Stop auto-mode",
    handler: async (_args: string, _ctx: ExtensionCommandContext) => {
      autoModeActive = false;
      autoDispatchCount = 0;
      api.sendUserMessage("Auto-mode stopped.");
    },
  });
}
