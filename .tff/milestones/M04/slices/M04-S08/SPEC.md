# M04-S08: Output Safety Guardrails

## Problem

Agents dispatched by the wave engine run with full filesystem access in their worktree. A misbehaving agent could: delete critical files, expose secrets, modify files outside its task scope, or inject malicious patterns. Currently there is no validation between agent completion and checkpoint recording.

## Goal

Defense-in-depth output safety:
1. **Prompt prevention** — instruct agents about forbidden patterns (soft guardrail)
2. **Post-execution validation** — inspect agent output before recording success (hard guardrail)

## Requirement Coverage

- **R08**: Pre-apply validation, dangerous pattern detection, scope enforcement

## Architecture Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Pattern | Port + Validator (Strategy) | Clean hexagonal separation, testable rules, composable |
| Rule execution | Sync pure functions | Adapter handles I/O (file reads); rules are deterministic |
| Severity model | Configurable per-rule | error = block + revert, warning = attach concern, info = log |
| Prompt injection | Defense-in-depth | Reduces violations; post-execution catches what slips through |
| File content access | Adapter enriches context | Port contract stays I/O-free; adapter reads worktree files |
| File scope severity | Default warning, not error | R08 requirement says "block" but R08 AC says "flagged for human review". Warning aligns with AC. Configurable to error via settings.yaml if blocking is desired. |
| Changed file discovery | Adapter computes git diff | `agentResult.filesChanged` is currently empty (PI adapter defers). Adapter runs `GitPort.diffNameOnly()` in worktree to discover changed files. |
| Revert mechanism | `GitPort.restoreWorktree()` | On guardrail block, restore tracked file changes via `git restore .`. New GitPort method. Does NOT remove untracked files — user may have untracked work in progress. Agent-created new files survive revert but are harmless (not committed). |
| False positive mitigation | File extension filtering | Content-scanning rules skip `.md`, `.spec.ts`, `.test.ts`, and fixture files to reduce noise. |
| Validation granularity | Wave-level, not per-task | Tasks in a wave share a worktree. Validate all task results after wave completes. If any has error violations → revert entire wave. Matches existing fail-fast pattern. |
| S-tier handling | Skip guardrails | S-tier runs in main repo (no worktree isolation). Guardrails only run for F-lite/F-full slices with worktrees. |
| File size cap | 512KB per file | Content-scanning rules skip files > 512KB to avoid memory issues with generated/minified files. |

## Schema Design

### GuardrailRuleId & Severity

```typescript
// execution/domain/guardrail.schemas.ts
GuardrailRuleIdSchema = z.enum([
  'dangerous-commands',
  'credential-exposure',
  'destructive-git',
  'file-scope',
  'suspicious-content',
])

GuardrailSeveritySchema = z.enum(['error', 'warning', 'info'])
```

### GuardrailViolation

```typescript
GuardrailViolationSchema = z.object({
  ruleId: GuardrailRuleIdSchema,
  severity: GuardrailSeveritySchema,
  filePath: z.string().optional(),
  pattern: z.string().optional(),
  message: z.string(),
  line: z.number().optional(),
})
```

### GuardrailValidationReport

```typescript
GuardrailValidationReportSchema = z.object({
  violations: z.array(GuardrailViolationSchema),
  passed: z.boolean(),    // true iff zero error-severity violations
  summary: z.string(),    // "2 errors, 1 warning"
})
```

### GuardrailContext

```typescript
GuardrailContextSchema = z.object({
  agentResult: AgentResultSchema,
  taskFilePaths: z.array(z.string()),
  workingDirectory: z.string(),
  filesChanged: z.array(z.string()),
})
```

### GuardrailRule (Strategy interface)

```typescript
// execution/domain/guardrail-rule.ts
interface GuardrailRule {
  readonly id: GuardrailRuleId;
  evaluate(context: EnrichedGuardrailContext): GuardrailViolation[];
}
```

### EnrichedGuardrailContext

```typescript
// execution/infrastructure/enriched-guardrail-context.ts
// Lives in infrastructure — adapter-internal, not part of port contract
interface EnrichedGuardrailContext extends GuardrailContext {
  fileContents: Map<string, string>;  // path → content (only non-binary, non-test files)
  gitDiff: string;                     // unified diff from worktree
}
```

Rules receive this enriched context. The adapter builds it by:
1. Running `GitPort.diffNameOnly(workingDirectory)` to discover changed files
2. Reading contents of changed files (filtering out `.md`, `.spec.ts`, `.test.ts`, fixtures)
3. Running `GitPort.diff(workingDirectory)` for the unified diff

