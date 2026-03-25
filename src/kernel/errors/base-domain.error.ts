export abstract class BaseDomainError extends Error {
  abstract readonly code: string;
  readonly metadata?: Record<string, unknown>;

  constructor(message: string, metadata?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.metadata = metadata;
  }
}
