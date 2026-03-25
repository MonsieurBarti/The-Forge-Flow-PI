import { BaseDomainError } from "./base-domain.error";

export class InvalidTransitionError extends BaseDomainError {
  readonly code = "DOMAIN.INVALID_TRANSITION";

  constructor(from: string, to: string, entity: string) {
    super(`Invalid transition from '${from}' to '${to}' on ${entity}`, {
      from,
      to,
      entity,
    });
  }
}
