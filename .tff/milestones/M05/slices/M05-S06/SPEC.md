# M05-S06: Agent Authoring Protocol

## Problem

The agent registry (`agent-registry.ts`) stores 5 agents as hardcoded TypeScript data structures. R06 requires agents be identity-only (<=30 lines), all methodology in skills, with a standardized template. Current state:

- `AgentCard` schema lacks: identity statement, purpose, scope, skills (prompt + strategy bundles), freshReviewerRule
- No validation that agent definitions stay identity-only (methodology can creep in)
- No declarative format -- adding/modifying agents requires editing TypeScript code
- No enforcement test -- protocol violations undetectable until runtime

## Scope

### In Scope
- Markdown frontmatter agent resource files (`*.agent.md`) in `src/resources/agents/`
- Extended `AgentCardSchema` with identity, purpose, scope, skills, freshReviewerRule
- `AgentSkillSchema`: named bundles of prompt template + review strategy
- `AgentValidationService` -- domain service enforcing protocol constraints
- `AgentResourceLoader` -- infrastructure, parses `.agent.md` -> `AgentCard`, fail-fast
- `AgentRegistry` refactored from static map -> class with `loadFromResources()` + `get(type)`
- `createAgentTemplate()` -- pure scaffolding function generating valid `.agent.md` content
- Boundary enforcement test -- structural scan of all agent files
- Migration of 5 existing agents to resource files
- Error types: `AgentValidationError`, `AgentLoadError`, `AgentRegistryError`

### Out of Scope
- CLI `create-agent` command (just the pure function)
- Hot-reload of agent files (load once at startup)
- Agent versioning or migration tooling
- Changes to `ConductReviewUseCase` logic
- Changes to `AgentDispatchPort` interface

## Approach

**B: Markdown frontmatter files** -- agent definitions as `.agent.md` files with YAML frontmatter (metadata) + markdown body (identity statement). Hybrid loader reads files -> in-memory registry cache -> dispatch queries registry unchanged.

Rationale: aligns with existing `src/resources/prompts/` pattern. Body is natural for identity statements. Markdown easy to scan for boundary violations. Declarative, non-code format prevents methodology creep.

## Architecture

### Agent Resource Format

Location: `src/resources/agents/<type>.agent.md`

Frontmatter (YAML):

| Field | Type | Required | Description |
|---|---|---|---|
| type | `AgentType` | yes | Unique agent identifier |
| displayName | `string` | yes | Human-readable name |
| purpose | `string` | yes | One-line mission statement |
| scope | `'slice' \| 'task'` | yes | Operating unit |
| freshReviewerRule | `'must-not-be-executor' \| 'none'` | yes | Self-review constraint |
| modelProfile | `'quality' \| 'balanced' \| 'budget'` | yes | Model tier |
| skills | `AgentSkill[]` | yes | Prompt + strategy bundles |
| requiredTools | `string[]` | yes | Tools the agent must have |
| optionalTools | `string[]` | no | Tools used if available |
| capabilities | `AgentCapability[]` | yes | `review \| fix \| execute` |

**AgentSkill**: `{ name: string, prompt: string (relative to src/resources/), strategy: 'critique-then-reflection' | 'standard' }`

Body: identity statement. Plain text, <=30 lines. No methodology, no instructions, no tool usage patterns. Only: who am I, what do I value, how do I think.

Example:

```markdown
---
type: code-reviewer
displayName: Code Reviewer
purpose: Review code changes for quality
scope: slice
freshReviewerRule: must-not-be-executor
modelProfile: quality
skills:
  - name: critique-then-reflection
    prompt: prompts/critique-then-reflection.md
    strategy: critique-then-reflection
requiredTools: [Read, Glob, Grep]
capabilities: [review]
---

You are a senior code reviewer focused on
patterns, YAGNI, tests, and readability.
```

### Extended AgentCard Schema

`AgentCardSchema` (Zod) extends current fields:

```
AgentCardSchema:
  type: AgentTypeSchema (existing enum)
  displayName: z.string()
  description: z.string()                  -- existing; derived from purpose by loader
  identity: z.string()                     -- NEW: body text from .agent.md
  purpose: z.string()                      -- NEW: one-line mission (canonical)
  scope: z.enum(['slice', 'task'])         -- NEW
  freshReviewerRule: z.enum(['must-not-be-executor', 'none'])  -- NEW
  defaultModelProfile: ModelProfileNameSchema  -- existing field name preserved
  skills: z.array(AgentSkillSchema)        -- NEW: replaces loose prompt refs
  capabilities: z.array(AgentCapabilitySchema)  -- existing
  requiredTools: z.array(z.string())       -- existing
  optionalTools: z.array(z.string()).default([])  -- existing
```

