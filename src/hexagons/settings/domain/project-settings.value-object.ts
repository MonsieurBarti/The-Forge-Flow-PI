import type {
  AutoLearnConfig,
  AutonomyConfig,
  BeadsConfig,
  HotkeysConfig,
  ModelRoutingConfig,
  SettingsProps,
} from "./project-settings.schemas";
import { SettingsSchema } from "./project-settings.schemas";

export class ProjectSettings {
  private constructor(private readonly props: SettingsProps) {}

  static create(raw: unknown): ProjectSettings {
    const validated = SettingsSchema.parse(raw);
    return new ProjectSettings(validated);
  }

  static reconstitute(props: SettingsProps): ProjectSettings {
    return new ProjectSettings(props);
  }

  get modelRouting(): ModelRoutingConfig {
    return this.props.modelRouting;
  }

  get autonomy(): AutonomyConfig {
    return this.props.autonomy;
  }

  get autoLearn(): AutoLearnConfig {
    return this.props.autoLearn;
  }

  get beads(): BeadsConfig {
    return this.props.beads;
  }

  get hotkeys(): HotkeysConfig {
    return this.props.hotkeys;
  }

  toJSON(): SettingsProps {
    return { ...this.props };
  }
}
