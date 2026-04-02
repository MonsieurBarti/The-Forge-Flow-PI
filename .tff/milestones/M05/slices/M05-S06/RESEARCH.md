# M05-S06 Research: Agent Authoring Protocol

## 1. Existing Agent System

### AgentCard Schema (`src/kernel/agents/agent-card.schema.ts`)
- Zod enums: `AgentTypeSchema` (5 values), `AgentCapabilitySchema` (3 values)
- `ModelProfileNameSchema` from `@kernel/schemas` (quality, balanced, budget)
- Current fields: type, displayName, description, capabilities, defaultModelProfile, requiredTools, optionalTools

### Registry (`src/kernel/agents/agent-registry.ts`)
- `AGENT_REGISTRY: ReadonlyMap<AgentType, AgentCard>` — hardcoded static map
- `getAgentCard(type)` — throws on miss (NOT Result-based)
- `findAgentsByCapability(cap)` — returns `AgentCard[]`
- Both exported from `@kernel/agents/index.ts` and `@kernel/index.ts`

### Consumers
- `ConductReviewUseCase` (line 379): `const card = getAgentCard(role)` → uses `card.defaultModelProfile` + `card.requiredTools`
- `context-package.helpers.ts`: `PHASE_AGENT_MAP` maps workflow phases → agent types
- `ReviewRole` in `review.schemas.ts` = subset of `AgentType` (review agents only)

### Test Patterns
- `agent-registry.spec.ts`: Tests registry integrity (every enum has entry, no extras), getAgentCard, findAgentsByCapability
- `agent-card.schema.spec.ts`: Tests schema parse/reject with literal object inputs
- Builder pattern: `AgentDispatchConfigBuilder`, `AgentResultBuilder` with `faker` defaults

## 2. Error Handling Patterns

### BaseDomainError (`src/kernel/errors/base-domain.error.ts`)
```
abstract class BaseDomainError extends Error
  abstract readonly code: string
  readonly metadata?: Record<string, unknown>
  constructor(message, metadata?)
```

### Error Factory Pattern (from ConductReviewError)
```
private constructor(code, message, metadata?)
static contextResolutionFailed(sliceId, cause): Error
static allReviewersFailed(sliceId, failures): Error
```

### Code Convention: `DOMAIN.SPECIFIC_ERROR`
- Review: `REVIEW.CONTEXT_RESOLUTION_FAILED`, `REVIEW.FRESH_REVIEWER_VIOLATION`
- Execution: `EXECUTION.NO_TASKS`, `WORKTREE.CREATION_FAILED`
- For S06: `AGENT.VALIDATION_FAILED`, `AGENT.LOAD_ERROR`, `AGENT.REGISTRY_ERROR`

### Result Type (`src/kernel/result.ts`)
- Custom discriminated union: `{ ok: true, data: T } | { ok: false, error: E }`
- Helpers: `ok()`, `err()`, `isOk()`, `isErr()`, `match()`

## 3. YAML & Resource Loading

### yaml Package
- Already installed: `yaml@2.8.3` (YAML 1.2)
- Used in: `LoadSettingsUseCase` (`parse`), `InitProjectUseCase` (`stringify`)
- Import pattern: `import { parse as parseYaml } from "yaml"`

### Resource Utilities (`src/resources/index.ts`)
```
const RESOURCES_DIR = import.meta.dirname
resourcePath(relativePath): string  // join(RESOURCES_DIR, rel)
loadResource(relativePath): string  // readFileSync(resourcePath(rel), "utf-8")
```
- Synchronous FS reads
- Uses `import.meta.dirname` (ESM)

### Template Loading in Composition Root (`extension.ts`)
```
const templateLoader = (path: string) =>
  readFileSync(join(options.projectRoot, "src/resources", path), "utf-8")
```
Injected into `ReviewPromptBuilder` via constructor.

### Frontmatter Strategy
- No `gray-matter` needed — thin `parseFrontmatter()`:
  1. Split on `---` delimiters (regex: `/^---\s*\n/m`)
  2. Parse YAML block with existing `yaml` package
  3. Capture remainder as body
  4. ~10 lines of code

## 4. Strategy Resolution