**Field mapping**: The `.agent.md` frontmatter uses `modelProfile` (short form). The loader maps `modelProfile` -> `defaultModelProfile` on the `AgentCard` type. This preserves the existing field name consumed by `ConductReviewUseCase` and all other downstream code — zero rename required.

**`description` derivation**: `description` is NOT in the frontmatter. The loader sets `description = purpose`. The `purpose` field is the canonical one-line mission; `description` exists only for backward compatibility with existing consumers.

`AgentSkillSchema`:
```
  name: z.string()
  prompt: z.string()        -- relative path to prompt template
  strategy: z.enum(['critique-then-reflection', 'standard'])
```

### AgentValidationService

Domain service in `@kernel/agents/`. Pure function, no I/O.

```
validate(card: AgentCard): Result<AgentCard, AgentValidationError>
```

Rules:
1. Identity body <=30 lines
2. Identity body passes hard blocklist (no methodology keywords)
3. All required fields present (Zod handles via schema)
4. Review-capable agents (`capabilities` includes `review`) must have `freshReviewerRule: 'must-not-be-executor'`
5. Non-review agents must have `freshReviewerRule: 'none'` (semantically meaningless otherwise)
6. At least one skill declared

**Migration values** for 5 existing agents:
- spec-reviewer: `must-not-be-executor` (review)
- code-reviewer: `must-not-be-executor` (review)
- security-auditor: `must-not-be-executor` (review)
- fixer: `none` (fix)
- executor: `none` (execute)

Blocklist patterns (regex, case-sensitive, targeting instructional/code syntax):
- Instructional: `\bstep \d`, `\byou must\b`, `\byou should\b`, `\byou will\b`, `\byou need to\b`
- Code (syntax-specific, not English words): `^import `, `\brequire\(`, `\bfunction\s+\w+`, `\bclass\s+[A-Z]`, `^export `, `\bconst\s+\w+\s*=`, `\blet\s+\w+\s*=`, `\bvar\s+\w+\s*=`, `\bif\s*\(`, `\bfor\s*\(`, `\bwhile\s*\(`, `\breturn\s+[^.]*;`, `=>\s*\{`

Patterns use word boundaries (`\b`) and syntax-specific context to avoid matching natural English (e.g., "world-class" won't match `\bclass\s+[A-Z]`, "important" won't match `^import `). All patterns are case-sensitive. `always`/`never` intentionally excluded -- they appear naturally in identity-voice.

Returns: `Ok(card)` on pass, `Err(AgentValidationError)` with `violations[]` on failure.

### AgentResourceLoader

Infrastructure in `@kernel/agents/`. Depends on filesystem.

```
loadAll(resourceDir: string): Result<Map<AgentType, AgentCard>, AgentLoadError>
```

Flow:
1. Glob `*.agent.md` in `resourceDir/agents/`
2. For each file: parse YAML frontmatter + body via thin `parseFrontmatter()` utility (split on `---` delimiters, parse YAML with existing `yaml` package, capture remainder as body)
3. Map frontmatter + body -> `AgentCard` via Zod schema
4. Run `AgentValidationService.validate()` on each card
5. Validate skill prompt files exist at `resourceDir/<skill.prompt>`
6. **Collect-all**: validate all files, collect all errors into a single `Err(AgentLoadError)` with per-file causes (5 files is small enough to report all at once -- better DX than fix-one-rerun-fix-next)
7. Check for duplicate types -> add to error collection
8. If any errors -> `Err(AgentLoadError)` with full array; else `Ok(Map<AgentType, AgentCard>)`

### AgentRegistry (Refactored)

From: `AGENT_REGISTRY: ReadonlyMap<AgentType, AgentCard>` (hardcoded)
To: class with loader integration.

```
class AgentRegistry:
  private cards: ReadonlyMap<AgentType, AgentCard>

  static loadFromResources(loader: AgentResourceLoader, dir: string):
    Result<AgentRegistry, AgentLoadError>

  static fromCards(cards: Map<AgentType, AgentCard>): AgentRegistry
    -- for tests (no filesystem)

  get(type: AgentType): AgentCard | undefined
  getAll(): ReadonlyMap<AgentType, AgentCard>
  has(type: AgentType): boolean
```

`AgentDispatchPort` queries registry via `get()` -- same interface as `AGENT_REGISTRY.get()`. No downstream changes.

