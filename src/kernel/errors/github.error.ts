import { BaseDomainError } from "./base-domain.error";

export class GitHubError extends BaseDomainError {
  readonly code: string;

  constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = `GITHUB.${code}`;
  }
}