## Port & Adapter

### OutputGuardrailPort

```typescript
// execution/domain/ports/output-guardrail.port.ts
abstract class OutputGuardrailPort {
  abstract validate(
    context: GuardrailContext
  ): Promise<Result<GuardrailValidationReport, GuardrailError>>;
}
```

### ComposableGuardrailAdapter

```typescript
// execution/infrastructure/composable-guardrail.adapter.ts
class ComposableGuardrailAdapter extends OutputGuardrailPort {
  constructor(
    rules: GuardrailRule[],
    severityOverrides: Map<GuardrailRuleId, GuardrailSeverity>,
    gitPort: GitPort,  // for diff and restore operations
  )

  async validate(context: GuardrailContext):
    Promise<Result<GuardrailValidationReport, GuardrailError>> {
    // 1. GitPort.diffNameOnly(workingDirectory) → discover changed files
    // 2. Read file contents (skip .md, .spec.ts, .test.ts, fixtures)
    // 3. GitPort.diff(workingDirectory) → unified diff
    // 4. Build EnrichedGuardrailContext
    // 5. Run each rule → collect violations
    // 6. Apply severity overrides from settings
    // 7. Build and return ValidationReport
  }
}
```

### InMemoryGuardrailAdapter

```typescript
// execution/infrastructure/in-memory-guardrail.adapter.ts
class InMemoryGuardrailAdapter extends OutputGuardrailPort {
  seed(report: GuardrailValidationReport): void;
  reset(): void;
}
```

## Rules

| Rule | Detects | Default Severity |
|---|---|---|
| `DangerousCommandRule` | `rm -rf`, `kill -9`, `chmod 777`, `mkfs`, `dd if=` in file contents | error |
| `CredentialExposureRule` | API keys (`AKIA...`), `BEGIN RSA PRIVATE KEY`, password assignments, `.env`-style secrets | error |
| `DestructiveGitRule` | `git push --force`, `git reset --hard`, `git clean -fd`, `git checkout .` in file contents | error |
| `FileScopeRule` | `filesChanged ⊄ taskFilePaths` — agent modified files outside declared scope. **Skips when `taskFilePaths` is empty** (no constraint declared). | warning |
| `SuspiciousContentRule` | `eval()`, `new Function()`, dynamic `require()`/`import()`, `package.json` modifications | warning |

Each rule implements `GuardrailRule.evaluate(context): GuardrailViolation[]`. Rules are pure functions — no I/O.

## GitPort Extension

Three new methods on `GitPort` (kernel/ports/git.port.ts):

```typescript
abstract diffNameOnly(workingDirectory: string): Promise<Result<string[], GitError>>;
abstract diff(workingDirectory: string): Promise<Result<string, GitError>>;
abstract restoreWorktree(workingDirectory: string): Promise<Result<void, GitError>>;
```

- `diffNameOnly` — returns list of changed file paths (uncommitted) in the worktree
- `diff` — returns unified diff of uncommitted changes
- `restoreWorktree` — runs `git restore .` to discard uncommitted changes to tracked files. Does NOT run `git clean` — untracked files are preserved (user may have work in progress)

These follow the existing pattern (`worktreeAdd`, `worktreeRemove`, `worktreeList` added in S04).

## Integration

### ExecuteSliceUseCase

Guardrails run at **wave level**, after all tasks in a wave complete (via `Promise.allSettled`), before advancing to the next wave. This avoids the shared-worktree problem where reverting one task's changes would destroy another task's valid changes.

```
// S-tier: skip guardrails entirely (no worktree isolation)
if (complexityTier === 'S') → skip guardrail validation

// After Promise.allSettled for the wave:
for each successful agentResult in wave:
  report = await guardrailPort.validate({
    agentResult, taskFilePaths: task.filePaths,
    workingDirectory: input.workingDirectory,
    filesChanged: agentResult.filesChanged
  })
  collect all violations across tasks

if any task has error-severity violations:
  → gitPort.restoreWorktree(input.workingDirectory)  // revert entire wave
  → for each blocked task: override status = BLOCKED, attach concerns
  → journal: guardrail-violation { action: 'blocked' } per blocked task
  → abort wave (fail-fast, no subsequent waves)
else:
  → for each task with warnings: append concerns on AgentResult
  → journal: guardrail-violation { action: 'warned' } per warned task
  → proceed to checkpoint + next wave
```

