export { AggregateRoot } from "./aggregate-root.base";
export type { DomainEventProps } from "./domain-event.base";
export { DomainEvent, DomainEventPropsSchema } from "./domain-event.base";
export { Entity } from "./entity.base";
export {
  BaseDomainError,
  GitError,
  GitHubError,
  InvalidTransitionError,
  PersistenceError,
  SyncError,
} from "./errors";
export type { EventName } from "./event-names";
export { EVENT_NAMES, EventNameSchema } from "./event-names";
export type {
  GitFileStatus,
  GitLogEntry,
  GitStatus,
  GitStatusEntry,
  PrFilter,
  PullRequestConfig,
  PullRequestInfo,
  SyncReport,
} from "./ports";
export {
  DateProviderPort,
  EventBusPort,
  GitFileStatusSchema,
  GitHubPort,
  GitLogEntrySchema,
  GitPort,
  GitStatusEntrySchema,
  GitStatusSchema,
  PrFilterSchema,
  PullRequestConfigSchema,
  PullRequestInfoSchema,
  StateSyncPort,
  SyncReportSchema,
} from "./ports";
export type { Result } from "./result";
export { err, isErr, isOk, match, ok } from "./result";
export type { Id, Timestamp } from "./schemas";
export { IdSchema, TimestampSchema } from "./schemas";
export { ValueObject } from "./value-object.base";
