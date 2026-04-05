import { ModelProfileNameSchema } from "@kernel/schemas";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitive schemas
// ---------------------------------------------------------------------------

export const ModelNameSchema = z.string().min(1);
export type ModelName = z.infer<typeof ModelNameSchema>;

export { ModelProfileNameSchema };
export type ModelProfileName = z.infer<typeof ModelProfileNameSchema>;

export const AutonomyModeSchema = z.enum(["guided", "plan-to-pr"]);
export type AutonomyMode = z.infer<typeof AutonomyModeSchema>;

export const FailurePolicyModeSchema = z.enum(["strict", "tolerant", "lenient"]);
export type FailurePolicyMode = z.infer<typeof FailurePolicyModeSchema>;

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

const GuardrailRuleSeveritySchema = z.enum(["error", "warning", "info"]);

const BaseGuardrailsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  rules: z
    .object({
      "dangerous-commands": GuardrailRuleSeveritySchema.default("error"),
      "credential-exposure": GuardrailRuleSeveritySchema.default("error"),
      "destructive-git": GuardrailRuleSeveritySchema.default("error"),
      "file-scope": GuardrailRuleSeveritySchema.default("warning"),
      "suspicious-content": GuardrailRuleSeveritySchema.default("warning"),
    })
    .default({
      "dangerous-commands": "error",
      "credential-exposure": "error",
      "destructive-git": "error",
      "file-scope": "warning",
      "suspicious-content": "warning",
    }),
});
export type GuardrailsConfig = z.infer<typeof BaseGuardrailsConfigSchema>;

const BaseOverseerConfigSchema = z.object({
  enabled: z.boolean().default(true),
  timeouts: z
    .object({
      S: z.number().int().positive().default(300000),
      "F-lite": z.number().int().positive().default(900000),
      "F-full": z.number().int().positive().default(1800000),
    })
    .default({ S: 300000, "F-lite": 900000, "F-full": 1800000 }),
  retryLoop: z
    .object({
      threshold: z.number().int().min(1).default(3),
    })
    .default({ threshold: 3 }),
});
export type OverseerConfig = z.infer<typeof BaseOverseerConfigSchema>;

const BaseHotkeysConfigSchema = z.object({
  dashboard: z.string().default("ctrl+alt+d"),
  workflow: z.string().default("ctrl+alt+w"),
  executionMonitor: z.string().default("ctrl+alt+e"),
});
export type HotkeysConfig = z.infer<typeof BaseHotkeysConfigSchema>;

const BaseFallbackStrategyConfigSchema = z.object({
  retryCount: z.number().int().min(0).max(3).default(1),
  downshiftChain: z.array(z.string()).default(["quality", "balanced", "budget"]),
  checkpointBeforeRetry: z.boolean().default(true),
});
export type FallbackStrategyConfig = z.infer<typeof BaseFallbackStrategyConfigSchema>;

// ---------------------------------------------------------------------------
// G09: Tool Policies
// ---------------------------------------------------------------------------

const ToolPolicyEntrySchema = z.object({
  allowed: z.array(z.string()).optional(),
  blocked: z.array(z.string()).optional(),
});
export type ToolPolicyEntry = z.infer<typeof ToolPolicyEntrySchema>;

const BaseToolPoliciesConfigSchema = z.object({
  defaults: ToolPolicyEntrySchema.default({}),
  byTier: z
    .object({
      S: ToolPolicyEntrySchema.optional(),
      "F-lite": ToolPolicyEntrySchema.optional(),
      "F-full": ToolPolicyEntrySchema.optional(),
    })
    .default({}),
  byRole: z.record(z.string(), ToolPolicyEntrySchema).default({}),
});
export type ToolPoliciesConfig = z.infer<typeof BaseToolPoliciesConfigSchema>;

// ---------------------------------------------------------------------------
// G02: Failure Policies
// ---------------------------------------------------------------------------

const BaseFailurePoliciesConfigSchema = z.object({
  default: FailurePolicyModeSchema.default("strict"),
  byPhase: z.record(z.string(), FailurePolicyModeSchema).default({}),
});
export type FailurePoliciesConfig = z.infer<typeof BaseFailurePoliciesConfigSchema>;

const BaseWorkflowConfigSchema = z.object({
  failurePolicies: BaseFailurePoliciesConfigSchema.default({
    default: "strict",
    byPhase: {},
  }),
});
export type WorkflowConfig = z.infer<typeof BaseWorkflowConfigSchema>;

// ---------------------------------------------------------------------------
// G03: Quality Metrics
// ---------------------------------------------------------------------------

const BaseQualityMetricsConfigSchema = z.object({
  perPhaseTracking: z.boolean().default(true),
});
export type QualityMetricsConfig = z.infer<typeof BaseQualityMetricsConfigSchema>;

// ---------------------------------------------------------------------------
// G04: Stack Config
// ---------------------------------------------------------------------------

export const StackInfoSchema = z.object({
  runtime: z.string().optional(),
  framework: z.string().optional(),
  packageManager: z.string().optional(),
  buildTool: z.string().optional(),
  testRunner: z.string().optional(),
  linter: z.string().optional(),
});
export type StackInfo = z.infer<typeof StackInfoSchema>;

const BaseStackConfigSchema = z.object({
  detected: StackInfoSchema.default({}),
  overrides: StackInfoSchema.default({}),
});
export type StackConfig = z.infer<typeof BaseStackConfigSchema>;

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

export const GUARDRAILS_DEFAULTS: GuardrailsConfig = {
  enabled: true,
  rules: {
    "dangerous-commands": "error",
    "credential-exposure": "error",
    "destructive-git": "error",
    "file-scope": "warning",
    "suspicious-content": "warning",
  },
};

