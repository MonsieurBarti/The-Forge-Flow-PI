import { CritiqueReflectionResultSchema } from "../domain/critique-reflection.schemas";
import type { ReviewRole } from "../domain/review.schemas";
import { strategyForRole } from "../domain/review-strategy";

export interface ReviewPromptConfig {
  readonly sliceId: string;
  readonly sliceLabel: string;
  readonly sliceTitle: string;
  readonly role: ReviewRole;
  readonly changedFiles: string;
  readonly acceptanceCriteria: string;
}

export class ReviewPromptBuilder {
  constructor(private readonly templateLoader: (path: string) => string) {}

  build(config: ReviewPromptConfig): string {
    const strategy = strategyForRole(config.role);
    if (strategy === "critique-then-reflection") {
      return this.buildCTR(config);
    }
    return this.buildStandard(config);
  }

  private buildCTR(config: ReviewPromptConfig): string {
    const template = this.templateLoader("prompts/critique-then-reflection.md");
    const schemaObject = CritiqueReflectionResultSchema.toJSONSchema();
    const outputSchema = JSON.stringify(schemaObject, null, 2);

    return template
      .replace(/\{\{sliceLabel\}\}/g, config.sliceLabel)
      .replace(/\{\{sliceTitle\}\}/g, config.sliceTitle)
      .replace(/\{\{sliceId\}\}/g, config.sliceId)
      .replace(/\{\{reviewRole\}\}/g, config.role)
      .replace(/\{\{outputSchema\}\}/g, outputSchema)
      .replace(/\{\{changedFiles\}\}/g, config.changedFiles)
      .replace(/\{\{acceptanceCriteria\}\}/g, config.acceptanceCriteria);
  }

  private buildStandard(config: ReviewPromptConfig): string {
    const template = this.templateLoader("prompts/standard-review.md");
    return template
      .replace(/\{\{sliceLabel\}\}/g, config.sliceLabel)
      .replace(/\{\{sliceTitle\}\}/g, config.sliceTitle)
      .replace(/\{\{sliceId\}\}/g, config.sliceId)
      .replace(/\{\{reviewRole\}\}/g, config.role)
      .replace(/\{\{changedFiles\}\}/g, config.changedFiles)
      .replace(/\{\{acceptanceCriteria\}\}/g, config.acceptanceCriteria);
  }
}
