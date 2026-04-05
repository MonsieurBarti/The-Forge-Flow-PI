import type {
  AutoLearnConfig,
  AutonomyConfig,
  BeadsConfig,
  HotkeysConfig,
  ModelRoutingConfig,
  QualityMetricsConfig,
  SettingsProps,
  StackConfig,
  ToolPoliciesConfig,
  WorkflowConfig,
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

  get toolPolicies(): ToolPoliciesConfig {
    return this.props.toolPolicies;
  }

  get workflow(): WorkflowConfig {
    return this.props.workflow;
  }

  get qualityMetrics(): QualityMetricsConfig {
    return this.props.qualityMetrics;
  }

  get stack(): StackConfig {
    return this.props.stack;
  }

  toJSON(): SettingsProps {
    return { ...this.props };
  }
}
