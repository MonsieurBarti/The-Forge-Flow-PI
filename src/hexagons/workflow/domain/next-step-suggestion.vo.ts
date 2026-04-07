import { ComplexityTierSchema, ValueObject } from "@kernel";
import { z } from "zod";
import { WorkflowPhaseSchema } from "./workflow-session.schemas";

export const NextStepContextSchema = z.object({
  phase: WorkflowPhaseSchema,
  autonomyMode: z.enum(["guided", "plan-to-pr"]),
  tier: ComplexityTierSchema.optional(),
  sliceLabel: z.string().optional(),
  previousPhase: WorkflowPhaseSchema.optional(),
  allSlicesClosed: z.boolean().default(false),
});
export type NextStepContext = z.infer<typeof NextStepContextSchema>;

export const NextStepSuggestionPropsSchema = z.object({
  command: z.string(),
  args: z.string().optional(),
  displayText: z.string(),
  autoInvoke: z.boolean(),
});
export type NextStepSuggestionProps = z.infer<typeof NextStepSuggestionPropsSchema>;

type SuggestionFactory = (ctx: NextStepContext) => NextStepSuggestionProps | null;

function cmd(command: string, label: string | undefined, auto: boolean): NextStepSuggestionProps {
  return {
    command,
    args: label,
    displayText: `Next: ${command}${label ? ` ${label}` : ""}`,
    autoInvoke: auto,
  };
}

function gate(text: string): NextStepSuggestionProps {
  return { command: "", displayText: text, autoInvoke: false };
}

const PHASE_SUGGESTIONS: Record<string, SuggestionFactory> = {
  idle: (ctx) =>
    ctx.allSlicesClosed
      ? cmd("/tff:complete-milestone", undefined, false)
      : cmd("/tff:discuss", undefined, false),

  discussing: (ctx) => {
    const target = ctx.tier === "S" ? "/tff:plan" : "/tff:research";
    const auto = ctx.autonomyMode === "plan-to-pr";
    return cmd(target, ctx.sliceLabel, auto);
  },

  researching: (ctx) => cmd("/tff:plan", ctx.sliceLabel, ctx.autonomyMode === "plan-to-pr"),

  planning: () => gate("Awaiting plan approval"),

  executing: (ctx) => cmd("/tff:verify", ctx.sliceLabel, ctx.autonomyMode === "plan-to-pr"),

  // verifying → /tff:ship (which handles the reviewing and shipping phases — no separate /tff:review command exists)
  verifying: (ctx) => cmd("/tff:ship", ctx.sliceLabel, ctx.autonomyMode === "plan-to-pr"),

  reviewing: () => gate("Awaiting review approval"),

  shipping: () => gate("Awaiting ship approval"),

  "completing-milestone": () => null,

  paused: (ctx) => ({
    command: "/tff:resume",
    args: ctx.sliceLabel,
    displayText: `Resume: /tff:resume ${ctx.sliceLabel ?? ""} (was: ${ctx.previousPhase ?? "unknown"})`,
    autoInvoke: false,
  }),

  blocked: () => ({
    command: "",
    displayText: "Blocked -- resolve escalation",
    autoInvoke: false,
  }),
};

export class NextStepSuggestion extends ValueObject<NextStepSuggestionProps> {
  private constructor(props: NextStepSuggestionProps) {
    super(props, NextStepSuggestionPropsSchema);
  }

  static build(ctx: NextStepContext): NextStepSuggestion | null {
    const parsed = NextStepContextSchema.parse(ctx);
    const factory = PHASE_SUGGESTIONS[parsed.phase];
    if (!factory) return null;
    const result = factory(parsed);
    if (!result) return null;
    return new NextStepSuggestion(result);
  }

  get command(): string {
    return this.props.command;
  }

  get args(): string | undefined {
    return this.props.args;
  }

  get displayText(): string {
    return this.props.displayText;
  }

  get autoInvoke(): boolean {
    return this.props.autoInvoke;
  }

  get toProps(): NextStepSuggestionProps {
    return { ...this.props };
  }
}