Key behaviors:
- **Wave-level revert**: If any task in a wave triggers error violations, the entire wave's changes are reverted. This matches the existing fail-fast pattern.
- **S-tier bypass**: S-tier runs in the main repo without worktree isolation. Guardrails require a worktree to safely revert.
- **Working directory**: Uses `input.workingDirectory` (already available in the use case), not a separate `worktreePath`.

### Violation → Concern Mapping

```typescript
// execution/infrastructure/composable-guardrail.adapter.ts
function toAgentConcern(v: GuardrailViolation): AgentConcern {
  return {
    area: v.ruleId,                                    // e.g. 'dangerous-commands'
    description: v.filePath ? `${v.message} (${v.filePath}:${v.line ?? '?'})` : v.message,
    severity: v.severity === 'error' ? 'critical'      // error → critical
            : v.severity === 'warning' ? 'warning'     // warning → warning
            : 'info',                                   // info → info
  };
}
```

### Prompt Fragment

```typescript
// kernel/agents/guardrail-prompt.ts
GUARDRAIL_PROMPT = `
## Safety Rules
You MUST NOT:
- Execute destructive commands (rm -rf, kill -9, chmod 777, mkfs)
- Expose credentials, API keys, or secrets in source files
- Run destructive git operations (force push, reset --hard, clean -fd)
- Modify files outside your assigned task scope
- Use eval(), new Function(), or dynamic imports
- Modify package.json or dependency files unless explicitly tasked

If your task requires any of these, report BLOCKED with explanation.
`
```

Injected by `PiAgentDispatchAdapter` alongside `AGENT_STATUS_PROMPT`.

### Journal Extension

New discriminated union member (extends `JournalEntryBaseSchema` — inherits `seq`, `sliceId`, `timestamp`, `correlationId`):

```typescript
{
  ...JournalEntryBaseSchema,
  type: 'guardrail-violation',
  taskId: string,
  waveIndex: number,
  violations: GuardrailViolation[],
  action: 'blocked' | 'warned',
}
```

### Settings Configuration

```yaml
guardrails:
  enabled: true
  rules:
    dangerous-commands: error
    credential-exposure: error
    destructive-git: error
    file-scope: warning
    suspicious-content: warning
```

## Error Types

```typescript
// execution/domain/errors/guardrail.error.ts
class GuardrailError extends BaseDomainError {
  readonly code: string;
  private constructor(code, message, metadata?)

  static fileReadFailed(filePath, cause)    // I/O failure reading worktree file
  static diffFailed(worktreePath, cause)    // git diff failed
  static restoreFailed(worktreePath, cause) // git restore failed
  static configInvalid(message)             // invalid settings.yaml guardrails config
}
```

Note: violations found by rules are NOT errors — they appear in `GuardrailValidationReport.violations`. `GuardrailError` is reserved for infrastructure failures.

## File Inventory

### New Files

| File | Purpose |
|---|---|
| `execution/domain/guardrail.schemas.ts` | Violation, Report, Context, RuleId, Severity schemas |
| `execution/domain/guardrail.schemas.spec.ts` | Schema validation tests |
| `execution/domain/guardrail-rule.ts` | GuardrailRule interface |
| `execution/infrastructure/enriched-guardrail-context.ts` | EnrichedGuardrailContext (adapter-internal) |
| `execution/domain/errors/guardrail.error.ts` | GuardrailError class |
| `execution/domain/ports/output-guardrail.port.ts` | OutputGuardrailPort abstract class |
| `execution/infrastructure/rules/dangerous-command.rule.ts` | Dangerous command detection |
| `execution/infrastructure/rules/dangerous-command.rule.spec.ts` | Tests |
| `execution/infrastructure/rules/credential-exposure.rule.ts` | Credential/secret detection |
| `execution/infrastructure/rules/credential-exposure.rule.spec.ts` | Tests |
| `execution/infrastructure/rules/destructive-git.rule.ts` | Destructive git op detection |
| `execution/infrastructure/rules/destructive-git.rule.spec.ts` | Tests |
| `execution/infrastructure/rules/file-scope.rule.ts` | File scope enforcement |
| `execution/infrastructure/rules/file-scope.rule.spec.ts` | Tests |
| `execution/infrastructure/rules/suspicious-content.rule.ts` | Suspicious pattern detection |
| `execution/infrastructure/rules/suspicious-content.rule.spec.ts` | Tests |
| `execution/infrastructure/composable-guardrail.adapter.ts` | Composable rule runner |
| `execution/infrastructure/composable-guardrail.adapter.spec.ts` | Adapter tests |
| `execution/infrastructure/in-memory-guardrail.adapter.ts` | Test double |
| `kernel/agents/guardrail-prompt.ts` | Agent safety prompt fragment |

