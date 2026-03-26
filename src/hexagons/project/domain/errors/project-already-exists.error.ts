import { BaseDomainError } from "@kernel";

export class ProjectAlreadyExistsError extends BaseDomainError {
  readonly code = "PROJECT.ALREADY_EXISTS";

  constructor(projectRoot: string) {
    super(`Project already initialized at ${projectRoot}/.tff/`);
  }
}
