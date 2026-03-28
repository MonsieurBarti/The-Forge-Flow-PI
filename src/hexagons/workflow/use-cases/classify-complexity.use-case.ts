import type { ComplexityTier, SliceRepositoryPort } from "@hexagons/slice";
import { SliceNotFoundError } from "@hexagons/slice";
import type { DateProviderPort, PersistenceError } from "@kernel";
import { err, isErr, ok, type Result } from "@kernel";

export interface ClassifyComplexityInput {
  sliceId: string;
  tier: ComplexityTier;
}

export interface ClassifyComplexityOutput {
  sliceId: string;
  tier: ComplexityTier;
}

export class ClassifyComplexityUseCase {
  constructor(
    private readonly sliceRepo: SliceRepositoryPort,
    private readonly dateProvider: DateProviderPort,
  ) {}

  async execute(
    input: ClassifyComplexityInput,
  ): Promise<Result<ClassifyComplexityOutput, SliceNotFoundError | PersistenceError>> {
    const result = await this.sliceRepo.findById(input.sliceId);
    if (isErr(result)) return result;
    if (!result.data) return err(new SliceNotFoundError(input.sliceId));

    result.data.setComplexity(input.tier, this.dateProvider.now());

    const saveResult = await this.sliceRepo.save(result.data);
    if (isErr(saveResult)) return saveResult;

    return ok({ sliceId: input.sliceId, tier: input.tier });
  }
}
