# M01-S03 Plan: Kernel Errors, Port DTOs & Port Abstract Classes

## Wave 0 (parallel — no dependencies)

### T01: Create BaseDomainError and concrete error classes

- **Files**: `src/kernel/errors/base-domain.error.ts`, `src/kernel/errors/persistence.error.ts`, `src/kernel/errors/git.error.ts`, `src/kernel/errors/github.error.ts`, `src/kernel/errors/sync.error.ts`, `src/kernel/errors/index.ts`
- **Code** (`base-domain.error.ts`):
```typescript
export abstract class BaseDomainError extends Error {
  abstract readonly code: string;
  readonly metadata?: Record<string, unknown>;

  protected constructor(message: string, metadata?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.metadata = metadata;
  }
}
```
- **Code** (`persistence.error.ts`):
```typescript
import { BaseDomainError } from "./base-domain.error";

export class PersistenceError extends BaseDomainError {
  readonly code = "PERSISTENCE.FAILURE";
  constructor(message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
  }
}
```
- **Code** (`git.error.ts`):
```typescript
import { BaseDomainError } from "./base-domain.error";

export class GitError extends BaseDomainError {
  readonly code: string;
  constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = `GIT.${code}`;
  }
}
```
- **Code** (`github.error.ts`):
```typescript
import { BaseDomainError } from "./base-domain.error";

export class GitHubError extends BaseDomainError {
  readonly code: string;
  constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = `GITHUB.${code}`;
  }
}
```
- **Code** (`sync.error.ts`):
```typescript
import { BaseDomainError } from "./base-domain.error";

export class SyncError extends BaseDomainError {
  readonly code: string;
  constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = `SYNC.${code}`;
  }
}
```
- **Code** (`errors/index.ts`):
```typescript
export { BaseDomainError } from "./base-domain.error";
export { PersistenceError } from "./persistence.error";
export { GitError } from "./git.error";
export { GitHubError } from "./github.error";
export { SyncError } from "./sync.error";
```
- **Test file**: `src/kernel/errors/base-domain.error.spec.ts`
- **Test cases**:
  - `PersistenceError` extends `BaseDomainError` and `Error`
  - `PersistenceError.code` is `"PERSISTENCE.FAILURE"`
  - `PersistenceError.name` is `"PersistenceError"`
  - `PersistenceError.metadata` is undefined when not provided
  - `PersistenceError.metadata` is set when provided
  - `GitError` code prepends `"GIT."` to the given code
  - `GitHubError` code prepends `"GITHUB."` to the given code
  - `SyncError` code prepends `"SYNC."` to the given code
  - All errors are `instanceof BaseDomainError`
  - All errors are `instanceof Error`
  - Error `message` is accessible
- **Run**: `npx vitest run src/kernel/errors/base-domain.error.spec.ts`
- **Expect**: All tests pass
- **AC**: AC1, AC2

### T02: Create EventBusPort and DateProviderPort

- **Files**: `src/kernel/ports/event-bus.port.ts`, `src/kernel/ports/date-provider.port.ts`
- **Code** (`event-bus.port.ts`):
```typescript
import type { DomainEvent } from "@kernel/domain-event.base";

export abstract class EventBusPort {
  abstract publish(event: DomainEvent): Promise<void>;
  abstract subscribe<T extends DomainEvent>(
    eventType: string,
    handler: (event: T) => Promise<void>,
  ): void;
}
```
- **Code** (`date-provider.port.ts`):
```typescript
export abstract class DateProviderPort {
  abstract now(): Date;
}
```
- No tests — abstract classes with no logic. Verified by `tsc --noEmit`.
- **AC**: AC4, AC5

## Wave 1 (parallel — depends on Wave 0 errors)

### T03: Create Git port DTOs and GitPort

