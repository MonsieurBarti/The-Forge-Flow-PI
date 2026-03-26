import { z } from "zod";
import { ModelProfileNameSchema } from "@kernel/schemas";

// ---------------------------------------------------------------------------
// Primitive schemas
// ---------------------------------------------------------------------------

export const ModelNameSchema = z.enum(["opus", "sonnet", "haiku"]);
export type ModelName = z.infer<typeof ModelNameSchema>;

export { ModelProfileNameSchema };
export type ModelProfileName = z.infer<typeof ModelProfileNameSchema>;

export const AutonomyModeSchema = z.enum(["guided", "plan-to-pr"]);
export type AutonomyMode = z.infer<typeof AutonomyModeSchema>;

// ---------------------------------------------------------------------------
// Sub-schemas (base — without .catch(), used for type extraction)
// ---------------------------------------------------------------------------

export const ModelProfileSchema = z.object({
  model: ModelNameSchema.default("sonnet"),
  fallbackChain: z.array(ModelNameSchema).default([]),
});
export type ModelProfile = z.infer<typeof ModelProfileSchema>;

export const BudgetConfigSchema = z.object({
  limit: z.number().optional(),
  thresholds: z.tuple([z.number(), z.number()]).default([50, 75]),
});
export type BudgetConfig = z.infer<typeof BudgetConfigSchema>;

const BaseModelRoutingConfigSchema = z.object({
  profiles: z
    .object({
      quality: ModelProfileSchema.default({ model: "opus", fallbackChain: [] }),
      balanced: ModelProfileSchema.default({ model: "sonnet", fallbackChain: [] }),
      budget: ModelProfileSchema.default({ model: "sonnet", fallbackChain: [] }),
    })
    .default({
      quality: { model: "opus", fallbackChain: [] },
      balanced: { model: "sonnet", fallbackChain: [] },
      budget: { model: "sonnet", fallbackChain: [] },
    }),
  complexityMapping: z
    .object({
      S: ModelProfileNameSchema.default("budget"),
      "F-lite": ModelProfileNameSchema.default("balanced"),
      "F-full": ModelProfileNameSchema.default("quality"),
    })
    .default({ S: "budget", "F-lite": "balanced", "F-full": "quality" }),
  phaseOverrides: z.record(z.string(), ModelProfileNameSchema).optional(),
  budget: BudgetConfigSchema.optional(),
});
export type ModelRoutingConfig = z.infer<typeof BaseModelRoutingConfigSchema>;

const BaseAutonomyConfigSchema = z.object({
  mode: AutonomyModeSchema.default("guided"),
  maxRetries: z.number().int().min(0).default(2),
});
export type AutonomyConfig = z.infer<typeof BaseAutonomyConfigSchema>;

const BaseAutoLearnConfigSchema = z.object({
  weights: z
    .object({
      frequency: z.number().default(0.25),
      breadth: z.number().default(0.3),
      recency: z.number().default(0.25),
      consistency: z.number().default(0.2),
    })
    .default({ frequency: 0.25, breadth: 0.3, recency: 0.25, consistency: 0.2 }),
  guardrails: z
    .object({
      minCorrections: z.number().int().default(3),
      cooldownDays: z.number().int().default(7),
      maxDriftPct: z.number().default(20),
    })
    .default({ minCorrections: 3, cooldownDays: 7, maxDriftPct: 20 }),
  clustering: z
    .object({
      minSessions: z.number().int().default(3),
      minPatterns: z.number().int().default(2),
      jaccardThreshold: z.number().default(0.3),
    })
    .default({ minSessions: 3, minPatterns: 2, jaccardThreshold: 0.3 }),
});
export type AutoLearnConfig = z.infer<typeof BaseAutoLearnConfigSchema>;

const BaseBeadsConfigSchema = z.object({
  timeout: z.number().int().positive().default(30000),
});
export type BeadsConfig = z.infer<typeof BaseBeadsConfigSchema>;

// ---------------------------------------------------------------------------
// Fully-hydrated defaults (required by Zod 4 — parent .default() is literal)
// ---------------------------------------------------------------------------

export const MODEL_ROUTING_DEFAULTS: ModelRoutingConfig = {
  profiles: {
    quality: { model: "opus", fallbackChain: [] },
    balanced: { model: "sonnet", fallbackChain: [] },
    budget: { model: "sonnet", fallbackChain: [] },
  },
  complexityMapping: {
    S: "budget",
    "F-lite": "balanced",
    "F-full": "quality",
  },
};

export const AUTONOMY_DEFAULTS: AutonomyConfig = {
  mode: "guided",
  maxRetries: 2,
};

export const AUTO_LEARN_DEFAULTS: AutoLearnConfig = {
  weights: { frequency: 0.25, breadth: 0.3, recency: 0.25, consistency: 0.2 },
  guardrails: { minCorrections: 3, cooldownDays: 7, maxDriftPct: 20 },
  clustering: { minSessions: 3, minPatterns: 2, jaccardThreshold: 0.3 },
};

export const BEADS_DEFAULTS: BeadsConfig = {
  timeout: 30000,
};

// ---------------------------------------------------------------------------
// Exported schemas with .catch() for resilience
// ---------------------------------------------------------------------------

export const ModelRoutingConfigSchema = BaseModelRoutingConfigSchema.catch(MODEL_ROUTING_DEFAULTS);
export const AutonomyConfigSchema = BaseAutonomyConfigSchema.catch(AUTONOMY_DEFAULTS);
export const AutoLearnConfigSchema = BaseAutoLearnConfigSchema.catch(AUTO_LEARN_DEFAULTS);
export const BeadsConfigSchema = BaseBeadsConfigSchema.catch(BEADS_DEFAULTS);

// ---------------------------------------------------------------------------
// Top-level SettingsSchema
// ---------------------------------------------------------------------------

export const SETTINGS_DEFAULTS = {
  modelRouting: MODEL_ROUTING_DEFAULTS,
  autonomy: AUTONOMY_DEFAULTS,
  autoLearn: AUTO_LEARN_DEFAULTS,
  beads: BEADS_DEFAULTS,
};

export const SettingsSchema = z
  .object({
    modelRouting: ModelRoutingConfigSchema.default(MODEL_ROUTING_DEFAULTS),
    autonomy: AutonomyConfigSchema.default(AUTONOMY_DEFAULTS),
    autoLearn: AutoLearnConfigSchema.default(AUTO_LEARN_DEFAULTS),
    beads: BeadsConfigSchema.default(BEADS_DEFAULTS),
  })
  .default(SETTINGS_DEFAULTS);
export type SettingsProps = z.infer<typeof SettingsSchema>;

// ---------------------------------------------------------------------------
// Environment variable mapping
// ---------------------------------------------------------------------------

export const ENV_VAR_MAP: Record<string, string[]> = {
  TFF_MODEL_QUALITY: ["modelRouting", "profiles", "quality", "model"],
  TFF_MODEL_BALANCED: ["modelRouting", "profiles", "balanced", "model"],
  TFF_MODEL_BUDGET: ["modelRouting", "profiles", "budget", "model"],
  TFF_AUTONOMY_MODE: ["autonomy", "mode"],
  TFF_AUTONOMY_MAX_RETRIES: ["autonomy", "maxRetries"],
  TFF_BEADS_TIMEOUT: ["beads", "timeout"],
};

// ---------------------------------------------------------------------------
// Raw settings sources type
// ---------------------------------------------------------------------------

export type RawSettingsSources = {
  team: Record<string, unknown> | null;
  local: Record<string, unknown> | null;
  env: Record<string, unknown>;
};
