import type { ComplexityTier, ModelProfileName } from "@kernel";
import type { WorkflowPhase } from "../workflow-session.schemas";

export abstract class ModelProfileResolverPort {
  abstract resolveForPhase(
    phase: WorkflowPhase,
    complexity: ComplexityTier,
  ): Promise<ModelProfileName>;
}
