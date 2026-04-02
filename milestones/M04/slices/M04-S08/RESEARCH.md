# M04-S08 Research: Output Safety Guardrails

## 1. GitPort Extension

### Current State
- 13 abstract methods, all return `Result<T, GitError>`
- `GitCliAdapter` uses `child_process.execFile()` with sanitized `GIT_*` env vars
- Command pattern: `git --no-pager -c color.ui=never [args]`
- Error mapping: `ENOENT`→`NOT_FOUND`, "not a git repo"→`NOT_A_REPO`, "unknown revision"→`REF_NOT_FOUND`, "CONFLICT"→`CONFLICT`, fallback→`COMMAND_FAILED`
- No in-memory git adapter — tests use real git repos or manual mocks extending GitPort
- Integration tests in `git-cli.adapter.integration.spec.ts` (281 lines), worktree tests in `git-cli.adapter.worktree.spec.ts` (90 lines)

### New Methods Required

```typescript
// diffNameOnly: git diff --name-only
// CLI: execFile('git', ['diff', '--name-only'], { cwd: workingDirectory })
// Parse: split stdout by newline, filter empty

// diff: git diff (unified)
// CLI: execFile('git', ['diff'], { cwd: workingDirectory })
// Return: raw stdout string

// restoreWorktree: git restore .
// CLI: execFile('git', ['restore', '.'], { cwd: workingDirectory })
// Return: void on success
```

### Key Pattern: `statusAt(cwd)` precedent
GitPort already has `statusAt(cwd: string)` that runs git commands in a different working directory. The new methods follow the same pattern — accept `workingDirectory` parameter, pass as `cwd` to execFile.

### Mock Pattern
Tests that need GitPort use a manual mock class extending GitPort (see `rollback-slice.use-case.spec.ts`). The guardrail adapter tests should follow the same pattern or use the in-memory adapter with pre-seeded diff results.

---

## 2. ExecuteSliceUseCase Integration

### Constructor
11 deps: taskRepository, waveDetection, checkpointRepository, agentDispatch, worktree, eventBus, journalRepository, metricsRepository, dateProvider, logger, templateContent.

**New dep needed**: `guardrailPort: OutputGuardrailPort`

### Wave Loop (lines 125-276)
```
for each wave:
  1. Skip completed waves (checkpoint)
  2. Filter tasks (exclude completed + stale claims)
  3. Start tasks + record in checkpoint
  4. Build dispatch configs via PromptBuilder
  5. Promise.allSettled(configs.map(dispatch))        ← LINE 180-183
  ─── GUARDRAIL INJECTION POINT ───                   ← AFTER LINE 183
  6. Process settled results                           ← LINE 185+
  7. Fail-fast if failures
  8. Advance wave + checkpoint
```

### Injection Strategy
After `Promise.allSettled` returns `settled[]`, before the result processing loop:
1. Collect successful results from `settled[]`
2. For each: call `guardrailPort.validate(context)`
3. If any error violations → `gitPort.restoreWorktree()`, mark as BLOCKED, populate `waveFailedTasks`
4. If only warnings → append concerns, proceed
5. Let existing fail-fast logic handle the rest (lines 258-263)

### `input.workingDirectory`
Available throughout the method. Passed to PromptBuilder at line 110. Type: `z.string().min(1)` from `ExecuteSliceInputSchema`.

### Test Pattern
- Input helper: `makeInput({ workingDirectory: "/mock/worktree" })`
- Ports seeded: `taskRepo.seed(t)`, `agentDispatch.givenResult(id, ok(result))`
- Event testing: subscribe to eventBus, collect events, assert after `useCase.execute()`
- Wave testing: spy on dispatch order via wrapping `agentDispatch.dispatch`

---

## 3. Journal Entry Extension

### Discriminated Union Pattern
```typescript
z.discriminatedUnion("type", [
  TaskStartedEntrySchema,
  TaskCompletedEntrySchema,
  // ... add GuardrailViolationEntrySchema here
])
```

Each entry extends `JournalEntryBaseSchema` (seq, sliceId, timestamp, correlationId) with a literal `type` field.

### New Entry
```typescript
const GuardrailViolationEntrySchema = JournalEntryBaseSchema.extend({
  type: z.literal("guardrail-violation"),
  taskId: IdSchema,
  waveIndex: z.number().int().min(0),
  violations: z.array(GuardrailViolationSchema),
  action: z.enum(["blocked", "warned"]),
});
```

### JournalEventHandler
Registers listeners on eventBus. Maps domain events → journal entries. Appends via `journalRepo.append(sliceId, entry)` with `seq` omitted (auto-assigned). Guardrail violations will be journaled directly by the use case (not via event handler), since they're detected inline during wave processing.

---

## 4. Settings Schema Extension

### Current Pattern
```typescript
const SettingsSchema = z.object({
  modelRouting: ModelRoutingConfigSchema.default(DEFAULTS),
  autonomy: AutonomyConfigSchema.default(DEFAULTS),
  autoLearn: AutoLearnConfigSchema.default(DEFAULTS),
  beads: BeadsConfigSchema.default(DEFAULTS),
}).default(SETTINGS_DEFAULTS);
```

