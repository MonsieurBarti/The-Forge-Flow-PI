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
 * Each rule returns the subcommand name and args to invoke, or null if not applicable.
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

export function registerAutoCommand(
  dispatcher: TffDispatcher,
  api: ExtensionAPI,
  deps: AutoModeDeps,
): void {
  dispatcher.register({
    name: "auto",
    description: "Run the workflow automatically — fresh session per phase, stops for user input",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      // 1. Find active milestone
      const projectResult = await deps.projectRepo.findSingleton();
      if (isErr(projectResult) || !projectResult.data) {
        api.sendUserMessage("No TFF project found. Run /tff new to initialize.");
        return;
      }
      const msResult = await deps.milestoneRepo.findByProjectId(projectResult.data.id);
      if (isErr(msResult)) {
        api.sendUserMessage("Failed to load milestones.");
        return;
      }
      const active = msResult.data.find((m) => m.status === "in_progress");
      if (!active) {
        api.sendUserMessage("No active milestone. Run /tff new-milestone to create one.");
        return;
      }

      // 2. Get next step suggestion
      const nextResult = await deps.suggestNextStep.execute({ milestoneId: active.id });
      if (isErr(nextResult)) {
        api.sendUserMessage(`Failed to determine next step: ${nextResult.error.message}`);
        return;
      }

      // 3. Load workflow session for phase info
      const sessionResult = await deps.sessionRepo.findByMilestoneId(active.id);
      const phase =
        sessionResult.ok && sessionResult.data ? sessionResult.data.currentPhase : "idle";

      // 4. Determine slice label
      let sliceLabel: string | undefined;
      if (sessionResult.ok && sessionResult.data?.sliceId) {
        const sliceResult = await deps.sliceRepo.findById(sessionResult.data.sliceId);
        if (isOk(sliceResult) && sliceResult.data) {
          sliceLabel = sliceResult.data.label;
        }
      }

      // 5. Check if all slices are closed
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

      // 6. Resolve dispatch
      const action = resolveDispatch({ phase, sliceLabel, allSlicesClosed });
      if (!action) {
        const suggestion = nextResult.data?.displayText ?? "No next step available";
        api.sendUserMessage(
          `Auto-mode cannot determine next action.\nPhase: ${phase}\n${suggestion}\n\nRun the suggested command manually.`,
        );
        return;
      }

      // 7. Create fresh session and dispatch
      if (ctx?.newSession) await ctx.newSession();

      const entry = dispatcher.getSubcommands().find((s) => s.name === action.subcommand);
      if (!entry) {
        api.sendUserMessage(`Internal error: subcommand "${action.subcommand}" not found.`);
        return;
      }

      api.sendUserMessage(
        `**Auto-mode:** dispatching \`/tff ${action.subcommand}${action.args ? ` ${action.args}` : ""}\``,
      );
      await entry.handler(action.args, ctx);
    },
  });
}