- **Files**: `src/kernel/ports/git.schemas.ts`, `src/kernel/ports/git.port.ts`
- **Code** (`git.schemas.ts`):
```typescript
import { z } from "zod";
import { TimestampSchema } from "@kernel/schemas";

export const GitLogEntrySchema = z.object({
  hash: z.string(),
  message: z.string(),
  author: z.string(),
  date: TimestampSchema,
});
export type GitLogEntry = z.infer<typeof GitLogEntrySchema>;

export const GitFileStatusSchema = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
  "untracked",
]);
export type GitFileStatus = z.infer<typeof GitFileStatusSchema>;

export const GitStatusEntrySchema = z.object({
  path: z.string(),
  status: GitFileStatusSchema,
});
export type GitStatusEntry = z.infer<typeof GitStatusEntrySchema>;

export const GitStatusSchema = z.object({
  branch: z.string(),
  clean: z.boolean(),
  entries: z.array(GitStatusEntrySchema),
});
export type GitStatus = z.infer<typeof GitStatusSchema>;
```
- **Code** (`git.port.ts`):
```typescript
import type { Result } from "@kernel/result";
import type { GitError } from "@kernel/errors";
import type { GitLogEntry, GitStatus } from "./git.schemas";

export abstract class GitPort {
  abstract listBranches(pattern: string): Promise<Result<string[], GitError>>;
  abstract createBranch(name: string, base: string): Promise<Result<void, GitError>>;
  abstract showFile(branch: string, path: string): Promise<Result<string | null, GitError>>;
  abstract log(branch: string, limit?: number): Promise<Result<GitLogEntry[], GitError>>;
  abstract status(): Promise<Result<GitStatus, GitError>>;
  abstract commit(message: string, paths: string[]): Promise<Result<string, GitError>>;
}
```
- **Test file**: `src/kernel/ports/git.schemas.spec.ts`
- **Test cases**:
  - `GitLogEntrySchema` accepts valid entry
  - `GitLogEntrySchema` rejects missing fields
  - `GitLogEntrySchema` coerces ISO string date to Date
  - `GitFileStatusSchema` accepts all valid statuses
  - `GitFileStatusSchema` rejects invalid status
  - `GitStatusEntrySchema` accepts valid entry
  - `GitStatusSchema` accepts valid status with entries
  - `GitStatusSchema` accepts clean status with empty entries
- **Run**: `npx vitest run src/kernel/ports/git.schemas.spec.ts`
- **Expect**: All tests pass
- **AC**: AC3, AC4, AC6

### T04: Create GitHub port DTOs and GitHubPort

- **Files**: `src/kernel/ports/github.schemas.ts`, `src/kernel/ports/github.port.ts`
- **Code** (`github.schemas.ts`):
```typescript
import { z } from "zod";
import { TimestampSchema } from "@kernel/schemas";

export const PullRequestConfigSchema = z.object({
  title: z.string(),
  body: z.string(),
  head: z.string(),
  base: z.string(),
  draft: z.boolean().optional(),
});
export type PullRequestConfig = z.infer<typeof PullRequestConfigSchema>;

export const PullRequestInfoSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  state: z.enum(["open", "closed", "merged"]),
  head: z.string(),
  base: z.string(),
  createdAt: TimestampSchema,
});
export type PullRequestInfo = z.infer<typeof PullRequestInfoSchema>;

export const PrFilterSchema = z
  .object({
    state: z.enum(["open", "closed", "all"]).optional(),
    head: z.string().optional(),
    base: z.string().optional(),
  })
  .optional();
export type PrFilter = z.infer<typeof PrFilterSchema>;
```
- **Code** (`github.port.ts`):
```typescript
import type { Result } from "@kernel/result";
import type { GitHubError } from "@kernel/errors";
import type { PullRequestConfig, PullRequestInfo, PrFilter } from "./github.schemas";

export abstract class GitHubPort {
  abstract createPullRequest(
    config: PullRequestConfig,
  ): Promise<Result<PullRequestInfo, GitHubError>>;
  abstract listPullRequests(
    filter?: PrFilter,
  ): Promise<Result<PullRequestInfo[], GitHubError>>;
  abstract addComment(prNumber: number, body: string): Promise<Result<void, GitHubError>>;
}
```
- **Test file**: `src/kernel/ports/github.schemas.spec.ts`
- **Test cases**:
  - `PullRequestConfigSchema` accepts valid config
  - `PullRequestConfigSchema` accepts config with optional `draft`
  - `PullRequestConfigSchema` rejects missing required fields
  - `PullRequestInfoSchema` accepts valid PR info
  - `PullRequestInfoSchema` coerces createdAt to Date
  - `PullRequestInfoSchema` rejects invalid state
  - `PrFilterSchema` accepts undefined (optional top-level)
  - `PrFilterSchema` accepts partial filter
  - `PrFilterSchema` accepts empty object
- **Run**: `npx vitest run src/kernel/ports/github.schemas.spec.ts`
- **Expect**: All tests pass
- **AC**: AC3, AC4, AC6

### T05: Create StateSync port DTOs and StateSyncPort

- **Files**: `src/kernel/ports/state-sync.schemas.ts`, `src/kernel/ports/state-sync.port.ts`
- **Code** (`state-sync.schemas.ts`):
```typescript
import { z } from "zod";
import { TimestampSchema } from "@kernel/schemas";

export const SyncReportSchema = z.object({
  pulled: z.number().int(),
  conflicts: z.array(z.string()),
  timestamp: TimestampSchema,
});
export type SyncReport = z.infer<typeof SyncReportSchema>;
```
- **Code** (`state-sync.port.ts`):
```typescript
import type { Result } from "@kernel/result";
import type { SyncError } from "@kernel/errors";
import type { SyncReport } from "./state-sync.schemas";

export abstract class StateSyncPort {
  abstract push(): Promise<Result<void, SyncError>>;
  abstract pull(): Promise<Result<SyncReport, SyncError>>;
  abstract markDirty(): Promise<void>;
}
```
- **Test file**: `src/kernel/ports/state-sync.schemas.spec.ts`
- **Test cases**:
  - `SyncReportSchema` accepts valid report
  - `SyncReportSchema` coerces timestamp to Date
  - `SyncReportSchema` rejects missing fields
  - `SyncReportSchema` rejects non-integer pulled count
