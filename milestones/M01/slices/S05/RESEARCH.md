# M01-S05 Research: Project Hexagon

## Kernel Integration Points

### Base Classes Used

| Kernel Export | Usage in S05 | Import Path |
|---|---|---|
| `AggregateRoot<TProps>` | `Project` extends this | `@kernel/aggregate-root.base` |
| `DomainEvent` | `ProjectInitializedEvent` extends this | `@kernel/domain-event.base` |
| `DomainEventPropsSchema` | Event constructor validation | `@kernel/domain-event.base` |
| `IdSchema`, `TimestampSchema` | `ProjectPropsSchema` fields | `@kernel/schemas` |
| `Id`, `Timestamp` | Type aliases for props | `@kernel/schemas` |
| `EventName`, `EVENT_NAMES` | Event name constant | `@kernel/event-names` |
| `Result`, `ok`, `err` | Repository return types | `@kernel/result` |
| `PersistenceError` | Repository error type | `@kernel/errors` |

All imports available via `@kernel` barrel (`src/kernel/index.ts`). No missing exports.

### Entity/AggregateRoot Constructor Pattern

`Entity<TProps>` takes `(props, schema)` in its protected constructor and calls `schema.parse(props)`. This means:
- `Project` constructor passes `ProjectPropsSchema` to super
- Zod validation happens at construction time — invalid props throw `ZodError`
- `reconstitute()` can reuse the same constructor (throws on invalid = programming error, per spec)
- `toJSON()` returns a shallow copy of props (`{ ...this.props }`)

### DomainEvent Construction

`DomainEvent` constructor takes `DomainEventProps` (id, aggregateId, occurredAt, optional correlationId/causationId). The `eventName` is an abstract readonly field — subclass sets it as a property.

Pattern from tests:
```typescript
class ProjectInitializedEvent extends DomainEvent {
  readonly eventName = EVENT_NAMES.PROJECT_INITIALIZED;
}
```

### AggregateRoot Event API

- `addEvent(event)` — protected, called inside business methods
- `pullEvents()` — public, returns and clears the event list

## Decisions & Observations

### 1. No `.js` extensions in imports
`tsconfig.json` uses `moduleResolution: "Bundler"` — imports use bare specifiers without `.js`.

### 2. Path aliases available
`@kernel/*`, `@hexagons/*`, `@infrastructure/*` — both in tsconfig and vitest config.

### 3. Biome import boundary enforcement
`biome.json` already has `noRestrictedImports` blocking `@hexagons/project/*` (deep imports). The barrel at `src/hexagons/project/index.ts` is the only legal entry point for external consumers.

### 4. Test conventions (from kernel specs)
- `describe/expect/it` from vitest (not globals)
- `crypto.randomUUID()` for test IDs
- Colocated specs (`*.spec.ts` next to source)
- No test helpers directory — each test file is self-contained

### 5. Faker available
`@faker-js/faker` is in devDependencies — use for `ProjectBuilder` defaults.

### 6. SQLite stub approach
`better-sqlite3` is in devDependencies. The stub just needs the correct class shape with methods throwing `"Not implemented"`. No actual DB wiring needed.

### 7. Zod v4
`zod: ^4.3.6` — uses `z.uuid()` (not `z.string().uuid()`). Confirmed in `schemas.ts`.

## Risks & Unknowns

**None identified.** This is a straightforward hexagon build on well-established kernel primitives. The spec is detailed and all dependencies are in place.

## Conclusion

Ready to plan. All kernel dependencies exist and are exported. The patterns are clear from the existing test suite. No investigation or spikes needed.