### Agent Template Scaffolding

Pure function in `@kernel/agents/agent-template.ts`:

```
createAgentTemplate(type: AgentType, options: CreateAgentOptions): string
```

`CreateAgentOptions`:
```
  displayName: string
  purpose: string
  scope: 'slice' | 'task'
  capabilities: AgentCapability[]
  modelProfile: ModelProfileName
  freshReviewerRule: 'must-not-be-executor' | 'none'
  skills?: AgentSkill[]
  identity?: string  -- default: placeholder text
```

Output: valid `.agent.md` content that passes `AgentValidationService.validate()` by construction.

### Strategy Resolution

Current: `ConductReviewUseCase.strategyForRole()` hardcodes role -> strategy mapping.
After S06: `AgentCard.skills[0].strategy` carries this information declaratively.

**No changes to ConductReviewUseCase in this slice** -- the mapping data is now available on the card for future refactoring. S06 makes the data available; a future slice can consume it.

### Backward Compatibility

Current consumers use module-level functions: `getAgentCard(type)`, `findAgentsByCapability(cap)`, and `AGENT_REGISTRY` (map).

After refactor, `agent-registry.ts` exports:
- `AgentRegistry` class (new primary API)
- `getAgentCard(type)` -- thin wrapper: delegates to singleton registry instance (preserves existing call sites)
- `findAgentsByCapability(cap)` -- thin wrapper: delegates to singleton
- `AGENT_REGISTRY` -- getter property returning `registry.getAll()` (preserves import for tests)

