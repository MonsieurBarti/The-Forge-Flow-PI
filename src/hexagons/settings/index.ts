// Domain — Value Object

// Domain — Error
export { SettingsFileError } from "./domain/errors/settings-file.error";
// Domain — Ports
export { BudgetTrackingPort } from "./domain/ports/budget-tracking.port";
export { EnvVarPort } from "./domain/ports/env-var.port";
export { SettingsFilePort } from "./domain/ports/settings-file.port";
// Domain — Schemas & Types
export type {
  AutoLearnConfig,
  AutonomyConfig,
  AutonomyMode,
  BeadsConfig,
  BudgetConfig,
  HotkeysConfig,
  ModelName,
  ModelProfile,
  ModelProfileName,
  ModelRoutingConfig,
  RawSettingsSources,
  SettingsProps,
} from "./domain/project-settings.schemas";
export {
  AUTO_LEARN_DEFAULTS,
  AUTONOMY_DEFAULTS,
  AutonomyModeSchema,
  BEADS_DEFAULTS,
  HOTKEYS_DEFAULTS,
  MODEL_ROUTING_DEFAULTS,
  ModelNameSchema,
  ModelProfileNameSchema,
  SETTINGS_DEFAULTS,
  SettingsSchema,
} from "./domain/project-settings.schemas";
export { ProjectSettings } from "./domain/project-settings.value-object";

// Use Cases
export { LoadSettingsUseCase } from "./use-cases/load-settings.use-case";
export { MergeSettingsUseCase } from "./use-cases/merge-settings.use-case";
export { ResolveModelUseCase } from "./use-cases/resolve-model.use-case";
