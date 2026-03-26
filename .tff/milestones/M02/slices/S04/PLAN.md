# M02-S04: EventBus Implementation — Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** In-process event bus with sequential handler execution, error isolation via LoggerPort, and type-safe subscriptions using EVENT_NAMES constants.

**Architecture:** LoggerPort (kernel port) + InProcessEventBus (kernel infrastructure adapter) + ConsoleLoggerAdapter + SilentLoggerAdapter. Port change: remove generic from subscribe().

**Tech Stack:** TypeScript, Vitest, Zod (existing)

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/kernel/ports/logger.port.ts` | Create | LoggerPort abstract class |
| `src/kernel/ports/event-bus.port.ts` | Modify | Remove generic from subscribe() |
| `src/kernel/ports/index.ts` | Modify | Add LoggerPort export |
| `src/kernel/infrastructure/in-process-event-bus.ts` | Create | InProcessEventBus adapter |
| `src/kernel/infrastructure/in-process-event-bus.spec.ts` | Create | Unit tests |
| `src/kernel/infrastructure/console-logger.adapter.ts` | Create | Console-based LoggerPort |
| `src/kernel/infrastructure/console-logger.adapter.spec.ts` | Create | ConsoleLogger smoke tests |
| `src/kernel/infrastructure/silent-logger.adapter.ts` | Create | No-op LoggerPort for tests |
| `src/kernel/infrastructure/silent-logger.adapter.spec.ts` | Create | SilentLogger capture tests |
| `src/kernel/infrastructure/event-bus-integration.spec.ts` | Create | Aggregate-to-handler flow test |
| `src/kernel/infrastructure/index.ts` | Create | Barrel exports |
| `src/kernel/index.ts` | Modify | Add infrastructure exports |

---

## Wave 0 (parallel — no dependencies)

### T01: LoggerPort + SilentLoggerAdapter + tests
**Files:** Create `src/kernel/ports/logger.port.ts`, Create `src/kernel/infrastructure/silent-logger.adapter.ts`, Create `src/kernel/infrastructure/silent-logger.adapter.spec.ts`
**Traces to:** AC7, AC8

- [ ] Step 1: Write failing tests in `src/kernel/infrastructure/silent-logger.adapter.spec.ts`:
  ```typescript
  import { describe, expect, it } from "vitest";
  import { SilentLoggerAdapter } from "./silent-logger.adapter";

  describe("SilentLoggerAdapter", () => {
    it("implements all LoggerPort methods without throwing", () => {
      const logger = new SilentLoggerAdapter();
      expect(() => {
        logger.error("err");
        logger.warn("warn");
        logger.info("info");
        logger.debug("debug");
      }).not.toThrow();
    });

    it("captures messages for test assertions", () => {
      const logger = new SilentLoggerAdapter();
      logger.error("boom", { key: "value" });
      logger.warn("careful");

      const messages = logger.getMessages();
      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({
        level: "error",
        message: "boom",
        context: { key: "value" },
      });
      expect(messages[1]).toEqual({
        level: "warn",
        message: "careful",
        context: undefined,
      });
    });

    it("reset clears captured messages", () => {
      const logger = new SilentLoggerAdapter();
      logger.info("something");
      logger.reset();
      expect(logger.getMessages()).toHaveLength(0);
    });
  });
  ```
- [ ] Step 2: Run `npx vitest run src/kernel/infrastructure/silent-logger.adapter.spec.ts`, verify FAIL
- [ ] Step 3: Create `src/kernel/ports/logger.port.ts`:
  ```typescript
  export abstract class LoggerPort {
    abstract error(message: string, context?: Record<string, unknown>): void;
    abstract warn(message: string, context?: Record<string, unknown>): void;
    abstract info(message: string, context?: Record<string, unknown>): void;
    abstract debug(message: string, context?: Record<string, unknown>): void;
  }
  ```
- [ ] Step 4: Create `src/kernel/infrastructure/silent-logger.adapter.ts`:
  ```typescript
  import { LoggerPort } from "@kernel/ports/logger.port";

  interface LogMessage {
    readonly level: "error" | "warn" | "info" | "debug";
    readonly message: string;
    readonly context: Record<string, unknown> | undefined;
  }

  export class SilentLoggerAdapter extends LoggerPort {
    private messages: LogMessage[] = [];

    error(message: string, context?: Record<string, unknown>): void {
      this.messages.push({ level: "error", message, context });
    }

    warn(message: string, context?: Record<string, unknown>): void {
      this.messages.push({ level: "warn", message, context });
    }

    info(message: string, context?: Record<string, unknown>): void {
      this.messages.push({ level: "info", message, context });
    }

    debug(message: string, context?: Record<string, unknown>): void {
      this.messages.push({ level: "debug", message, context });
    }

    getMessages(): readonly LogMessage[] {
      return [...this.messages];
    }

    reset(): void {
      this.messages = [];
    }
  }
  ```
- [ ] Step 5: Run `npx vitest run src/kernel/infrastructure/silent-logger.adapter.spec.ts`, verify PASS
- [ ] Step 6: `git add src/kernel/ports/logger.port.ts src/kernel/infrastructure/silent-logger.adapter.ts src/kernel/infrastructure/silent-logger.adapter.spec.ts && git commit -m "feat(S04/T01): add LoggerPort and SilentLoggerAdapter"`

### T02: Modify EventBusPort + ConsoleLoggerAdapter + update barrel exports
**Files:** Modify `src/kernel/ports/event-bus.port.ts`, Create `src/kernel/infrastructure/console-logger.adapter.ts`, Create `src/kernel/infrastructure/console-logger.adapter.spec.ts`, Modify `src/kernel/ports/index.ts`
**Traces to:** AC8, AC9

- [ ] Step 1: Write failing test in `src/kernel/infrastructure/console-logger.adapter.spec.ts`:
  ```typescript
  import { describe, expect, it, vi } from "vitest";
  import { ConsoleLoggerAdapter } from "./console-logger.adapter";

  describe("ConsoleLoggerAdapter", () => {
    it("delegates to console methods without throwing", () => {
      const logger = new ConsoleLoggerAdapter();
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      logger.error("test", { key: "value" });
      expect(spy).toHaveBeenCalledWith("test", { key: "value" });
      spy.mockRestore();
    });

    it("omits context argument when not provided", () => {
      const logger = new ConsoleLoggerAdapter();
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      logger.warn("test");
      expect(spy).toHaveBeenCalledWith("test");
      spy.mockRestore();
    });
  });
  ```
- [ ] Step 2: Run `npx vitest run src/kernel/infrastructure/console-logger.adapter.spec.ts`, verify FAIL
- [ ] Step 3: Modify `src/kernel/ports/event-bus.port.ts` — remove generic from subscribe:
  ```typescript
  import type { DomainEvent } from "@kernel/domain-event.base";
  import type { EventName } from "@kernel/event-names";

  export abstract class EventBusPort {
    abstract publish(event: DomainEvent): Promise<void>;
    abstract subscribe(
      eventType: EventName,
      handler: (event: DomainEvent) => Promise<void>,
    ): void;
  }
  ```
- [ ] Step 4: Create `src/kernel/infrastructure/console-logger.adapter.ts`:
  ```typescript
  import { LoggerPort } from "@kernel/ports/logger.port";

  export class ConsoleLoggerAdapter extends LoggerPort {
    error(message: string, context?: Record<string, unknown>): void {
      context ? console.error(message, context) : console.error(message);
    }

    warn(message: string, context?: Record<string, unknown>): void {
      context ? console.warn(message, context) : console.warn(message);
    }

    info(message: string, context?: Record<string, unknown>): void {
      context ? console.info(message, context) : console.info(message);
    }

    debug(message: string, context?: Record<string, unknown>): void {
      context ? console.debug(message, context) : console.debug(message);
    }
  }
  ```
- [ ] Step 5: Update `src/kernel/ports/index.ts` — add LoggerPort:
  ```typescript
  export { DateProviderPort } from "./date-provider.port";
  export { EventBusPort } from "./event-bus.port";
  export { LoggerPort } from "./logger.port";

  export { GitPort } from "./git.port";
  export type { GitFileStatus, GitLogEntry, GitStatus, GitStatusEntry } from "./git.schemas";
  export {
    GitFileStatusSchema,
    GitLogEntrySchema,
    GitStatusEntrySchema,
    GitStatusSchema,
  } from "./git.schemas";

  export { GitHubPort } from "./github.port";
  export type { PrFilter, PullRequestConfig, PullRequestInfo } from "./github.schemas";
  export { PrFilterSchema, PullRequestConfigSchema, PullRequestInfoSchema } from "./github.schemas";

  export { StateSyncPort } from "./state-sync.port";
  export type { SyncReport } from "./state-sync.schemas";
  export { SyncReportSchema } from "./state-sync.schemas";
  ```
- [ ] Step 6: Run `npx vitest run src/kernel/infrastructure/console-logger.adapter.spec.ts`, verify PASS
- [ ] Step 7: Run `npx vitest run --typecheck` to confirm no type errors from port change
- [ ] Step 8: `git add src/kernel/ports/event-bus.port.ts src/kernel/ports/index.ts src/kernel/infrastructure/console-logger.adapter.ts src/kernel/infrastructure/console-logger.adapter.spec.ts && git commit -m "feat(S04/T02): modify EventBusPort, add ConsoleLoggerAdapter, update exports"`

---

## Wave 1 (depends on Wave 0)

### T03: InProcessEventBus + unit tests
**Files:** Create `src/kernel/infrastructure/in-process-event-bus.ts`, Create `src/kernel/infrastructure/in-process-event-bus.spec.ts`
**Depends on:** T01, T02
**Traces to:** AC1, AC2, AC3, AC4, AC5, AC6

- [ ] Step 1: Write failing tests in `src/kernel/infrastructure/in-process-event-bus.spec.ts`:
  ```typescript
  import { describe, expect, it } from "vitest";
  import { DomainEvent } from "@kernel/domain-event.base";
  import { EVENT_NAMES } from "@kernel/event-names";
  import type { EventName } from "@kernel/event-names";
  import { InProcessEventBus } from "./in-process-event-bus";
  import { SilentLoggerAdapter } from "./silent-logger.adapter";

  class TestEvent extends DomainEvent {
    readonly eventName: EventName = EVENT_NAMES.PROJECT_INITIALIZED;
    constructor(aggregateId: string) {
      super({ id: crypto.randomUUID(), aggregateId, occurredAt: new Date() });
    }
  }

  class OtherEvent extends DomainEvent {
    readonly eventName: EventName = EVENT_NAMES.TASK_COMPLETED;
    constructor(aggregateId: string) {
      super({ id: crypto.randomUUID(), aggregateId, occurredAt: new Date() });
    }
  }

  function createBus() {
    const logger = new SilentLoggerAdapter();
    const bus = new InProcessEventBus(logger);
    return { bus, logger };
  }

  describe("InProcessEventBus", () => {
    it("publishes event to subscribed handler", async () => {
      const { bus } = createBus();
      const received: DomainEvent[] = [];
      bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, async (event) => {
        received.push(event);
      });

      const event = new TestEvent(crypto.randomUUID());
      await bus.publish(event);
      expect(received).toHaveLength(1);
      expect(received[0]).toBe(event);
    });

    it("executes multiple handlers in subscription order", async () => {
      const { bus } = createBus();
      const order: number[] = [];
      bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, async () => { order.push(1); });
      bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, async () => { order.push(2); });
      bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, async () => { order.push(3); });

      await bus.publish(new TestEvent(crypto.randomUUID()));
      expect(order).toEqual([1, 2, 3]);
    });

    it("handler error does not prevent subsequent handlers", async () => {
      const { bus } = createBus();
      const received: string[] = [];
      bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, async () => { received.push("first"); });
      bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, async () => { throw new Error("boom"); });
      bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, async () => { received.push("third"); });

      await bus.publish(new TestEvent(crypto.randomUUID()));
      expect(received).toEqual(["first", "third"]);
    });

    it("handler error is logged with event context", async () => {
      const { bus, logger } = createBus();
      bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, async () => { throw new Error("handler broke"); });

      const event = new TestEvent(crypto.randomUUID());
      await bus.publish(event);

      const messages = logger.getMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].level).toBe("error");
      expect(messages[0].message).toBe("Event handler failed");
      expect(messages[0].context).toEqual({
        eventName: EVENT_NAMES.PROJECT_INITIALIZED,
        eventId: event.id,
        aggregateId: event.aggregateId,
        error: "handler broke",
      });
    });

    it("logs non-Error thrown values as strings", async () => {
      const { bus, logger } = createBus();
      bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, async () => { throw "string error"; });

      await bus.publish(new TestEvent(crypto.randomUUID()));

      const messages = logger.getMessages();
      expect(messages[0].context).toMatchObject({ error: "string error" });
    });

    it("no subscribers means no error", async () => {
      const { bus } = createBus();
      await expect(bus.publish(new TestEvent(crypto.randomUUID()))).resolves.toBeUndefined();
    });

    it("routes events to correct handlers by event type", async () => {
      const { bus } = createBus();
      const projectEvents: DomainEvent[] = [];
      const taskEvents: DomainEvent[] = [];
      bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, async (e) => { projectEvents.push(e); });
      bus.subscribe(EVENT_NAMES.TASK_COMPLETED, async (e) => { taskEvents.push(e); });

      await bus.publish(new TestEvent(crypto.randomUUID()));
      await bus.publish(new OtherEvent(crypto.randomUUID()));

      expect(projectEvents).toHaveLength(1);
      expect(taskEvents).toHaveLength(1);
    });

    it("handlers execute sequentially, not concurrently", async () => {
      const { bus } = createBus();
      let concurrent = 0;
      let maxConcurrent = 0;
      const handler = async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 10));
        concurrent--;
      };
      bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, handler);
      bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, handler);
      bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, handler);

      await bus.publish(new TestEvent(crypto.randomUUID()));
      expect(maxConcurrent).toBe(1);
    });
  });
  ```
- [ ] Step 2: Run `npx vitest run src/kernel/infrastructure/in-process-event-bus.spec.ts`, verify FAIL
- [ ] Step 3: Create `src/kernel/infrastructure/in-process-event-bus.ts`:
  ```typescript
  import type { DomainEvent } from "@kernel/domain-event.base";
  import type { EventName } from "@kernel/event-names";
  import { EventBusPort } from "@kernel/ports/event-bus.port";
  import type { LoggerPort } from "@kernel/ports/logger.port";

  export class InProcessEventBus extends EventBusPort {
    private handlers = new Map<EventName, Array<(event: DomainEvent) => Promise<void>>>();

    constructor(private readonly logger: LoggerPort) {
      super();
    }

    subscribe(
      eventType: EventName,
      handler: (event: DomainEvent) => Promise<void>,
    ): void {
      const existing = this.handlers.get(eventType) ?? [];
      existing.push(handler);
      this.handlers.set(eventType, existing);
    }

    async publish(event: DomainEvent): Promise<void> {
      const handlers = this.handlers.get(event.eventName) ?? [];
      for (const handler of handlers) {
        try {
          await handler(event);
        } catch (error: unknown) {
          this.logger.error("Event handler failed", {
            eventName: event.eventName,
            eventId: event.id,
            aggregateId: event.aggregateId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }
  ```
- [ ] Step 4: Run `npx vitest run src/kernel/infrastructure/in-process-event-bus.spec.ts`, verify PASS
- [ ] Step 5: `git add src/kernel/infrastructure/in-process-event-bus.ts src/kernel/infrastructure/in-process-event-bus.spec.ts && git commit -m "feat(S04/T03): add InProcessEventBus with sequential execution and error isolation"`

---

## Wave 2 (depends on Wave 1)

### T04: Integration test — aggregate to handler flow
**Files:** Create `src/kernel/infrastructure/event-bus-integration.spec.ts`
**Depends on:** T03
**Traces to:** AC10

- [ ] Step 1: Write integration test in `src/kernel/infrastructure/event-bus-integration.spec.ts`:
  ```typescript
  import { describe, expect, it } from "vitest";
  import { z } from "zod";
  import { AggregateRoot } from "@kernel/aggregate-root.base";
  import { DomainEvent } from "@kernel/domain-event.base";
  import { EVENT_NAMES } from "@kernel/event-names";
  import type { EventName } from "@kernel/event-names";
  import { InProcessEventBus } from "./in-process-event-bus";
  import { SilentLoggerAdapter } from "./silent-logger.adapter";

  const TestAggSchema = z.object({ id: z.uuid(), name: z.string() });
  type TestAggProps = z.infer<typeof TestAggSchema>;

  class ItemCreatedEvent extends DomainEvent {
    readonly eventName: EventName = EVENT_NAMES.PROJECT_INITIALIZED;
    constructor(aggregateId: string) {
      super({ id: crypto.randomUUID(), aggregateId, occurredAt: new Date() });
    }
  }

  class TestAggregate extends AggregateRoot<TestAggProps> {
    constructor(props: TestAggProps) {
      super(props, TestAggSchema);
    }

    get id(): string {
      return this.props.id;
    }

    doAction(): void {
      this.addEvent(new ItemCreatedEvent(this.id));
    }
  }

  describe("EventBus integration: aggregate -> publish -> handler", () => {
    it("events pulled from aggregate are dispatched through the bus", async () => {
      const logger = new SilentLoggerAdapter();
      const bus = new InProcessEventBus(logger);
      const received: DomainEvent[] = [];

      bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, async (event) => {
        received.push(event);
      });

      const aggregate = new TestAggregate({
        id: crypto.randomUUID(),
        name: "Test",
      });
      aggregate.doAction();
      aggregate.doAction();

      const events = aggregate.pullEvents();
      for (const event of events) {
        await bus.publish(event);
      }

      expect(received).toHaveLength(2);
      expect(received[0].aggregateId).toBe(aggregate.id);
      expect(received[1].aggregateId).toBe(aggregate.id);
    });

    it("handler error in integration flow does not lose remaining events", async () => {
      const logger = new SilentLoggerAdapter();
      const bus = new InProcessEventBus(logger);
      const received: DomainEvent[] = [];

      bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, async () => {
        throw new Error("handler failure");
      });
      bus.subscribe(EVENT_NAMES.PROJECT_INITIALIZED, async (event) => {
        received.push(event);
      });

      const aggregate = new TestAggregate({
        id: crypto.randomUUID(),
        name: "Test",
      });
      aggregate.doAction();

      const events = aggregate.pullEvents();
      for (const event of events) {
        await bus.publish(event);
      }

      expect(received).toHaveLength(1);
      expect(logger.getMessages()).toHaveLength(1);
    });
  });
  ```
- [ ] Step 2: Run `npx vitest run src/kernel/infrastructure/event-bus-integration.spec.ts`, verify PASS (all deps already built)
- [ ] Step 3: `git add src/kernel/infrastructure/event-bus-integration.spec.ts && git commit -m "test(S04/T04): add event bus integration test with aggregate flow"`

### T05: Barrel exports + kernel index update + full verification
**Files:** Create `src/kernel/infrastructure/index.ts`, Modify `src/kernel/index.ts`
**Depends on:** T01, T02, T03, T04
**Traces to:** all ACs

- [ ] Step 1: Create `src/kernel/infrastructure/index.ts`:
  ```typescript
  export { ConsoleLoggerAdapter } from "./console-logger.adapter";
  export { InProcessEventBus } from "./in-process-event-bus";
  export { SilentLoggerAdapter } from "./silent-logger.adapter";
  ```
- [ ] Step 2: Update `src/kernel/index.ts` — add LoggerPort and infrastructure exports:
  ```typescript
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
  export {
    ConsoleLoggerAdapter,
    InProcessEventBus,
    SilentLoggerAdapter,
  } from "./infrastructure";
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
    LoggerPort,
    PrFilterSchema,
    PullRequestConfigSchema,
    PullRequestInfoSchema,
    StateSyncPort,
    SyncReportSchema,
  } from "./ports";
  export type { Result } from "./result";
  export { err, isErr, isOk, match, ok } from "./result";
  export type { ComplexityTier, Id, Timestamp } from "./schemas";
  export { ComplexityTierSchema, IdSchema, TimestampSchema } from "./schemas";
  export { ValueObject } from "./value-object.base";
  ```
- [ ] Step 3: Run full test suite: `npx vitest run src/kernel/`
- [ ] Step 4: Run lint: `npx biome check src/kernel/`
- [ ] Step 5: Run typecheck: `npx tsc --noEmit`
- [ ] Step 6: `git add src/kernel/infrastructure/index.ts src/kernel/index.ts && git commit -m "feat(S04/T05): add barrel exports and verify event bus implementation"`