### Modified Files

| File | Change |
|---|---|
| `kernel/ports/git.port.ts` | Add `diffNameOnly()`, `diff()`, `restoreWorktree()` methods |
| `kernel/infrastructure/cli-git.adapter.ts` | Implement new GitPort methods |
| `kernel/infrastructure/in-memory-git.adapter.ts` | Implement new GitPort methods |
| `execution/application/execute-slice.use-case.ts` | Add guardrail validation after dispatch |
| `execution/application/execute-slice.use-case.spec.ts` | Tests for guardrail integration |
| `execution/domain/journal-entry.schemas.ts` | Add `guardrail-violation` entry type |
| `execution/infrastructure/pi-agent-dispatch.adapter.ts` | Inject GUARDRAIL_PROMPT |
| `execution/index.ts` | Export new types |
| `kernel/agents/index.ts` | Export guardrail prompt |
| `shared/project-settings.schemas.ts` | Add `guardrails` key to SettingsSchema |
| `.tff/settings.yaml` | Add guardrails config section |

## Acceptance Criteria

- **AC1**: `DangerousCommandRule` detects `rm -rf`, `kill -9`, `chmod 777`, `mkfs`, `dd if=` patterns in file contents
- **AC2**: `CredentialExposureRule` detects API keys (`AKIA...`), `BEGIN RSA PRIVATE KEY`, password assignments, `.env`-style secrets
- **AC3**: `DestructiveGitRule` detects `git push --force`, `git reset --hard`, `git clean -fd`, `git checkout .` in file contents
- **AC4**: `FileScopeRule` flags files in `filesChanged` that are not in the task's declared `filePaths`. Skips when `taskFilePaths` is empty.
- **AC5**: `SuspiciousContentRule` detects `eval()`, `new Function()`, dynamic `require()`/`import()`, `package.json` modifications
- **AC6**: Error-severity violations in any task block the entire wave, revert all wave changes, and set blocked tasks to BLOCKED
- **AC7**: Warning-severity violations attach as concerns on AgentResult without blocking
- **AC8**: Rule severities are configurable via `settings.yaml` → `guardrails.rules`
- **AC9**: `GUARDRAIL_PROMPT` is injected into every agent dispatch system prompt
- **AC10**: Journal records `guardrail-violation` entries for both blocked and warned violations
- **AC11**: `InMemoryGuardrailAdapter` passes same contract as `ComposableGuardrailAdapter`
- **AC12**: `GitPort` extended with `diffNameOnly()`, `diff()`, `restoreWorktree()` — existing tests still pass
- **AC13**: Content-scanning rules skip `.md`, `.spec.ts`, `.test.ts`, fixture files, and files > 512KB (false-positive and memory mitigation)
- **AC14**: Guardrails are skipped for S-tier slices (no worktree isolation)
- **AC15**: `SettingsSchema` extended with `guardrails` key — invalid config produces clear error

## Limitations

- **Post-write, not pre-write**: Guardrails validate after the agent has written to the worktree, not before. Worktree isolation + revert achieves equivalent safety for file modifications.
- **No Bash execution interception**: If an agent runs `rm -rf /important` via Bash tool during execution, the damage is done before guardrails run. Guardrails only detect dangerous patterns *written into source files*, not patterns *executed at runtime*. Runtime sandboxing is PI SDK's responsibility.
- **Untracked files survive revert**: `restoreWorktree` only restores tracked files (`git restore .`). Agent-created new files remain in the worktree but are harmless — they won't be committed. No `git clean` is used to avoid destroying user's untracked work.
- **Pattern field**: `GuardrailViolation.pattern` contains the matched regex pattern string (e.g., `rm\s+-rf`) for debugging. Not the matched text.

## Non-Goals

- No real-time file watching during agent execution (post-execution only)
- No network/process sandboxing (PI SDK responsibility)
- No custom user-defined rules (only the 5 built-in rules)
- No git hook integration (guardrails are application-layer, not git-level)
- No integration with watchdog/overseer (S09) — separate slice