- **Run**: `npx vitest run src/kernel/ports/state-sync.schemas.spec.ts`
- **Expect**: All tests pass
- **AC**: AC3, AC4, AC6

## Wave 2 (depends on Wave 1 — barrels + full verification)

### T06: Create ports barrel and update kernel barrel

- **Files**: `src/kernel/ports/index.ts`, `src/kernel/index.ts` (update)
- **Code** (`ports/index.ts`):
```typescript
export { EventBusPort } from "./event-bus.port";
export { DateProviderPort } from "./date-provider.port";

export { GitPort } from "./git.port";
export type { GitLogEntry, GitStatus, GitFileStatus, GitStatusEntry } from "./git.schemas";
export { GitLogEntrySchema, GitStatusSchema, GitFileStatusSchema, GitStatusEntrySchema } from "./git.schemas";

export { GitHubPort } from "./github.port";
export type { PullRequestConfig, PullRequestInfo, PrFilter } from "./github.schemas";
export { PullRequestConfigSchema, PullRequestInfoSchema, PrFilterSchema } from "./github.schemas";

export { StateSyncPort } from "./state-sync.port";
export type { SyncReport } from "./state-sync.schemas";
export { SyncReportSchema } from "./state-sync.schemas";
```
- **Code** (`kernel/index.ts` — full replacement):
```typescript
export { AggregateRoot } from "./aggregate-root.base";
export type { DomainEventProps } from "./domain-event.base";
export { DomainEvent, DomainEventPropsSchema } from "./domain-event.base";
export { Entity } from "./entity.base";
export type { Result } from "./result";
export { err, isErr, isOk, match, ok } from "./result";
export type { Id, Timestamp } from "./schemas";
export { IdSchema, TimestampSchema } from "./schemas";
export { ValueObject } from "./value-object.base";

export {
  BaseDomainError,
  PersistenceError,
  GitError,
  GitHubError,
  SyncError,
} from "./errors";

export {
  EventBusPort,
  DateProviderPort,
  GitPort,
  GitHubPort,
  StateSyncPort,
  GitLogEntrySchema,
  GitStatusSchema,
  GitFileStatusSchema,
  GitStatusEntrySchema,
  PullRequestConfigSchema,
  PullRequestInfoSchema,
  PrFilterSchema,
  SyncReportSchema,
} from "./ports";

export type {
  GitLogEntry,
  GitStatus,
  GitFileStatus,
  GitStatusEntry,
  PullRequestConfig,
  PullRequestInfo,
  PrFilter,
  SyncReport,
} from "./ports";
```
- **Run**:
```bash
npx biome check . && npx vitest run && npx tsc --noEmit
```
- **Expect**: All three commands pass, all tests green
- **AC**: AC1, AC2, AC3, AC4, AC5, AC6, AC7

### T07: Commit kernel errors and ports

- **Run**:
```bash
git add src/kernel/errors/ src/kernel/ports/ src/kernel/index.ts
git commit -m "feat(m01-s03): kernel errors, port DTOs, and port abstract classes"
```
- **Expect**: Clean commit on milestone/M01 branch
- **AC**: All

## Dependency Graph

```
T01 (errors) ──┐
T02 (event+date)─┼─→ T03 (git) ──┐
                 │   T04 (github) ─┼─→ T06 (barrels) → T07 (commit)
                 │   T05 (sync) ──┘
                 └───────────────────┘
```

Wave 0: T01, T02 (parallel)
Wave 1: T03, T04, T05 (parallel — need errors from T01)
Wave 2: T06, T07 (sequential — need all ports)

## AC Traceability

| AC | Tasks |
|----|-------|
| AC1: Error classes extend BaseDomainError, code + metadata + name | T01, T06 |
| AC2: Error codes follow DOMAIN.SPECIFIC format | T01, T06 |
| AC3: Port DTOs export Zod schema + inferred type | T03, T04, T05, T06 |
| AC4: Ports are abstract classes, correct signatures | T02, T03, T04, T05, T06 |
| AC5: EventBusPort publish/subscribe signatures | T02, T06 |
| AC6: Port methods return Result<T, DomainError> | T03, T04, T05, T06 |
| AC7: biome + vitest + tsc pass | T06 |