Uses `.catch(DEFAULT)` resilience — invalid configs degrade to defaults, never crash.

### New Addition
```typescript
const GuardrailsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  rules: z.record(GuardrailRuleIdSchema, GuardrailSeveritySchema).default(DEFAULT_RULES),
}).catch(GUARDRAILS_DEFAULTS);
```

Add to SettingsSchema as `guardrails: GuardrailsConfigSchema.default(GUARDRAILS_DEFAULTS)`.

---

## 5. Error Class Pattern

```typescript
class GuardrailError extends BaseDomainError {
  readonly code: string;
  private constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = code;
  }
  static fileReadFailed(filePath: string, cause: unknown): GuardrailError { ... }
  static diffFailed(workingDirectory: string, cause: unknown): GuardrailError { ... }
  static restoreFailed(workingDirectory: string, cause: unknown): GuardrailError { ... }
  static configInvalid(message: string): GuardrailError { ... }
}
```

Code format: `GUARDRAIL.FILE_READ_FAILED`, `GUARDRAIL.DIFF_FAILED`, etc. Follows `AGENT_DISPATCH.*` precedent.

---

## 6. Prompt Injection Pattern

### Current
```typescript
const fullSystemPrompt = config.systemPrompt
  ? `${config.systemPrompt}\n\n${AGENT_STATUS_PROMPT}`
  : AGENT_STATUS_PROMPT;
const prompt = `${fullSystemPrompt}\n\n---\n\n${config.taskPrompt}`;
```

### With Guardrails
```typescript
const fullSystemPrompt = config.systemPrompt
  ? `${config.systemPrompt}\n\n${AGENT_STATUS_PROMPT}\n\n${GUARDRAIL_PROMPT}`
  : `${AGENT_STATUS_PROMPT}\n\n${GUARDRAIL_PROMPT}`;
```

Import `GUARDRAIL_PROMPT` from `@kernel/agents`.

---

## 7. In-Memory Test Double Pattern

```typescript
class InMemoryGuardrailAdapter extends OutputGuardrailPort {
  private _report: GuardrailValidationReport | undefined;
  private readonly _validated: GuardrailContext[] = [];

  givenReport(report: GuardrailValidationReport): void { ... }
  get validatedContexts(): readonly GuardrailContext[] { ... }
  wasValidated(): boolean { ... }
  reset(): void { ... }

  async validate(ctx): Promise<Result<GuardrailValidationReport, GuardrailError>> {
    this._validated.push(ctx);
    return ok(this._report ?? { violations: [], passed: true, summary: "0 violations" });
  }
}
```

Follows: `givenX()` seeding, `wasX()`/getter verification, `reset()` cleanup, default-safe behavior.

---

## 8. Barrel Export Pattern

### execution/index.ts Organization
```
// Application -- Use Cases
// Application -- Collaborators
// Application -- Schemas
// Domain -- Schemas
// Domain -- Errors
// Domain -- Events
// Domain -- Ports
// Domain -- Builders
// Domain -- Worktree Schemas
// Infrastructure -- Adapters
```

### New Exports Needed
```
// Domain -- Guardrail Schemas
export type { GuardrailViolation, GuardrailValidationReport, ... }
export { GuardrailViolationSchema, GuardrailValidationReportSchema, ... }
// Domain -- Guardrail Errors
export { GuardrailError }
// Domain -- Guardrail Ports
export { OutputGuardrailPort }
// Infrastructure -- Adapters
export { ComposableGuardrailAdapter }
export { InMemoryGuardrailAdapter }
```

### kernel/agents/index.ts
Add: `export { GUARDRAIL_PROMPT } from "./guardrail-prompt";`

---

## 9. Risk Assessment

| Risk | Mitigation |
|---|---|
| GitPort extension breaks existing tests | New methods only — no signature changes. Run full test suite. |
| ExecuteSliceUseCase constructor change (12th dep) | Add as last dep. Update all test instantiations. |
| Wave-level validation timing | Validate after allSettled, before result processing — clear insertion point. |
| Settings migration | `.catch()` + `.default()` resilience ensures old configs still parse. |
| False positives in content rules | Extension filtering + 512KB cap + skip-when-empty for FileScopeRule. |

## 10. Dependencies

| From | To | Type |
|---|---|---|
| ComposableGuardrailAdapter | GitPort | Reads diffs, restores worktree |
| ComposableGuardrailAdapter | GuardrailRule[] | Runs each rule |
| ExecuteSliceUseCase | OutputGuardrailPort | Validates after wave |
| PiAgentDispatchAdapter | GUARDRAIL_PROMPT | Injects into agent prompts |
| GuardrailViolationEntrySchema | GuardrailViolationSchema | Embeds violations in journal |
| SettingsSchema | GuardrailsConfigSchema | Validates config |
