import type { ComplexityTier } from "@kernel";
import { ok, type Result } from "@kernel";
import type { BudgetTrackingPort } from "../domain/ports/budget-tracking.port";
import type { ModelName, ModelProfileName } from "../domain/project-settings.schemas";
import type { ProjectSettings } from "../domain/project-settings.value-object";

const PROFILE_PRIORITY: readonly ModelProfileName[] = ["quality", "balanced", "budget"];

function profileIndex(profile: ModelProfileName): number {
  return PROFILE_PRIORITY.indexOf(profile);
}

interface ResolveParams {
  phase: string;
  complexity: ComplexityTier;
  settings: ProjectSettings;
  unavailableModels?: ModelName[];
}

export class ResolveModelUseCase {
  constructor(private readonly budgetPort: BudgetTrackingPort) {}

  async execute(params: ResolveParams): Promise<Result<ModelName, never>> {
    const { phase, complexity, settings, unavailableModels = [] } = params;
    const routing = settings.modelRouting;

    // 1. Determine profile: phase override takes precedence over complexity mapping
    let profileName: ModelProfileName =
      routing.phaseOverrides?.[phase] ?? routing.complexityMapping[complexity];

    // 2. Budget downshift
    const budgetResult = await this.budgetPort.getUsagePercent();
    const usagePercent = budgetResult.ok ? budgetResult.data : 0;

    const thresholds = routing.budget?.thresholds ?? [50, 75];

    if (usagePercent >= thresholds[1] && profileIndex(profileName) < profileIndex("budget")) {
      profileName = "budget";
    } else if (
      usagePercent >= thresholds[0] &&
      profileIndex(profileName) < profileIndex("balanced")
    ) {
      profileName = "balanced";
    }

    // 3. Look up primary model for resolved profile
    const profile = routing.profiles[profileName];
    let model: ModelName = profile.model;

    // 4. Walk fallback chain if primary model is unavailable
    if (unavailableModels.includes(model) && profile.fallbackChain.length > 0) {
      for (const fallback of profile.fallbackChain) {
        model = fallback; // advance to this entry (terminal fallback: last in chain)
        if (!unavailableModels.includes(fallback)) {
          break;
        }
      }
    }

    return ok(model);
  }
}
