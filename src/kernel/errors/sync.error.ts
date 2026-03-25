import { BaseDomainError } from "./base-domain.error";

export class SyncError extends BaseDomainError {
  readonly code: string;

  constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = `SYNC.${code}`;
  }
}
