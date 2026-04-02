import { BaseDomainError } from "@kernel";

export class CritiqueReflectionError extends BaseDomainError {
  readonly code = "REVIEW.CRITIQUE_REFLECTION_FAILED";

  constructor(message: string, cause?: Error) {
    super(message, { cause: cause?.message });
  }
}