### Current: Hardcoded in review-strategy.ts
```
ROLE_STRATEGY_MAP: Record<ReviewRole, ReviewStrategy> = {
  "code-reviewer": "critique-then-reflection",
  "security-auditor": "critique-then-reflection",
  "spec-reviewer": "standard",
}
```
- `ReviewStrategySchema = z.enum(["standard", "critique-then-reflection"])`
- S06 makes this data available on `AgentCard.skills[].strategy` but does NOT change consumers

## 5. Composition Root (`src/cli/extension.ts`)

### Current Wiring Order
1. Logger, event bus setup
2. Repository construction
3. Port adapters (Git, beads, etc.)
4. Domain services (FreshReviewerService, CritiqueReflectionService)
5. Template loader → ReviewPromptBuilder
6. Model resolver
7. Use case construction (ConductReviewUseCase)
8. Tool factories

### S06 Insertion Point
Insert `initializeAgentRegistry()` early — after logger/eventBus, before any use-case construction. `getAgentCard()` is called at runtime (not construction time), so safe as long as registry is loaded before first review execution.

## 6. Implementation Findings

### Key Decisions Confirmed
1. **parseFrontmatter()** — trivial utility, no external dep needed
2. **Singleton + wrapper functions** — `getAgentCard`/`findAgentsByCapability` delegate to singleton, preserving all call sites
3. **`fromCards()` wires singleton** — test helper that also sets module-level singleton, enabling existing tests to work with `beforeEach` setup
4. **Error codes**: `AGENT.IDENTITY_TOO_LONG`, `AGENT.METHODOLOGY_DETECTED`, `AGENT.MISSING_FRESH_REVIEWER_RULE`, `AGENT.NO_SKILLS`, `AGENT.PARSE_ERROR`, `AGENT.PROMPT_NOT_FOUND`, `AGENT.DUPLICATE_TYPE`, `AGENT.NO_AGENT_FILES`, `AGENT.NOT_LOADED`, `AGENT.NOT_FOUND`
5. **modelProfile → defaultModelProfile** mapping in loader (not schema rename)
6. **description = purpose** in loader (not in frontmatter)

### Files to Modify (Existing)
| File | Change |
|---|---|
| `src/kernel/agents/agent-card.schema.ts` | Add identity, purpose, scope, skills, freshReviewerRule fields |
| `src/kernel/agents/agent-registry.ts` | Refactor to class + singleton + wrapper functions |
| `src/kernel/agents/index.ts` | Export new types, classes, functions |
| `src/kernel/index.ts` | Export new types |
| `src/kernel/agents/agent-card.schema.spec.ts` | Update tests for new required fields |
| `src/kernel/agents/agent-registry.spec.ts` | Use `fromCards()` setup, test new class API |
| `src/cli/extension.ts` | Add `initializeAgentRegistry()` call |

### Files to Create
| File | Purpose |
|---|---|
| `src/resources/agents/spec-reviewer.agent.md` | Migrated agent definition |
| `src/resources/agents/code-reviewer.agent.md` | Migrated agent definition |
| `src/resources/agents/security-auditor.agent.md` | Migrated agent definition |
| `src/resources/agents/fixer.agent.md` | Migrated agent definition |
| `src/resources/agents/executor.agent.md` | Migrated agent definition |
| `src/kernel/agents/agent-validation.service.ts` | Validation domain service |
| `src/kernel/agents/agent-resource-loader.ts` | File-based loader |
| `src/kernel/agents/agent-template.ts` | Scaffolding function |
| `src/kernel/agents/agent-errors.ts` | Error types |
| `src/kernel/agents/agent-validation.service.test.ts` | Unit tests |
| `src/kernel/agents/agent-resource-loader.test.ts` | Unit tests |
| `src/kernel/agents/agent-template.test.ts` | Unit tests |
| `src/kernel/agents/agent-boundary.test.ts` | Structural enforcement |

### Risks Mitigated
- **YAML version**: Using existing `yaml@2.8.3` (YAML 1.2), consistent with settings loading
- **Singleton timing**: Registry loaded in extension.ts before any use-case construction
- **Test breakage**: `fromCards()` wires singleton; `resetAgentRegistry()` for teardown
- **Field rename**: No rename — loader maps `modelProfile` → `defaultModelProfile`
- **Strategy naming**: Using canonical `'critique-then-reflection'` / `'standard'` from ReviewStrategySchema
