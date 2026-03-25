# M01-S03: Kernel Errors, Port DTOs & Port Abstract Classes

## Scope

Implement kernel error hierarchy, port DTO schemas, and the five kernel port abstract classes. Error classes are pulled forward from original S04 scope so ports can reference concrete error types in their signatures.

Schemas (`IdSchema`, `TimestampSchema`) already exist from S02 — no changes needed.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Error classes location | `kernel/errors/` subdirectory | Errors are kernel-level, used across all hexagons |
| Port DTO location | Separate `.schemas.ts` files colocated with ports | Keeps port files focused on the contract; DTOs are importable independently |
| Port location | `kernel/ports/` subdirectory | Matches design spec directory structure |
| EventBusPort subscribe key | `string` (not `EventName`) | `EventName` is S04 scope; tightened there |
| Error code format | `DOMAIN.SPECIFIC` (e.g., `GIT.BRANCH_NOT_FOUND`) | Per requirements R03 |
| BaseDomainError metadata | `Record<string, unknown>` optional field | Extensible without subclass changes |

## Deliverables

### 1. `src/kernel/errors/base-domain.error.ts` — Error Base

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

### 2. `src/kernel/errors/persistence.error.ts`

```typescript
export class PersistenceError extends BaseDomainError {
  readonly code = "PERSISTENCE.FAILURE";
  constructor(message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
  }
}
```

### 3. `src/kernel/errors/git.error.ts`

```typescript
export class GitError extends BaseDomainError {
  readonly code: string;
  constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = `GIT.${code}`;
  }
}
```

### 4. `src/kernel/errors/github.error.ts`

```typescript
export class GitHubError extends BaseDomainError {
  readonly code: string;
  constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = `GITHUB.${code}`;
  }
}
```

### 5. `src/kernel/errors/sync.error.ts`

```typescript
export class SyncError extends BaseDomainError {
  readonly code: string;
  constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = `SYNC.${code}`;
  }
}
```

### 6. `src/kernel/errors/index.ts` — Error Barrel

Re-export all error classes.

### 7. `src/kernel/ports/event-bus.port.ts` — EventBusPort

```typescript
export abstract class EventBusPort {
  abstract publish(event: DomainEvent): Promise<void>;
  abstract subscribe<T extends DomainEvent>(
    eventType: string,
    handler: (event: T) => Promise<void>,
  ): void;
}
```

### 8. `src/kernel/ports/date-provider.port.ts` — DateProviderPort

```typescript
export abstract class DateProviderPort {
  abstract now(): Date;
}
```

### 9. `src/kernel/ports/git.schemas.ts` — Git DTOs

```typescript
export const GitLogEntrySchema = z.object({
  hash: z.string(),
  message: z.string(),
  author: z.string(),
  date: TimestampSchema,
});
export type GitLogEntry = z.infer<typeof GitLogEntrySchema>;

export const GitFileStatusSchema = z.enum(["added", "modified", "deleted", "renamed", "untracked"]);
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

### 10. `src/kernel/ports/git.port.ts` — GitPort

```typescript
export abstract class GitPort {
  abstract listBranches(pattern: string): Promise<Result<string[], GitError>>;
  abstract createBranch(name: string, base: string): Promise<Result<void, GitError>>;
  abstract showFile(branch: string, path: string): Promise<Result<string | null, GitError>>;
  abstract log(branch: string, limit?: number): Promise<Result<GitLogEntry[], GitError>>;
  abstract status(): Promise<Result<GitStatus, GitError>>;
  abstract commit(message: string, paths: string[]): Promise<Result<string, GitError>>;
}
```

### 11. `src/kernel/ports/github.schemas.ts` — GitHub DTOs

```typescript
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

export const PrFilterSchema = z.object({
  state: z.enum(["open", "closed", "all"]).optional(),
  head: z.string().optional(),
  base: z.string().optional(),
}).optional();
export type PrFilter = z.infer<typeof PrFilterSchema>;
```

### 12. `src/kernel/ports/github.port.ts` — GitHubPort

```typescript
export abstract class GitHubPort {
  abstract createPullRequest(config: PullRequestConfig): Promise<Result<PullRequestInfo, GitHubError>>;
  abstract listPullRequests(filter?: PrFilter): Promise<Result<PullRequestInfo[], GitHubError>>;
  abstract addComment(prNumber: number, body: string): Promise<Result<void, GitHubError>>;
}
```

### 13. `src/kernel/ports/state-sync.schemas.ts` — Sync DTOs

```typescript
export const SyncReportSchema = z.object({
  pulled: z.number().int(),
  conflicts: z.array(z.string()),
  timestamp: TimestampSchema,
});
export type SyncReport = z.infer<typeof SyncReportSchema>;
```

### 14. `src/kernel/ports/state-sync.port.ts` — StateSyncPort

```typescript
export abstract class StateSyncPort {
  abstract push(): Promise<Result<void, SyncError>>;
  abstract pull(): Promise<Result<SyncReport, SyncError>>;
  abstract markDirty(): Promise<void>;
}
```

### 15. `src/kernel/ports/index.ts` — Ports Barrel

Re-export all ports and DTO schemas/types.

### 16. `src/kernel/index.ts` — Updated Kernel Barrel

Add re-exports for errors and ports.

## Acceptance Criteria

- [ ] AC1: All error classes extend `BaseDomainError`, have `code` and optional `metadata`, `name` set to class name
- [ ] AC2: Error codes follow `DOMAIN.SPECIFIC` format — tested with each concrete error
- [ ] AC3: All port DTO schemas export both Zod schema and inferred TypeScript type
- [ ] AC4: All ports are abstract classes with correct method signatures — verified by `tsc --noEmit`
- [ ] AC5: `EventBusPort.publish` accepts `DomainEvent`, `subscribe` accepts `string` event type
- [ ] AC6: Port methods return `Result<T, E>` with the correct domain error type
- [ ] AC7: `biome check`, `vitest run`, `tsc --noEmit` all pass

## Unknowns

None — all types are specified in the design spec.

## Complexity

**F-lite** — 16 files (10 source + 6 test), no investigation, clear patterns from design spec and S02 precedent.
