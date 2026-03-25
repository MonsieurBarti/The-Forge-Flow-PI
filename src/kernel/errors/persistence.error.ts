import { BaseDomainError } from "./base-domain.error";

export class PersistenceError extends BaseDomainError {
  readonly code = "PERSISTENCE.FAILURE";
}
