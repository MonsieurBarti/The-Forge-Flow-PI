import type { ComplexityTier, ModelProfileName } from "@kernel";
import type { MergeSettingsUseCase } from "@hexagons/settings";
import { ModelProfileResolverPort } from "../domain/ports/model-profile-resolver.port";
import type { WorkflowPhase } from "../domain/workflow-session.schemas";

export class SettingsModelProfileResolver extends ModelProfileResolverPort {
  constructor(private readonly mergeSettings: MergeSettingsUseCase) {
    super();
  }

  async resolveForPhase(
    phase: WorkflowPhase,
    complexity: ComplexityTier,
  ): Promise<ModelProfileName> {
    const result = this.mergeSettings.execute({
      team: null,
      local: null,
      env: process.env,
    });
    if (!result.ok) return "balanced";
    const routing = result.data.modelRouting;
    return routing.phaseOverrides?.[phase] ?? routing.complexityMapping[complexity];
  }
}