export const OVERSEER_DEFAULTS: OverseerConfig = {
  enabled: true,
  timeouts: { S: 300000, "F-lite": 900000, "F-full": 1800000 },
  retryLoop: { threshold: 3 },
};

export const HOTKEYS_DEFAULTS: HotkeysConfig = {
  dashboard: "ctrl+alt+d",
  workflow: "ctrl+alt+w",
  executionMonitor: "ctrl+alt+e",
};

export const FALLBACK_STRATEGY_DEFAULTS: FallbackStrategyConfig = {
  retryCount: 1,
  downshiftChain: ["quality", "balanced", "budget"],
  checkpointBeforeRetry: true,
};

export const TOOL_POLICIES_DEFAULTS: ToolPoliciesConfig = {
  defaults: {},
  byTier: {},
  byRole: {},
};

export const FAILURE_POLICIES_DEFAULTS: FailurePoliciesConfig = {
  default: "strict",
  byPhase: {},
};

export const WORKFLOW_DEFAULTS: WorkflowConfig = {
  failurePolicies: FAILURE_POLICIES_DEFAULTS,
};

export const QUALITY_METRICS_DEFAULTS: QualityMetricsConfig = {
  perPhaseTracking: true,
};

export const STACK_DEFAULTS: StackConfig = {
  detected: {},
  overrides: {},
};

// ---------------------------------------------------------------------------
// Exported schemas with .catch() for resilience
// ---------------------------------------------------------------------------

export const ModelRoutingConfigSchema = BaseModelRoutingConfigSchema.catch(MODEL_ROUTING_DEFAULTS);
export const AutonomyConfigSchema = BaseAutonomyConfigSchema.catch(AUTONOMY_DEFAULTS);
export const AutoLearnConfigSchema = BaseAutoLearnConfigSchema.catch(AUTO_LEARN_DEFAULTS);
export const BeadsConfigSchema = BaseBeadsConfigSchema.catch(BEADS_DEFAULTS);
export const GuardrailsConfigSchema = BaseGuardrailsConfigSchema.catch(GUARDRAILS_DEFAULTS);
export const OverseerConfigSchema = BaseOverseerConfigSchema.catch(OVERSEER_DEFAULTS);
export const HotkeysConfigSchema = BaseHotkeysConfigSchema.catch(HOTKEYS_DEFAULTS);
export const FallbackStrategyConfigSchema = BaseFallbackStrategyConfigSchema.catch(
  FALLBACK_STRATEGY_DEFAULTS,
);
export const ToolPoliciesConfigSchema = BaseToolPoliciesConfigSchema.catch(TOOL_POLICIES_DEFAULTS);
export const FailurePoliciesConfigSchema =
  BaseFailurePoliciesConfigSchema.catch(FAILURE_POLICIES_DEFAULTS);
export const WorkflowConfigSchema = BaseWorkflowConfigSchema.catch(WORKFLOW_DEFAULTS);
export const QualityMetricsConfigSchema =
  BaseQualityMetricsConfigSchema.catch(QUALITY_METRICS_DEFAULTS);
export const StackConfigSchema = BaseStackConfigSchema.catch(STACK_DEFAULTS);

// ---------------------------------------------------------------------------
// Top-level SettingsSchema
// ---------------------------------------------------------------------------

export const SETTINGS_DEFAULTS = {
  modelRouting: MODEL_ROUTING_DEFAULTS,
  autonomy: AUTONOMY_DEFAULTS,
  autoLearn: AUTO_LEARN_DEFAULTS,
  beads: BEADS_DEFAULTS,
  guardrails: GUARDRAILS_DEFAULTS,
  overseer: OVERSEER_DEFAULTS,
  hotkeys: HOTKEYS_DEFAULTS,
  fallback: undefined as FallbackStrategyConfig | undefined,
  toolPolicies: TOOL_POLICIES_DEFAULTS,
  workflow: WORKFLOW_DEFAULTS,
  qualityMetrics: QUALITY_METRICS_DEFAULTS,
  stack: STACK_DEFAULTS,
};

export const SettingsSchema = z
  .object({
    modelRouting: ModelRoutingConfigSchema.default(MODEL_ROUTING_DEFAULTS),
    autonomy: AutonomyConfigSchema.default(AUTONOMY_DEFAULTS),
    autoLearn: AutoLearnConfigSchema.default(AUTO_LEARN_DEFAULTS),
    beads: BeadsConfigSchema.default(BEADS_DEFAULTS),
    guardrails: GuardrailsConfigSchema.default(GUARDRAILS_DEFAULTS),
    overseer: OverseerConfigSchema.default(OVERSEER_DEFAULTS),
    hotkeys: HotkeysConfigSchema.default(HOTKEYS_DEFAULTS),
    fallback: FallbackStrategyConfigSchema.optional(),
    toolPolicies: ToolPoliciesConfigSchema.default(TOOL_POLICIES_DEFAULTS),
    workflow: WorkflowConfigSchema.default(WORKFLOW_DEFAULTS),
    qualityMetrics: QualityMetricsConfigSchema.default(QUALITY_METRICS_DEFAULTS),
    stack: StackConfigSchema.default(STACK_DEFAULTS),
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
  TFF_OVERSEER_ENABLED: ["overseer", "enabled"],
  TFF_HOTKEY_DASHBOARD: ["hotkeys", "dashboard"],
  TFF_HOTKEY_WORKFLOW: ["hotkeys", "workflow"],
  TFF_HOTKEY_EXECUTION_MONITOR: ["hotkeys", "executionMonitor"],
};

// ---------------------------------------------------------------------------
// Raw settings sources type
// ---------------------------------------------------------------------------

export type RawSettingsSources = {
  team: Record<string, unknown> | null;
  local: Record<string, unknown> | null;
  env: Record<string, unknown>;
};
