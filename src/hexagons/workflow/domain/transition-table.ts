import type {
  GuardContext,
  GuardName,
  TransitionRule,
  WorkflowPhase,
  WorkflowTrigger,
} from "./workflow-session.schemas";

export const ACTIVE_PHASES: ReadonlySet<WorkflowPhase> = new Set([
  "discussing",
  "researching",
  "planning",
  "executing",
  "verifying",
  "reviewing",
  "shipping",
]);

export const TRANSITION_TABLE: readonly TransitionRule[] = [
  { from: "idle", trigger: "start", to: "discussing", effects: [] },
  { from: "discussing", trigger: "next", to: "researching", guard: "notSTier", effects: [] },
  { from: "discussing", trigger: "next", to: "planning", guard: "isSTier", effects: [] },
  { from: "discussing", trigger: "skip", to: "planning", effects: [] },
  { from: "researching", trigger: "next", to: "planning", effects: [] },
  { from: "planning", trigger: "approve", to: "executing", effects: ["resetRetryCount"] },
  { from: "planning", trigger: "reject", to: "planning", effects: ["incrementRetry"] },
  { from: "executing", trigger: "next", to: "verifying", effects: [] },
  { from: "verifying", trigger: "approve", to: "reviewing", effects: ["resetRetryCount"] },
  { from: "verifying", trigger: "reject", to: "executing", effects: ["incrementRetry"] },
  { from: "reviewing", trigger: "approve", to: "shipping", effects: ["resetRetryCount"] },
  { from: "reviewing", trigger: "reject", to: "executing", effects: ["incrementRetry"] },
  { from: "shipping", trigger: "next", to: "idle", effects: ["clearSlice", "resetRetryCount"] },
  {
    from: "idle",
    trigger: "next",
    to: "completing-milestone",
    guard: "allSlicesClosed",
    effects: [],
  },
  { from: "completing-milestone", trigger: "next", to: "idle", effects: [] },
  { from: "*active*", trigger: "fail", to: "blocked", guard: "retriesExhausted", effects: [] },
  { from: "*active*", trigger: "pause", to: "paused", effects: ["savePreviousPhase"] },
  { from: "paused", trigger: "resume", to: "*previousPhase*", effects: ["restorePreviousPhase"] },
  { from: "blocked", trigger: "abort", to: "idle", effects: ["clearSlice", "resetRetryCount"] },
];

const GUARD_EVALUATORS: Record<GuardName, (ctx: GuardContext) => boolean> = {
  notSTier: (ctx) => ctx.complexityTier !== "S",
  isSTier: (ctx) => ctx.complexityTier === "S",
  allSlicesClosed: (ctx) => ctx.allSlicesClosed === true,
  retriesExhausted: (ctx) => ctx.retryCount >= ctx.maxRetries,
};

export function evaluateGuard(guard: GuardName, ctx: GuardContext): boolean {
  return GUARD_EVALUATORS[guard](ctx);
}

export function findMatchingRules(
  currentPhase: WorkflowPhase,
  trigger: WorkflowTrigger,
): TransitionRule[] {
  return TRANSITION_TABLE.filter((rule) => {
    if (rule.trigger !== trigger) return false;
    if (rule.from === currentPhase) return true;
    if (rule.from === "*active*" && ACTIVE_PHASES.has(currentPhase)) return true;
    return false;
  });
}