Singleton initialized via `initializeAgentRegistry(loader, dir)` called once at startup in `src/cli/extension.ts` (the composition root, consistent with S05's ReviewUIPort wiring). Before initialization, `getAgentCard()` throws `AgentRegistryError.notLoaded()`.

**Throw-vs-Result**: `getAgentCard()` preserves its existing throw behavior for backward compat (it already throws today). The `AgentRegistryError` type is Result-based when used through the `AgentRegistry` class API (`loadFromResources()` returns `Result`). Module-level wrappers (`getAgentCard`, `findAgentsByCapability`) throw for backward compat.

**Startup ordering** in `extension.ts`:
1. `initializeAgentRegistry(resourceDir)` -- first, before any use-case or tool construction
2. Use-case construction (ConductReviewUseCase, etc.) -- safe to call `getAgentCard()` at runtime
3. Tool factory wiring

**Test helper**: `AgentRegistry.fromCards()` additionally wires the module-level singleton, so tests using `fromCards()` also make `getAgentCard()` and `findAgentsByCapability()` work without filesystem I/O. A `resetAgentRegistry()` function is exported for test teardown (clears singleton). Existing test files (`agent-registry.spec.ts`, `agent-card.schema.spec.ts`) must be updated to use `fromCards()` setup -- this is explicitly in scope.

This means **zero changes** to `ConductReviewUseCase` or any other consumer. Existing imports and call signatures are preserved.

### Directory Structure

```
src/
  resources/
    agents/                                  -- NEW directory
      spec-reviewer.agent.md                 -- migrated
      code-reviewer.agent.md                 -- migrated
      security-auditor.agent.md              -- migrated
      fixer.agent.md                         -- migrated
      executor.agent.md                      -- migrated
  kernel/
    agents/
      agent-card.schema.ts                   -- MODIFIED (extend)
      agent-registry.ts                      -- REFACTORED (class)
      agent-validation.service.ts            -- NEW
      agent-resource-loader.ts               -- NEW
      agent-template.ts                      -- NEW
      agent-errors.ts                        -- NEW
      index.ts                               -- MODIFIED (exports)
      __tests__/
        agent-card.schema.spec.ts            -- MODIFIED (use fromCards setup)
        agent-registry.spec.ts               -- MODIFIED (use fromCards setup)
        agent-validation.service.test.ts     -- NEW
        agent-resource-loader.test.ts        -- NEW
        agent-template.test.ts               -- NEW
        agent-boundary.test.ts               -- NEW (structural)
```

## Error Handling

| Error | Extends | Factory Methods | When |
|---|---|---|---|
| `AgentValidationError` | `BaseDomainError` | `identityTooLong(lines)`, `methodologyDetected(matches)`, `missingFreshReviewerRule(type)`, `noSkillsDeclared(type)` | Validation fails |
| `AgentLoadError` | `BaseDomainError` | `parseError(filePath, cause)`, `promptNotFound(filePath, promptPath)`, `duplicateType(type, files)`, `noAgentFiles(dir)` | Loader fails |
| `AgentRegistryError` | `BaseDomainError` | `notLoaded()`, `agentNotFound(type)` | Registry query fails |

All errors: Result-based, never thrown.

## Testing Strategy

| Layer | Target | Method |
|---|---|---|
| Unit | `AgentValidationService` | Valid cards pass, blocklist rejects methodology, line-count enforced, review agents require fresh-reviewer rule |
| Unit | `AgentResourceLoader` | Parse valid `.agent.md`, reject malformed YAML, reject missing prompt files, reject duplicates, fail-fast on first error |
| Unit | `createAgentTemplate` | Output passes validation, all fields populated, placeholder identity when none provided |
| Structural | `agent-boundary.test.ts` | Scan all `src/resources/agents/*.agent.md`: parse succeeds, identity <=30 lines, no methodology, prompts exist |
| Structural | `agent-boundary.test.ts` | Migration guard: all 5 existing agents present and valid |
| Integration | `AgentRegistry.loadFromResources()` | All 5 agents load from real files, `get()` resolves each type, `has()` returns correct booleans |

## Acceptance Criteria

- **AC1**: 5 agent resource files (spec-reviewer, code-reviewer, security-auditor, fixer, executor `.agent.md`) exist in `src/resources/agents/`, each parses via `AgentResourceLoader` and passes `AgentValidationService.validate()`
- **AC2**: `AgentCardSchema` rejects input missing any of: identity, purpose, scope, skills, freshReviewerRule; retains `defaultModelProfile` field name for backward compat; accepts fully populated card with all new + existing fields
- **AC3**: `AgentSkillSchema` rejects input missing name, prompt, or strategy; rejects strategy values other than `'critique-then-reflection'` or `'standard'`; accepts `{ name: string, prompt: string, strategy: 'critique-then-reflection' | 'standard' }`
- **AC4**: `AgentValidationService.validate()` returns `Err` for identity >30 lines
- **AC5**: `AgentValidationService.validate()` returns `Err` when methodology keywords detected in identity (blocklist defined in spec)
- **AC6**: `AgentValidationService.validate()` returns `Err` when review-capable agent lacks `must-not-be-executor` rule
- **AC7**: `AgentResourceLoader.loadAll()` parses all 5 `.agent.md` files into valid `AgentCard` instances (returns `Ok` with map of size 5)
- **AC8**: `AgentResourceLoader.loadAll()` collects all validation errors across all files and returns `Err(AgentLoadError)` with per-file causes (not fail-fast)
- **AC9**: `AgentResourceLoader.loadAll()` returns `Err` when skill references nonexistent prompt file
- **AC10**: `AgentRegistry.loadFromResources()` returns `Ok(AgentRegistry)` for valid resource directory; resulting registry returns correct `AgentCard` for each of 5 `AgentType` values via `get(type)` and returns `true` for each via `has(type)`
- **AC11**: `AgentRegistry.fromCards()` allows test construction without filesystem
- **AC12**: `createAgentTemplate()` produces `.agent.md` content that passes `AgentValidationService.validate()`
- **AC13**: Boundary enforcement test scans all `src/resources/agents/*.agent.md` files: parse succeeds, identity <=30 lines, no methodology keywords, prompt files exist
- **AC14**: Migration guard test asserts all 5 agents (spec-reviewer, code-reviewer, security-auditor, fixer, executor) present and valid
- **AC15a**: `AgentDispatchPort` abstract method signatures (dispatch, abort, isRunning) are identical before and after this slice
- **AC15b**: `getAgentCard()` and `findAgentsByCapability()` module-level functions preserved; `ConductReviewUseCase` compiles and its existing tests pass without modification
- **AC16**: `AgentValidationError`, `AgentLoadError`, `AgentRegistryError` each extend `BaseDomainError`, declare domain-prefixed `code`, and expose exactly the factory methods listed in the Error Handling table with typed parameters

## Dependencies

- M05-S01 (Review entity + schemas) -- `AgentCapability`, `BaseDomainError` pattern
- `@kernel/agents/` -- existing `AgentCard`, `AgentType`, `AgentDispatchPort`
- `yaml` npm package -- already installed (v2.8.3), used for frontmatter parsing via thin `parseFrontmatter()` utility

## Non-Goals

- CLI `create-agent` command
- Hot-reload of agent files
- Agent versioning or migration tooling
- Changes to `ConductReviewUseCase` (reads registry same as before)
- Changes to `AgentDispatchPort` interface
- Runtime strategy resolution from `AgentCard.skills` (data available, consumption deferred)
