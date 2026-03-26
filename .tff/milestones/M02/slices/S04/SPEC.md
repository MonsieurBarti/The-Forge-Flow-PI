# M02-S04: EventBus Implementation

## Problem

The architecture requires fire-and-forget cross-hexagon communication via domain events. Aggregates already produce events (`AggregateRoot.pullEvents()`), 12 event types are defined in `EVENT_NAMES`, and the `EventBusPort` contract exists in kernel — but there is no implementation. Without an event bus, hexagons cannot react to state changes in other hexagons.

## Approach

Implement `InProcessEventBus` in `src/kernel/infrastructure/` as a simple in-memory pub/sub adapter. Introduce a `LoggerPort` in kernel for error isolation (handlers that throw are logged, not rethrown). The port's `subscribe()` generic is removed in favor of plain `DomainEvent` handlers with `instanceof` type guards at the consumer — this eliminates `as` casts and is zero-overhead at runtime.

## File Structure

```
src/kernel/
  ports/
    logger.port.ts                        # NEW
    event-bus.port.ts                     # MODIFY — remove generic from subscribe()
    index.ts                              # UPDATE — add LoggerPort export
  infrastructure/
    in-process-event-bus.ts               # NEW
    in-process-event-bus.spec.ts          # NEW
    console-logger.adapter.ts             # NEW
    silent-logger.adapter.ts              # NEW
    silent-logger.adapter.spec.ts         # NEW
    event-bus-integration.spec.ts         # NEW — aggregate-to-handler flow
    index.ts                              # NEW — barrel
  index.ts                                # UPDATE — add new exports
```

## Components

### LoggerPort

```typescript
// src/kernel/ports/logger.port.ts
export abstract class LoggerPort {
  abstract error(message: string, context?: Record<string, unknown>): void;
  abstract warn(message: string, context?: Record<string, unknown>): void;
  abstract info(message: string, context?: Record<string, unknown>): void;
  abstract debug(message: string, context?: Record<string, unknown>): void;
}
```

Synchronous methods. Structured context via `Record<string, unknown>`. Four levels: error, warn, info, debug.

### EventBusPort (modified)

Remove the generic from `subscribe()`:

```typescript
// src/kernel/ports/event-bus.port.ts
export abstract class EventBusPort {
  abstract publish(event: DomainEvent): Promise<void>;
  abstract subscribe(
    eventType: EventName,
    handler: (event: DomainEvent) => Promise<void>,
  ): void;
}
```

### InProcessEventBus

```typescript
// src/kernel/infrastructure/in-process-event-bus.ts
export class InProcessEventBus extends EventBusPort {
  private handlers = new Map<EventName, Array<(event: DomainEvent) => Promise<void>>>();

  constructor(private readonly logger: LoggerPort) { super(); }

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

Key behaviors:
- Sequential execution via `for...of` with `await`
- Error isolation: try/catch per handler, log via LoggerPort, continue to next
- No `as` casts anywhere
- Append-only handler registration (no unsubscribe)

### ConsoleLoggerAdapter

Wraps `console.error/warn/info/debug`. Production use.

### SilentLoggerAdapter

No-op by default. Captures messages in an internal array for test assertions via `getMessages()` and `reset()`.

## Acceptance Criteria

1. `InProcessEventBus` extends `EventBusPort` with publish + subscribe
2. Handlers execute sequentially in subscription order (not concurrent)
3. Unhandled errors in handlers are logged via `LoggerPort` and don't crash the bus — remaining handlers still execute
4. Type-safe subscriptions using `EVENT_NAMES` constants
5. Multiple handlers per event type are supported and execute in registration order
6. Events with no subscribers are silently ignored (no error)
7. `LoggerPort` defined with error/warn/info/debug + optional structured context
8. `ConsoleLoggerAdapter` and `SilentLoggerAdapter` provided
9. Port change: remove generic from `subscribe()` signature
10. Integration test: aggregate produces events, bus dispatches them to handler

## Non-Goals

- No async/concurrent handler execution
- No event replay or persistence
- No wildcard/catch-all subscriptions
- No unsubscribe mechanism
- No middleware or interceptor chain
- No event ordering guarantees across different event types
