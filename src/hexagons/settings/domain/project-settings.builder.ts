import type {
  AutoLearnConfig,
  AutonomyConfig,
  AutonomyMode,
  BeadsConfig,
  GuardrailsConfig,
  ModelRoutingConfig,
  SettingsProps,
} from "./project-settings.schemas";
import {
  AUTO_LEARN_DEFAULTS,
  AUTONOMY_DEFAULTS,
  BEADS_DEFAULTS,
  GUARDRAILS_DEFAULTS,
  MODEL_ROUTING_DEFAULTS,
} from "./project-settings.schemas";
import { ProjectSettings } from "./project-settings.value-object";

export class ProjectSettingsBuilder {
  private _modelRouting: ModelRoutingConfig = { ...MODEL_ROUTING_DEFAULTS };
  private _autonomy: AutonomyConfig = { ...AUTONOMY_DEFAULTS };
  private _autoLearn: AutoLearnConfig = { ...AUTO_LEARN_DEFAULTS };
  private _beads: BeadsConfig = { ...BEADS_DEFAULTS };
  private _guardrails: GuardrailsConfig = { ...GUARDRAILS_DEFAULTS };

  withModelRouting(config: Partial<ModelRoutingConfig>): this {
    Object.assign(this._modelRouting, config);
    return this;
  }

  withAutonomy(config: Partial<AutonomyConfig>): this {
    Object.assign(this._autonomy, config);
    return this;
  }

  withAutoLearn(config: Partial<AutoLearnConfig>): this {
    Object.assign(this._autoLearn, config);
    return this;
  }

  withBeads(config: Partial<BeadsConfig>): this {
    Object.assign(this._beads, config);
    return this;
  }

  withGuardrails(config: Partial<GuardrailsConfig>): this {
    Object.assign(this._guardrails, config);
    return this;
  }

  withAutonomyMode(mode: AutonomyMode): this {
    this._autonomy.mode = mode;
    return this;
  }

  withComplexityMapping(mapping: ModelRoutingConfig["complexityMapping"]): this {
    this._modelRouting.complexityMapping = mapping;
    return this;
  }

  build(): ProjectSettings {
    return ProjectSettings.create(this.buildProps());
  }

  buildProps(): SettingsProps {
    return {
      modelRouting: this._modelRouting,
      autonomy: this._autonomy,
      autoLearn: this._autoLearn,
      beads: this._beads,
      guardrails: this._guardrails,
    };
  }
}
