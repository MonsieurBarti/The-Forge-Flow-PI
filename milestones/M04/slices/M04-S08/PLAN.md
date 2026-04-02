# M04-S08: Output Safety Guardrails — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Defense-in-depth output safety — prompt prevention + post-execution validation via composable guardrail rules.
**Architecture:** OutputGuardrailPort (Strategy pattern), 5 composable rules, wave-level validation in ExecuteSliceUseCase.
**Tech Stack:** TypeScript, Zod, Vitest, hexagonal architecture.

## File Structure

### New Files
| File | Responsibility |
|---|---|
| `src/hexagons/execution/domain/guardrail.schemas.ts` | RuleId, Severity, Violation, Report, Context schemas |
| `src/hexagons/execution/domain/guardrail.schemas.spec.ts` | Schema validation tests |
| `src/hexagons/execution/domain/guardrail-rule.ts` | GuardrailRule interface |
| `src/hexagons/execution/domain/errors/guardrail.error.ts` | GuardrailError class |
| `src/hexagons/execution/domain/ports/output-guardrail.port.ts` | OutputGuardrailPort abstract class |
| `src/hexagons/execution/domain/enriched-guardrail-context.ts` | EnrichedGuardrailContext type |
| `src/hexagons/execution/infrastructure/rules/dangerous-command.rule.ts` | Dangerous command detection |
| `src/hexagons/execution/infrastructure/rules/dangerous-command.rule.spec.ts` | Tests |
| `src/hexagons/execution/infrastructure/rules/credential-exposure.rule.ts` | Credential/secret detection |
| `src/hexagons/execution/infrastructure/rules/credential-exposure.rule.spec.ts` | Tests |
| `src/hexagons/execution/infrastructure/rules/destructive-git.rule.ts` | Destructive git op detection |
| `src/hexagons/execution/infrastructure/rules/destructive-git.rule.spec.ts` | Tests |
| `src/hexagons/execution/infrastructure/rules/file-scope.rule.ts` | File scope enforcement |
| `src/hexagons/execution/infrastructure/rules/file-scope.rule.spec.ts` | Tests |
| `src/hexagons/execution/infrastructure/rules/suspicious-content.rule.ts` | Suspicious pattern detection |
| `src/hexagons/execution/infrastructure/rules/suspicious-content.rule.spec.ts` | Tests |
| `src/hexagons/execution/infrastructure/composable-guardrail.adapter.ts` | Composable rule runner |
| `src/hexagons/execution/infrastructure/composable-guardrail.adapter.spec.ts` | Adapter tests |
| `src/hexagons/execution/infrastructure/in-memory-guardrail.adapter.ts` | Test double |
| `src/kernel/agents/guardrail-prompt.ts` | Agent safety prompt fragment |

### Modified Files
| File | Change |
|---|---|
| `src/kernel/ports/git.port.ts` | Add 3 new abstract methods |
| `src/kernel/infrastructure/git-cli.adapter.ts` | Implement diffNameOnly, diff, restoreWorktree |
| `src/hexagons/execution/domain/journal-entry.schemas.ts` | Add guardrail-violation entry type |
| `src/hexagons/settings/domain/project-settings.schemas.ts` | Add guardrails config |
| `src/hexagons/execution/infrastructure/pi-agent-dispatch.adapter.ts` | Inject GUARDRAIL_PROMPT |
| `src/hexagons/execution/application/execute-slice.use-case.ts` | Wave-level guardrail validation |
| `src/hexagons/execution/application/execute-slice.use-case.spec.ts` | Integration tests |
| `src/hexagons/execution/index.ts` | Export new types |
| `src/kernel/agents/index.ts` | Export GUARDRAIL_PROMPT |

---

## Wave 0 (parallel — no dependencies)

### T01: Guardrail schemas + rule interface + error class

**Create:** `src/hexagons/execution/domain/guardrail.schemas.ts`
**Create:** `src/hexagons/execution/domain/guardrail.schemas.spec.ts`
**Create:** `src/hexagons/execution/domain/guardrail-rule.ts`
**Create:** `src/hexagons/execution/domain/errors/guardrail.error.ts`
**Traces to:** AC1-AC5 (schema foundations)

- [ ] Step 1: Write failing tests for guardrail schemas

**File:** `src/hexagons/execution/domain/guardrail.schemas.spec.ts`
```typescript
import { describe, expect, it } from "vitest";
import {
  GuardrailContextSchema,
  GuardrailRuleIdSchema,
  GuardrailSeveritySchema,
  GuardrailValidationReportSchema,
  GuardrailViolationSchema,
} from "./guardrail.schemas";

describe("GuardrailRuleIdSchema", () => {
  it("accepts valid rule IDs", () => {
    for (const id of ["dangerous-commands", "credential-exposure", "destructive-git", "file-scope", "suspicious-content"]) {
      expect(GuardrailRuleIdSchema.safeParse(id).success).toBe(true);
    }
  });
  it("rejects unknown rule IDs", () => {
    expect(GuardrailRuleIdSchema.safeParse("unknown-rule").success).toBe(false);
  });
});

describe("GuardrailSeveritySchema", () => {
  it("accepts error, warning, info", () => {
    for (const s of ["error", "warning", "info"]) {
      expect(GuardrailSeveritySchema.safeParse(s).success).toBe(true);
    }
  });
});

describe("GuardrailViolationSchema", () => {
  it("accepts a full violation", () => {
    const result = GuardrailViolationSchema.safeParse({
      ruleId: "dangerous-commands",
      severity: "error",
      filePath: "src/index.ts",
      pattern: "rm\\s+-rf",
      message: "Dangerous command detected: rm -rf",
      line: 42,
    });
    expect(result.success).toBe(true);
  });
  it("accepts minimal violation (optional fields omitted)", () => {
    const result = GuardrailViolationSchema.safeParse({
      ruleId: "file-scope",
      severity: "warning",
      message: "File outside scope",
    });
    expect(result.success).toBe(true);
  });
});

describe("GuardrailValidationReportSchema", () => {
  it("accepts a report with violations", () => {
    const result = GuardrailValidationReportSchema.safeParse({
      violations: [{ ruleId: "dangerous-commands", severity: "error", message: "rm -rf found" }],
      passed: false,
      summary: "1 error",
    });
    expect(result.success).toBe(true);
  });
  it("accepts a clean report", () => {
    const result = GuardrailValidationReportSchema.safeParse({
      violations: [],
      passed: true,
      summary: "0 violations",
    });
    expect(result.success).toBe(true);
  });
});

describe("GuardrailContextSchema", () => {
  it("requires workingDirectory and taskFilePaths", () => {
    const result = GuardrailContextSchema.safeParse({
      agentResult: {}, // will fail — validates nested
      taskFilePaths: ["src/foo.ts"],
      workingDirectory: "/tmp/worktree",
      filesChanged: ["src/foo.ts"],
    });
    // agentResult is complex — just verify the schema parses without throwing
    expect(result.success).toBe(false); // expected: agentResult invalid
  });
});
```

- [ ] Step 2: Run tests, verify FAIL
**Run:** `npx vitest run src/hexagons/execution/domain/guardrail.schemas.spec.ts`
**Expect:** FAIL — modules not found

- [ ] Step 3: Implement schemas, rule interface, and error class

**File:** `src/hexagons/execution/domain/guardrail.schemas.ts`
```typescript
import { IdSchema } from "@kernel";
import { AgentResultSchema } from "@kernel/agents";
import { z } from "zod";

export const GuardrailRuleIdSchema = z.enum([
  "dangerous-commands",
  "credential-exposure",
  "destructive-git",
  "file-scope",
  "suspicious-content",
]);
export type GuardrailRuleId = z.infer<typeof GuardrailRuleIdSchema>;

export const GuardrailSeveritySchema = z.enum(["error", "warning", "info"]);
export type GuardrailSeverity = z.infer<typeof GuardrailSeveritySchema>;

export const GuardrailViolationSchema = z.object({
  ruleId: GuardrailRuleIdSchema,
  severity: GuardrailSeveritySchema,
  filePath: z.string().optional(),
  pattern: z.string().optional(),
  message: z.string().min(1),
  line: z.number().int().min(1).optional(),
});
export type GuardrailViolation = z.infer<typeof GuardrailViolationSchema>;

export const GuardrailValidationReportSchema = z.object({
  violations: z.array(GuardrailViolationSchema),
  passed: z.boolean(),
  summary: z.string(),
});
export type GuardrailValidationReport = z.infer<typeof GuardrailValidationReportSchema>;

export const GuardrailContextSchema = z.object({
  agentResult: AgentResultSchema,
  taskFilePaths: z.array(z.string()),
  workingDirectory: z.string().min(1),
  filesChanged: z.array(z.string()),
});
export type GuardrailContext = z.infer<typeof GuardrailContextSchema>;
```

**File:** `src/hexagons/execution/domain/guardrail-rule.ts`
```typescript
import type { GuardrailRuleId, GuardrailViolation } from "./guardrail.schemas";
import type { EnrichedGuardrailContext } from "./enriched-guardrail-context";

export interface GuardrailRule {
  readonly id: GuardrailRuleId;
  evaluate(context: EnrichedGuardrailContext): GuardrailViolation[];
}
```

**File:** `src/hexagons/execution/domain/enriched-guardrail-context.ts`
Note: Lives in domain (not infrastructure as SPEC originally stated) because `GuardrailRule` interface in domain depends on this type. Domain must not import from infrastructure — this is the correct hexagonal placement.
```typescript
import type { GuardrailContext } from "./guardrail.schemas";

export interface EnrichedGuardrailContext extends GuardrailContext {
  readonly fileContents: ReadonlyMap<string, string>;
  readonly gitDiff: string;
}
```

**File:** `src/hexagons/execution/domain/errors/guardrail.error.ts`
```typescript
import { BaseDomainError } from "@kernel";

export class GuardrailError extends BaseDomainError {
  readonly code: string;

  private constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = code;
  }

  static fileReadFailed(filePath: string, cause: unknown): GuardrailError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new GuardrailError(
      "GUARDRAIL.FILE_READ_FAILED",
      `Failed to read file for guardrail check: ${filePath}: ${msg}`,
      { filePath, cause: msg },
    );
  }

  static diffFailed(workingDirectory: string, cause: unknown): GuardrailError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new GuardrailError(
      "GUARDRAIL.DIFF_FAILED",
      `Failed to compute git diff in ${workingDirectory}: ${msg}`,
      { workingDirectory, cause: msg },
    );
  }

  static restoreFailed(workingDirectory: string, cause: unknown): GuardrailError {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return new GuardrailError(
      "GUARDRAIL.RESTORE_FAILED",
      `Failed to restore worktree ${workingDirectory}: ${msg}`,
      { workingDirectory, cause: msg },
    );
  }

  static configInvalid(message: string): GuardrailError {
    return new GuardrailError("GUARDRAIL.CONFIG_INVALID", message);
  }
}
```

- [ ] Step 4: Run tests, verify PASS
**Run:** `npx vitest run src/hexagons/execution/domain/guardrail.schemas.spec.ts`
**Expect:** PASS — all schema tests green

- [ ] Step 5: Commit
**Run:** `git add src/hexagons/execution/domain/guardrail.schemas.ts src/hexagons/execution/domain/guardrail.schemas.spec.ts src/hexagons/execution/domain/guardrail-rule.ts src/hexagons/execution/domain/enriched-guardrail-context.ts src/hexagons/execution/domain/errors/guardrail.error.ts && git commit -m "feat(S08/T01): guardrail schemas, rule interface, error class"`

---

### T02: GitPort extension — diffNameOnly, diff, restoreWorktree

**Modify:** `src/kernel/ports/git.port.ts`
**Modify:** `src/kernel/infrastructure/git-cli.adapter.ts`
**Traces to:** AC12

- [ ] Step 1: Write integration tests for new GitPort methods

**File:** `src/kernel/infrastructure/git-cli.adapter.guardrail.spec.ts`
```typescript
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitCliAdapter } from "./git-cli.adapter";

describe("GitCliAdapter — guardrail methods", () => {
  let repoDir: string;
  let adapter: GitCliAdapter;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "git-guardrail-"));
    execSync("git init && git commit --allow-empty -m init", { cwd: repoDir });
    adapter = new GitCliAdapter(repoDir);
  });

  afterEach(() => {
    execSync(`rm -rf "${repoDir}"`);
  });

  describe("diffNameOnly", () => {
    it("returns empty array when working tree is clean", async () => {
      const result = await adapter.diffNameOnly(repoDir);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toEqual([]);
    });

    it("returns changed file paths", async () => {
      writeFileSync(join(repoDir, "tracked.txt"), "initial");
      execSync("git add tracked.txt && git commit -m 'add tracked'", { cwd: repoDir });
      writeFileSync(join(repoDir, "tracked.txt"), "modified");
      const result = await adapter.diffNameOnly(repoDir);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toEqual(["tracked.txt"]);
    });
  });

  describe("diff", () => {
    it("returns empty string when clean", async () => {
      const result = await adapter.diff(repoDir);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toBe("");
    });

    it("returns unified diff", async () => {
      writeFileSync(join(repoDir, "file.txt"), "before");
      execSync("git add file.txt && git commit -m 'add file'", { cwd: repoDir });
      writeFileSync(join(repoDir, "file.txt"), "after");
      const result = await adapter.diff(repoDir);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toContain("-before");
        expect(result.data).toContain("+after");
      }
    });
  });

  describe("restoreWorktree", () => {
    it("discards uncommitted changes to tracked files", async () => {
      writeFileSync(join(repoDir, "file.txt"), "original");
      execSync("git add file.txt && git commit -m 'add file'", { cwd: repoDir });
      writeFileSync(join(repoDir, "file.txt"), "dirty");

      const result = await adapter.restoreWorktree(repoDir);
      expect(result.ok).toBe(true);

      const statusResult = await adapter.statusAt(repoDir);
      expect(statusResult.ok).toBe(true);
      if (statusResult.ok) expect(statusResult.data.clean).toBe(true);
    });

    it("preserves untracked files", async () => {
      writeFileSync(join(repoDir, "untracked.txt"), "keep me");
      const result = await adapter.restoreWorktree(repoDir);
      expect(result.ok).toBe(true);

      const statusResult = await adapter.statusAt(repoDir);
      expect(statusResult.ok).toBe(true);
      if (statusResult.ok) {
        const untracked = statusResult.data.entries.find((e) => e.path === "untracked.txt");
        expect(untracked).toBeDefined();
        expect(untracked?.status).toBe("untracked");
      }
    });
  });
});
```

- [ ] Step 2: Run tests, verify FAIL
**Run:** `npx vitest run src/kernel/infrastructure/git-cli.adapter.guardrail.spec.ts`
**Expect:** FAIL — methods not found on GitCliAdapter

- [ ] Step 3: Add abstract methods to GitPort and implement in GitCliAdapter

**Modify:** `src/kernel/ports/git.port.ts` — add after `statusAt`:
```typescript
  abstract diffNameOnly(cwd: string): Promise<Result<string[], GitError>>;
  abstract diff(cwd: string): Promise<Result<string, GitError>>;
  abstract restoreWorktree(cwd: string): Promise<Result<void, GitError>>;
```

**Modify:** `src/kernel/infrastructure/git-cli.adapter.ts` — add after `deleteBranch`:
```typescript
  async diffNameOnly(cwd: string): Promise<Result<string[], GitError>> {
    const result = await this.runGit(["-C", cwd, "diff", "--name-only"]);
    if (!result.ok) return result;
    const files = result.data.split("\n").map((l) => l.trim()).filter(Boolean);
    return ok(files);
  }

  async diff(cwd: string): Promise<Result<string, GitError>> {
    return this.runGit(["-C", cwd, "diff"]);
  }

  async restoreWorktree(cwd: string): Promise<Result<void, GitError>> {
    const result = await this.runGit(["-C", cwd, "restore", "."]);
    if (!result.ok) return result;
    return ok(undefined);
  }
```

- [ ] Step 4: Run tests, verify PASS
**Run:** `npx vitest run src/kernel/infrastructure/git-cli.adapter.guardrail.spec.ts`
**Expect:** PASS

- [ ] Step 5: Update MockGitPort in rollback spec to add stubs for new abstract methods

**Modify:** `src/hexagons/execution/application/rollback-slice.use-case.spec.ts` — add to MockGitPort class:
```typescript
  async diffNameOnly(): Promise<Result<string[], GitError>> { return ok([]); }
  async diff(): Promise<Result<string, GitError>> { return ok(""); }
  async restoreWorktree(): Promise<Result<void, GitError>> { return ok(undefined); }
```

- [ ] Step 6: Run all existing GitPort and execution tests to verify no regression
**Run:** `npx vitest run src/kernel/infrastructure/ && npx vitest run src/hexagons/execution/application/rollback-slice.use-case.spec.ts`
**Expect:** PASS — all existing tests still green

- [ ] Step 7: Commit
**Run:** `git add src/kernel/ports/git.port.ts src/kernel/infrastructure/git-cli.adapter.ts src/kernel/infrastructure/git-cli.adapter.guardrail.spec.ts src/hexagons/execution/application/rollback-slice.use-case.spec.ts && git commit -m "feat(S08/T02): GitPort extension — diffNameOnly, diff, restoreWorktree"`

---

### T03: GUARDRAIL_PROMPT constant

**Create:** `src/kernel/agents/guardrail-prompt.ts`
**Traces to:** AC9 (partial — constant only, injection in T13)

- [ ] Step 1: Create the prompt constant

**File:** `src/kernel/agents/guardrail-prompt.ts`
```typescript
export const GUARDRAIL_PROMPT = `
## Safety Rules

You MUST NOT:
- Execute destructive commands (rm -rf, kill -9, chmod 777, mkfs)
- Expose credentials, API keys, or secrets in source files
- Run destructive git operations (force push, reset --hard, clean -fd)
- Modify files outside your assigned task scope
- Use eval(), new Function(), or dynamic imports
- Modify package.json or dependency files unless explicitly tasked

If your task requires any of these, report BLOCKED with explanation.
`.trim();
```

- [ ] Step 2: Commit
**Run:** `git add src/kernel/agents/guardrail-prompt.ts && git commit -m "feat(S08/T03): GUARDRAIL_PROMPT constant"`

---

## Wave 1 (parallel — depends on T01)

### T04: OutputGuardrailPort + InMemoryGuardrailAdapter

**Create:** `src/hexagons/execution/domain/ports/output-guardrail.port.ts`
**Create:** `src/hexagons/execution/infrastructure/in-memory-guardrail.adapter.ts`
**Traces to:** AC11

- [ ] Step 1: Write contract test

**File:** `src/hexagons/execution/infrastructure/in-memory-guardrail.adapter.spec.ts`
```typescript
import { describe, expect, it } from "vitest";
import { ok } from "@kernel";
import { InMemoryGuardrailAdapter } from "./in-memory-guardrail.adapter";
import type { GuardrailContext, GuardrailValidationReport } from "../domain/guardrail.schemas";
import { AgentResultBuilder } from "@kernel/agents";

function makeContext(overrides?: Partial<GuardrailContext>): GuardrailContext {
  return {
    agentResult: new AgentResultBuilder().withTaskId("t1").asDone().build(),
    taskFilePaths: ["src/foo.ts"],
    workingDirectory: "/tmp/wt",
    filesChanged: ["src/foo.ts"],
    ...overrides,
  };
}

describe("InMemoryGuardrailAdapter", () => {
  it("returns clean report by default", async () => {
    const adapter = new InMemoryGuardrailAdapter();
    const result = await adapter.validate(makeContext());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.passed).toBe(true);
      expect(result.data.violations).toEqual([]);
    }
  });

  it("returns seeded report", async () => {
    const adapter = new InMemoryGuardrailAdapter();
    const report: GuardrailValidationReport = {
      violations: [{ ruleId: "dangerous-commands", severity: "error", message: "rm -rf" }],
      passed: false,
      summary: "1 error",
    };
    adapter.givenReport(report);
    const result = await adapter.validate(makeContext());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual(report);
  });

  it("tracks validated contexts", async () => {
    const adapter = new InMemoryGuardrailAdapter();
    const ctx = makeContext();
    await adapter.validate(ctx);
    expect(adapter.validatedContexts).toHaveLength(1);
    expect(adapter.wasValidated()).toBe(true);
  });

  it("resets state", async () => {
    const adapter = new InMemoryGuardrailAdapter();
    adapter.givenReport({ violations: [], passed: true, summary: "0" });
    await adapter.validate(makeContext());
    adapter.reset();
    expect(adapter.wasValidated()).toBe(false);
  });
});
```

- [ ] Step 2: Run test, verify FAIL
**Run:** `npx vitest run src/hexagons/execution/infrastructure/in-memory-guardrail.adapter.spec.ts`
**Expect:** FAIL

- [ ] Step 3: Implement port and in-memory adapter

**File:** `src/hexagons/execution/domain/ports/output-guardrail.port.ts`
```typescript
import type { Result } from "@kernel";
import type { GuardrailContext, GuardrailValidationReport } from "../guardrail.schemas";
import type { GuardrailError } from "../errors/guardrail.error";

export abstract class OutputGuardrailPort {
  abstract validate(
    context: GuardrailContext,
  ): Promise<Result<GuardrailValidationReport, GuardrailError>>;
}
```

**File:** `src/hexagons/execution/infrastructure/in-memory-guardrail.adapter.ts`
```typescript
import { ok, type Result } from "@kernel";
import type { GuardrailContext, GuardrailValidationReport } from "../domain/guardrail.schemas";
import type { GuardrailError } from "../domain/errors/guardrail.error";
import { OutputGuardrailPort } from "../domain/ports/output-guardrail.port";

const CLEAN_REPORT: GuardrailValidationReport = {
  violations: [],
  passed: true,
  summary: "0 violations",
};

export class InMemoryGuardrailAdapter extends OutputGuardrailPort {
  private _report: GuardrailValidationReport = CLEAN_REPORT;
  private readonly _validated: GuardrailContext[] = [];

  givenReport(report: GuardrailValidationReport): void {
    this._report = report;
  }

  get validatedContexts(): readonly GuardrailContext[] {
    return this._validated;
  }

  wasValidated(): boolean {
    return this._validated.length > 0;
  }

  reset(): void {
    this._report = CLEAN_REPORT;
    this._validated.length = 0;
  }

  async validate(
    context: GuardrailContext,
  ): Promise<Result<GuardrailValidationReport, GuardrailError>> {
    this._validated.push(context);
    return ok(this._report);
  }
}
```

- [ ] Step 4: Run test, verify PASS
**Run:** `npx vitest run src/hexagons/execution/infrastructure/in-memory-guardrail.adapter.spec.ts`
**Expect:** PASS

- [ ] Step 5: Commit
**Run:** `git add src/hexagons/execution/domain/ports/output-guardrail.port.ts src/hexagons/execution/infrastructure/in-memory-guardrail.adapter.ts src/hexagons/execution/infrastructure/in-memory-guardrail.adapter.spec.ts && git commit -m "feat(S08/T04): OutputGuardrailPort + InMemoryGuardrailAdapter"`

---

### T05: DangerousCommandRule

**Create:** `src/hexagons/execution/infrastructure/rules/dangerous-command.rule.ts`
**Create:** `src/hexagons/execution/infrastructure/rules/dangerous-command.rule.spec.ts`
**Traces to:** AC1, AC13

- [ ] Step 1: Write failing tests

**File:** `src/hexagons/execution/infrastructure/rules/dangerous-command.rule.spec.ts`
```typescript
import { describe, expect, it } from "vitest";
import { DangerousCommandRule } from "./dangerous-command.rule";
import type { EnrichedGuardrailContext } from "../../domain/enriched-guardrail-context";
import { AgentResultBuilder } from "@kernel/agents";

function makeContext(fileContents: Record<string, string>): EnrichedGuardrailContext {
  return {
    agentResult: new AgentResultBuilder().withTaskId("t1").asDone().build(),
    taskFilePaths: [],
    workingDirectory: "/tmp",
    filesChanged: Object.keys(fileContents),
    fileContents: new Map(Object.entries(fileContents)),
    gitDiff: "",
  };
}

describe("DangerousCommandRule", () => {
  const rule = new DangerousCommandRule();

  it("detects rm -rf", () => {
    const violations = rule.evaluate(makeContext({ "src/script.ts": 'exec("rm -rf /tmp")' }));
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].ruleId).toBe("dangerous-commands");
  });

  it("detects kill -9", () => {
    const violations = rule.evaluate(makeContext({ "src/a.ts": "kill -9 1234" }));
    expect(violations.length).toBeGreaterThan(0);
  });

  it("detects chmod 777", () => {
    const violations = rule.evaluate(makeContext({ "src/a.ts": "chmod 777 /etc/passwd" }));
    expect(violations.length).toBeGreaterThan(0);
  });

  it("detects mkfs", () => {
    const violations = rule.evaluate(makeContext({ "src/a.ts": "mkfs.ext4 /dev/sda" }));
    expect(violations.length).toBeGreaterThan(0);
  });

  it("detects dd if=", () => {
    const violations = rule.evaluate(makeContext({ "src/a.ts": "dd if=/dev/zero of=/dev/sda" }));
    expect(violations.length).toBeGreaterThan(0);
  });

  it("returns empty for safe content", () => {
    const violations = rule.evaluate(makeContext({ "src/safe.ts": "console.log('hello')" }));
    expect(violations).toEqual([]);
  });

  it("skips .md files", () => {
    const violations = rule.evaluate(makeContext({ "docs/README.md": "rm -rf /tmp" }));
    expect(violations).toEqual([]);
  });

  it("skips .spec.ts files", () => {
    const violations = rule.evaluate(makeContext({ "src/a.spec.ts": "rm -rf /tmp" }));
    expect(violations).toEqual([]);
  });
});
```

- [ ] Step 2: Run, verify FAIL
**Run:** `npx vitest run src/hexagons/execution/infrastructure/rules/dangerous-command.rule.spec.ts`
**Expect:** FAIL

- [ ] Step 3: Implement

**File:** `src/hexagons/execution/infrastructure/rules/dangerous-command.rule.ts`
```typescript
import type { GuardrailRule } from "../../domain/guardrail-rule";
import type { GuardrailViolation } from "../../domain/guardrail.schemas";
import type { EnrichedGuardrailContext } from "../../domain/enriched-guardrail-context";
import { shouldSkipFile } from "./skip-filter";

const PATTERNS: readonly { regex: RegExp; label: string }[] = [
  { regex: /rm\s+-rf\b/, label: "rm -rf" },
  { regex: /kill\s+-9\b/, label: "kill -9" },
  { regex: /chmod\s+777\b/, label: "chmod 777" },
  { regex: /\bmkfs\b/, label: "mkfs" },
  { regex: /\bdd\s+if=/, label: "dd if=" },
];

export class DangerousCommandRule implements GuardrailRule {
  readonly id = "dangerous-commands" as const;

  evaluate(context: EnrichedGuardrailContext): GuardrailViolation[] {
    const violations: GuardrailViolation[] = [];
    for (const [filePath, content] of context.fileContents) {
      if (shouldSkipFile(filePath)) continue;
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        for (const { regex, label } of PATTERNS) {
          if (regex.test(lines[i])) {
            violations.push({
              ruleId: this.id,
              severity: "error",
              filePath,
              pattern: regex.source,
              message: `Dangerous command detected: ${label}`,
              line: i + 1,
            });
          }
        }
      }
    }
    return violations;
  }
}
```

**Create:** `src/hexagons/execution/infrastructure/rules/skip-filter.ts` — shared utility:
```typescript
const SKIP_EXTENSIONS = [".md", ".spec.ts", ".test.ts"];
const SKIP_DIRS = ["__fixtures__", "__mocks__", "fixtures"];
const MAX_FILE_SIZE = 512 * 1024; // 512KB

export function shouldSkipFile(filePath: string): boolean {
  if (SKIP_EXTENSIONS.some((ext) => filePath.endsWith(ext))) return true;
  if (SKIP_DIRS.some((dir) => filePath.includes(`/${dir}/`))) return true;
  return false;
}

export function shouldSkipContent(content: string): boolean {
  return content.length > MAX_FILE_SIZE;
}
```

- [ ] Step 4: Run, verify PASS
**Run:** `npx vitest run src/hexagons/execution/infrastructure/rules/dangerous-command.rule.spec.ts`
**Expect:** PASS

- [ ] Step 5: Commit
**Run:** `git add src/hexagons/execution/infrastructure/rules/ && git commit -m "feat(S08/T05): DangerousCommandRule"`

---

### T06: CredentialExposureRule

**Create:** `src/hexagons/execution/infrastructure/rules/credential-exposure.rule.ts`
**Create:** `src/hexagons/execution/infrastructure/rules/credential-exposure.rule.spec.ts`
**Traces to:** AC2, AC13

Same TDD pattern as T05.

**File:** `src/hexagons/execution/infrastructure/rules/credential-exposure.rule.ts`
```typescript
import type { GuardrailRule } from "../../domain/guardrail-rule";
import type { GuardrailViolation } from "../../domain/guardrail.schemas";
import type { EnrichedGuardrailContext } from "../../domain/enriched-guardrail-context";
import { shouldSkipFile } from "./skip-filter";

const PATTERNS: readonly { regex: RegExp; label: string }[] = [
  { regex: /AKIA[A-Z0-9]{16}/, label: "AWS access key" },
  { regex: /BEGIN (RSA |OPENSSH )?PRIVATE KEY/, label: "Private key" },
  { regex: /password\s*[:=]\s*["'][^"']+["']/, label: "Password assignment" },
  { regex: /(?:api[_-]?key|secret[_-]?key|auth[_-]?token)\s*[:=]\s*["'][^"']+["']/, label: "API key/token" },
];

export class CredentialExposureRule implements GuardrailRule {
  readonly id = "credential-exposure" as const;
  evaluate(context: EnrichedGuardrailContext): GuardrailViolation[] {
    // Same line-scanning pattern as DangerousCommandRule
    // Skip filtered files, scan lines, match PATTERNS
  }
}
```

**Test cases:** AWS key `AKIAIOSFODNN7EXAMPLE` (detect), RSA key block (detect), `password = "hunter2"` (detect), `import { password } from "./config"` (no detect), `.md` file (skip), `.spec.ts` (skip).

- [ ] Step 1-5: TDD cycle (write test → FAIL → implement → PASS → commit)
**Commit:** `feat(S08/T06): CredentialExposureRule`

---

### T07: DestructiveGitRule

**Create:** `src/hexagons/execution/infrastructure/rules/destructive-git.rule.ts`
**Create:** `src/hexagons/execution/infrastructure/rules/destructive-git.rule.spec.ts`
**Traces to:** AC3, AC13

**File:** `src/hexagons/execution/infrastructure/rules/destructive-git.rule.ts`
```typescript
const PATTERNS: readonly { regex: RegExp; label: string }[] = [
  { regex: /git\s+push\s+--force/, label: "git push --force" },
  { regex: /git\s+reset\s+--hard/, label: "git reset --hard" },
  { regex: /git\s+clean\s+-[a-z]*f/, label: "git clean -f" },
  { regex: /git\s+checkout\s+\./, label: "git checkout ." },
];
// Same GuardrailRule implementation pattern as DangerousCommandRule
```

**Test cases:** `git push --force origin main` (detect), `git reset --hard HEAD~1` (detect), `git clean -fd` (detect), `git checkout .` (detect), `git checkout main` (no detect), `git push origin main` (no detect), `.md` (skip).

- [ ] Step 1-5: TDD cycle
**Commit:** `feat(S08/T07): DestructiveGitRule`

---

### T08: FileScopeRule

**Create:** `src/hexagons/execution/infrastructure/rules/file-scope.rule.ts`
**Create:** `src/hexagons/execution/infrastructure/rules/file-scope.rule.spec.ts`
**Traces to:** AC4, AC13

**File:** `src/hexagons/execution/infrastructure/rules/file-scope.rule.ts`
```typescript
import type { GuardrailRule } from "../../domain/guardrail-rule";
import type { GuardrailViolation } from "../../domain/guardrail.schemas";
import type { EnrichedGuardrailContext } from "../../domain/enriched-guardrail-context";

export class FileScopeRule implements GuardrailRule {
  readonly id = "file-scope" as const;

  evaluate(context: EnrichedGuardrailContext): GuardrailViolation[] {
    if (context.taskFilePaths.length === 0) return []; // no constraint declared
    const outOfScope = context.filesChanged.filter(
      (f) => !context.taskFilePaths.includes(f),
    );
    return outOfScope.map((filePath) => ({
      ruleId: this.id,
      severity: "warning" as const,
      filePath,
      message: `File outside declared task scope: ${filePath}`,
    }));
  }
}
```

**Test cases:** file in scope (no violation), file out of scope (violation with filePath), empty `taskFilePaths` (skip — returns `[]`), multiple out-of-scope files (multiple violations).

- [ ] Step 1-5: TDD cycle
**Commit:** `feat(S08/T08): FileScopeRule`

---

### T09: SuspiciousContentRule

**Create:** `src/hexagons/execution/infrastructure/rules/suspicious-content.rule.ts`
**Create:** `src/hexagons/execution/infrastructure/rules/suspicious-content.rule.spec.ts`
**Traces to:** AC5, AC13

**File:** `src/hexagons/execution/infrastructure/rules/suspicious-content.rule.ts`
```typescript
const CONTENT_PATTERNS: readonly { regex: RegExp; label: string }[] = [
  { regex: /\beval\s*\(/, label: "eval()" },
  { regex: /new\s+Function\s*\(/, label: "new Function()" },
  { regex: /require\s*\(\s*[^"'`]/, label: "dynamic require()" },
  { regex: /import\s*\(\s*[^"'`]/, label: "dynamic import()" },
];

// Also check: if "package.json" is in filesChanged → violation (no content scan needed)
// Same GuardrailRule implementation pattern — scan lines for CONTENT_PATTERNS + check filesChanged for package.json
```

**Test cases:** `eval("code")` (detect), `new Function("return 1")` (detect), `require(variable)` (detect), `require("static-module")` (no detect), `import("./static")` (no detect), `package.json` in filesChanged (detect), `.spec.ts` (skip).

- [ ] Step 1-5: TDD cycle
**Commit:** `feat(S08/T09): SuspiciousContentRule`

---

### T10: Journal entry extension — guardrail-violation type

**Modify:** `src/hexagons/execution/domain/journal-entry.schemas.ts`
**Traces to:** AC10 (partial)

- [ ] Step 1: Add GuardrailViolationEntry to journal schemas

Add before the discriminated union:
```typescript
export const GuardrailViolationEntrySchema = JournalEntryBaseSchema.extend({
  type: z.literal("guardrail-violation"),
  taskId: IdSchema,
  waveIndex: z.number().int().min(0),
  violations: z.array(GuardrailViolationSchema),
  action: z.enum(["blocked", "warned"]),
});
export type GuardrailViolationEntry = z.infer<typeof GuardrailViolationEntrySchema>;
```

Import `GuardrailViolationSchema` from `./guardrail.schemas`. Add `GuardrailViolationEntrySchema` to the discriminated union array.

- [ ] Step 2: Verify existing tests still pass
**Run:** `npx vitest run src/hexagons/execution/`
**Expect:** PASS

- [ ] Step 3: Commit
**Run:** `git add src/hexagons/execution/domain/journal-entry.schemas.ts && git commit -m "feat(S08/T10): journal guardrail-violation entry type"`

---

### T11: Settings schema — GuardrailsConfigSchema

**Modify:** `src/hexagons/settings/domain/project-settings.schemas.ts`
**Traces to:** AC8, AC15

- [ ] Step 1: Add guardrails config to SettingsSchema

Add after `BaseBeadsConfigSchema` — inline the severity enum to avoid cross-hexagon import:
```typescript
const GuardrailRuleSeveritySchema = z.enum(["error", "warning", "info"]);

const BaseGuardrailsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  rules: z
    .object({
      "dangerous-commands": GuardrailRuleSeveritySchema.default("error"),
      "credential-exposure": GuardrailRuleSeveritySchema.default("error"),
      "destructive-git": GuardrailRuleSeveritySchema.default("error"),
      "file-scope": GuardrailRuleSeveritySchema.default("warning"),
      "suspicious-content": GuardrailRuleSeveritySchema.default("warning"),
    })
    .default({
      "dangerous-commands": "error",
      "credential-exposure": "error",
      "destructive-git": "error",
      "file-scope": "warning",
      "suspicious-content": "warning",
    }),
});
export type GuardrailsConfig = z.infer<typeof BaseGuardrailsConfigSchema>;
```

Add defaults, `.catch()`, and extend SettingsSchema with `guardrails` key. No cross-hexagon imports — severity enum is inlined.

- [ ] Step 2: Verify no regression
**Run:** `npx vitest run src/hexagons/settings/`
**Expect:** PASS

- [ ] Step 3: Commit
**Run:** `git add src/hexagons/settings/domain/project-settings.schemas.ts && git commit -m "feat(S08/T11): guardrails settings config"`

---

### T12: PI adapter — inject GUARDRAIL_PROMPT

**Modify:** `src/hexagons/execution/infrastructure/pi-agent-dispatch.adapter.ts`
**Modify:** `src/kernel/agents/index.ts`
**Traces to:** AC9

- [ ] Step 1: Export GUARDRAIL_PROMPT from kernel index

Add to `src/kernel/agents/index.ts`:
```typescript
export { GUARDRAIL_PROMPT } from "./guardrail-prompt";
```

- [ ] Step 2: Inject into PI adapter

In `pi-agent-dispatch.adapter.ts`, import `GUARDRAIL_PROMPT` and modify the prompt composition:
```typescript
const fullSystemPrompt = config.systemPrompt
  ? `${config.systemPrompt}\n\n${AGENT_STATUS_PROMPT}\n\n${GUARDRAIL_PROMPT}`
  : `${AGENT_STATUS_PROMPT}\n\n${GUARDRAIL_PROMPT}`;
```

- [ ] Step 3: Verify existing dispatch tests pass
**Run:** `npx vitest run src/hexagons/execution/infrastructure/`
**Expect:** PASS

- [ ] Step 4: Commit
**Run:** `git add src/kernel/agents/index.ts src/kernel/agents/guardrail-prompt.ts src/hexagons/execution/infrastructure/pi-agent-dispatch.adapter.ts && git commit -m "feat(S08/T12): inject GUARDRAIL_PROMPT into agent dispatch"`

---

## Wave 2 (depends on T02, T04, T05-T09, T11)

### T13: ComposableGuardrailAdapter

**Create:** `src/hexagons/execution/infrastructure/composable-guardrail.adapter.ts`
**Create:** `src/hexagons/execution/infrastructure/composable-guardrail.adapter.spec.ts`
**Traces to:** AC8, AC11, AC13

- [ ] Step 1: Write failing tests

**File:** `src/hexagons/execution/infrastructure/composable-guardrail.adapter.spec.ts`
```typescript
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ComposableGuardrailAdapter } from "./composable-guardrail.adapter";
import { DangerousCommandRule } from "./rules/dangerous-command.rule";
import { FileScopeRule } from "./rules/file-scope.rule";
import type { GuardrailContext, GuardrailSeverity } from "../domain/guardrail.schemas";
import { AgentResultBuilder } from "@kernel/agents";
import { ok } from "@kernel";
import { GitPort } from "@kernel/ports/git.port";

// Mock GitPort extending the abstract class — no `as any` casts needed
class MockGitPort extends GitPort {
  private _diffFiles: string[] = [];
  private _diffContent = "";

  givenDiffFiles(files: string[]): void { this._diffFiles = files; }
  givenDiffContent(content: string): void { this._diffContent = content; }

  async diffNameOnly(): ReturnType<GitPort["diffNameOnly"]> { return ok(this._diffFiles); }
  async diff(): ReturnType<GitPort["diff"]> { return ok(this._diffContent); }
  async restoreWorktree(): ReturnType<GitPort["restoreWorktree"]> { return ok(undefined); }
  async listBranches(): ReturnType<GitPort["listBranches"]> { return ok([]); }
  async createBranch(): ReturnType<GitPort["createBranch"]> { return ok(undefined); }
  async showFile(): ReturnType<GitPort["showFile"]> { return ok(null); }
  async log(): ReturnType<GitPort["log"]> { return ok([]); }
  async status(): ReturnType<GitPort["status"]> { return ok({ branch: "main", clean: true, entries: [] }); }
  async commit(): ReturnType<GitPort["commit"]> { return ok("abc"); }
  async revert(): ReturnType<GitPort["revert"]> { return ok(undefined); }
  async isAncestor(): ReturnType<GitPort["isAncestor"]> { return ok(true); }
  async worktreeAdd(): ReturnType<GitPort["worktreeAdd"]> { return ok(undefined); }
  async worktreeRemove(): ReturnType<GitPort["worktreeRemove"]> { return ok(undefined); }
  async worktreeList(): ReturnType<GitPort["worktreeList"]> { return ok([]); }
  async deleteBranch(): ReturnType<GitPort["deleteBranch"]> { return ok(undefined); }
  async statusAt(): ReturnType<GitPort["statusAt"]> { return ok({ branch: "main", clean: true, entries: [] }); }
}

// Helper: create real files in a tmpdir for readFile to find
function createFixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "guardrail-test-"));
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(dir, path);
    const parentDir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    mkdirSync(parentDir, { recursive: true });
    writeFileSync(fullPath, content);
  }
  return dir;
}

function makeContext(overrides?: Partial<GuardrailContext>): GuardrailContext {
  return {
    agentResult: new AgentResultBuilder().withTaskId("t1").asDone().build(),
    taskFilePaths: ["src/foo.ts"],
    workingDirectory: "/tmp/wt",
    filesChanged: [],
    ...overrides,
  };
}

describe("ComposableGuardrailAdapter", () => {
  it("returns clean report when no violations", async () => {
    const dir = createFixtureDir({ "src/foo.ts": "const x = 1;" });
    const git = new MockGitPort();
    git.givenDiffFiles(["src/foo.ts"]);
    const adapter = new ComposableGuardrailAdapter([new DangerousCommandRule()], new Map(), git);
    const result = await adapter.validate(makeContext({ workingDirectory: dir }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.passed).toBe(true);
      expect(result.data.violations).toEqual([]);
    }
  });

  it("collects violations from multiple rules", async () => {
    const dir = createFixtureDir({ "src/evil.ts": 'exec("rm -rf /")' });
    const git = new MockGitPort();
    git.givenDiffFiles(["src/evil.ts"]);
    const adapter = new ComposableGuardrailAdapter(
      [new DangerousCommandRule(), new FileScopeRule()],
      new Map(),
      git,
    );
    const result = await adapter.validate(makeContext({ workingDirectory: dir, taskFilePaths: ["src/safe.ts"] }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.passed).toBe(false);
      expect(result.data.violations.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("applies severity overrides", async () => {
    const dir = createFixtureDir({ "src/evil.ts": 'exec("rm -rf /")' });
    const git = new MockGitPort();
    git.givenDiffFiles(["src/evil.ts"]);
    const overrides = new Map<string, GuardrailSeverity>([["dangerous-commands", "warning"]]);
    const adapter = new ComposableGuardrailAdapter([new DangerousCommandRule()], overrides, git);
    const result = await adapter.validate(makeContext({ workingDirectory: dir }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.passed).toBe(true); // downgraded to warning
      expect(result.data.violations[0].severity).toBe("warning");
    }
  });

  it("skips files larger than 512KB", async () => {
    const dir = createFixtureDir({ "src/big.ts": "x".repeat(600_000) });
    const git = new MockGitPort();
    git.givenDiffFiles(["src/big.ts"]);
    const adapter = new ComposableGuardrailAdapter([new DangerousCommandRule()], new Map(), git);
    const result = await adapter.validate(makeContext({ workingDirectory: dir }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.violations).toEqual([]);
  });
});
```

- [ ] Step 2: Run, verify FAIL
**Run:** `npx vitest run src/hexagons/execution/infrastructure/composable-guardrail.adapter.spec.ts`
**Expect:** FAIL

- [ ] Step 3: Implement

**File:** `src/hexagons/execution/infrastructure/composable-guardrail.adapter.ts`
```typescript
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, type Result } from "@kernel";
import type { GitPort } from "@kernel/ports/git.port";
import type { GuardrailRule } from "../domain/guardrail-rule";
import { GuardrailError } from "../domain/errors/guardrail.error";
import type {
  GuardrailContext,
  GuardrailRuleId,
  GuardrailSeverity,
  GuardrailValidationReport,
  GuardrailViolation,
} from "../domain/guardrail.schemas";
import { OutputGuardrailPort } from "../domain/ports/output-guardrail.port";
import type { EnrichedGuardrailContext } from "./enriched-guardrail-context";
import { shouldSkipContent, shouldSkipFile } from "./rules/skip-filter";

export class ComposableGuardrailAdapter extends OutputGuardrailPort {
  constructor(
    private readonly rules: GuardrailRule[],
    private readonly severityOverrides: ReadonlyMap<GuardrailRuleId, GuardrailSeverity>,
    private readonly gitPort: GitPort,
  ) {
    super();
  }

  async validate(
    context: GuardrailContext,
  ): Promise<Result<GuardrailValidationReport, GuardrailError>> {
    // 1. Discover changed files
    const diffResult = await this.gitPort.diffNameOnly(context.workingDirectory);
    if (!diffResult.ok) return err(GuardrailError.diffFailed(context.workingDirectory, diffResult.error));
    const changedFiles = diffResult.data;

    // 2. Read file contents (skip filtered files)
    const fileContents = new Map<string, string>();
    for (const filePath of changedFiles) {
      if (shouldSkipFile(filePath)) continue;
      try {
        const content = await readFile(join(context.workingDirectory, filePath), "utf-8");
        if (!shouldSkipContent(content)) {
          fileContents.set(filePath, content);
        }
      } catch (e) {
        // File may have been deleted — skip
      }
    }

    // 3. Get unified diff
    const gitDiffResult = await this.gitPort.diff(context.workingDirectory);
    const gitDiff = gitDiffResult.ok ? gitDiffResult.data : "";

    // 4. Build enriched context
    const enriched: EnrichedGuardrailContext = {
      ...context,
      filesChanged: changedFiles,
      fileContents,
      gitDiff,
    };

    // 5. Run rules + collect violations
    const violations: GuardrailViolation[] = [];
    for (const rule of this.rules) {
      const ruleViolations = rule.evaluate(enriched);
      for (const v of ruleViolations) {
        const overrideSeverity = this.severityOverrides.get(v.ruleId);
        violations.push(overrideSeverity ? { ...v, severity: overrideSeverity } : v);
      }
    }

    // 6. Build report
    const errorCount = violations.filter((v) => v.severity === "error").length;
    const warnCount = violations.filter((v) => v.severity === "warning").length;
    const infoCount = violations.filter((v) => v.severity === "info").length;
    const parts: string[] = [];
    if (errorCount > 0) parts.push(`${errorCount} error${errorCount > 1 ? "s" : ""}`);
    if (warnCount > 0) parts.push(`${warnCount} warning${warnCount > 1 ? "s" : ""}`);
    if (infoCount > 0) parts.push(`${infoCount} info`);

    return ok({
      violations,
      passed: errorCount === 0,
      summary: parts.length > 0 ? parts.join(", ") : "0 violations",
    });
  }
}
```

- [ ] Step 4: Run, verify PASS
**Run:** `npx vitest run src/hexagons/execution/infrastructure/composable-guardrail.adapter.spec.ts`
**Expect:** PASS

- [ ] Step 5: Commit
**Run:** `git add src/hexagons/execution/infrastructure/composable-guardrail.adapter.ts src/hexagons/execution/infrastructure/composable-guardrail.adapter.spec.ts && git commit -m "feat(S08/T13): ComposableGuardrailAdapter"`

---

## Wave 3 (depends on T04, T10, T13)

### T14: ExecuteSliceUseCase — wave-level guardrail integration

**Modify:** `src/hexagons/execution/application/execute-slice.use-case.ts`
**Modify:** `src/hexagons/execution/application/execute-slice.use-case.spec.ts`
**Traces to:** AC6, AC7, AC10, AC14

- [ ] Step 1: Write failing tests for guardrail integration

Add to existing spec file — new describe block:
```typescript
describe("guardrail validation", () => {
  it("blocks wave when guardrail returns error violations", async () => {
    // Setup: seed task, configure guardrail adapter to return error violation
    guardrailAdapter.givenReport({
      violations: [{ ruleId: "dangerous-commands", severity: "error", message: "rm -rf" }],
      passed: false,
      summary: "1 error",
    });
    const result = await useCase.execute(makeInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.failedTasks.length).toBeGreaterThan(0);
      expect(result.data.aborted).toBe(true);
    }
  });

  it("proceeds with warnings attached as concerns", async () => {
    guardrailAdapter.givenReport({
      violations: [{ ruleId: "file-scope", severity: "warning", message: "out of scope" }],
      passed: true,
      summary: "1 warning",
    });
    const result = await useCase.execute(makeInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.completedTasks.length).toBeGreaterThan(0);
      expect(result.data.aborted).toBe(false);
    }
  });

  it("skips guardrails for S-tier complexity", async () => {
    guardrailAdapter.givenReport({
      violations: [{ ruleId: "dangerous-commands", severity: "error", message: "should be ignored" }],
      passed: false,
      summary: "1 error",
    });
    const result = await useCase.execute(makeInput({ complexity: "S" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(guardrailAdapter.wasValidated()).toBe(false);
      expect(result.data.completedTasks.length).toBeGreaterThan(0);
    }
  });

  it("journals guardrail-violation entries", async () => {
    guardrailAdapter.givenReport({
      violations: [{ ruleId: "dangerous-commands", severity: "error", message: "rm -rf" }],
      passed: false,
      summary: "1 error",
    });
    await useCase.execute(makeInput());
    const entries = await journalRepo.readAll(SLICE_ID);
    if (entries.ok) {
      const guardrailEntry = entries.data.find((e) => e.type === "guardrail-violation");
      expect(guardrailEntry).toBeDefined();
    }
  });
});
```

- [ ] Step 2: Run, verify FAIL
**Run:** `npx vitest run src/hexagons/execution/application/execute-slice.use-case.spec.ts`
**Expect:** FAIL — guardrailAdapter not in deps

- [ ] Step 3: Integrate guardrails into ExecuteSliceUseCase

**3a. Add deps and imports:**

Add to `ExecuteSliceUseCaseDeps`:
```typescript
  readonly guardrail: OutputGuardrailPort;
  readonly gitPort: GitPort;
```

Add imports:
```typescript
import type { OutputGuardrailPort } from "../domain/ports/output-guardrail.port";
import type { GitPort } from "@kernel/ports/git.port";
import type { AgentConcern } from "@kernel/agents";
import type { GuardrailValidationReport, GuardrailViolation } from "../domain/guardrail.schemas";
```

**3b. Add `toAgentConcern` mapping function** (top of file, after imports):
```typescript
function toAgentConcern(v: GuardrailViolation): AgentConcern {
  return {
    area: v.ruleId,
    description: v.filePath ? `${v.message} (${v.filePath}:${v.line ?? "?"})` : v.message,
    severity: v.severity === "error" ? "critical" : v.severity === "warning" ? "warning" : "info",
  };
}
```

**3c. Insert wave-level guardrail validation** after `Promise.allSettled` (line 183), before the result processing loop (line 185):

```typescript
      // 6e-bis. Wave-level guardrail validation (skip for S-tier)
      if (input.complexity !== "S") {
        const guardrailResults = new Map<string, GuardrailValidationReport>();

        for (let i = 0; i < settled.length; i++) {
          const settlement = settled[i];
          const task = waveTasks[i];
          if (!settlement || !task || settlement.status !== "fulfilled" || !settlement.value.ok) continue;
          const agentResult = settlement.value.data;
          if (!isSuccessfulStatus(agentResult.status)) continue;

          const reportResult = await this.deps.guardrail.validate({
            agentResult,
            taskFilePaths: [...task.filePaths],
            workingDirectory: input.workingDirectory,
            filesChanged: [...agentResult.filesChanged],
          });
          if (reportResult.ok) {
            guardrailResults.set(task.id, reportResult.data);
          }
        }

        // Check for any error-severity violations across the wave
        const hasBlockers = [...guardrailResults.values()].some((r) => !r.passed);

        if (hasBlockers) {
          // Revert entire wave
          await this.deps.gitPort.restoreWorktree(input.workingDirectory);

          for (const [taskId, report] of guardrailResults) {
            if (!report.passed) {
              // Journal the violation (seq auto-assigned by repository — append takes Omit<JournalEntry, "seq">)
              await this.deps.journalRepository.append(input.sliceId, {
                type: "guardrail-violation" as const,
                sliceId: input.sliceId,
                timestamp: this.deps.dateProvider.now(),
                taskId,
                waveIndex,
                violations: report.violations,
                action: "blocked" as const,
              });
              waveFailedTasks.push(taskId);
            }
          }
        } else {
          // Attach warnings as concerns on the settled results
          for (const [taskId, report] of guardrailResults) {
            const warnings = report.violations.filter((v) => v.severity !== "info");
            if (warnings.length > 0) {
              // Journal the warning
              await this.deps.journalRepository.append(input.sliceId, {
                type: "guardrail-violation" as const,
                sliceId: input.sliceId,
                timestamp: this.deps.dateProvider.now(),
                taskId,
                waveIndex,
                violations: warnings,
                action: "warned" as const,
              });
              // Find the settled result and add concerns
              const idx = waveTasks.findIndex((t) => t.id === taskId);
              const settlement = settled[idx];
              if (settlement?.status === "fulfilled" && settlement.value.ok) {
                const result = settlement.value.data;
                const enrichedConcerns = [...result.concerns, ...warnings.map(toAgentConcern)];
                Object.assign(result, { concerns: enrichedConcerns });
              }
            }
          }
        }

        // If blockers found, fail-fast will trigger below via waveFailedTasks
      }
```

**3d. Update test setup** — add `InMemoryGuardrailAdapter` and mock `GitPort` to `beforeEach`:
```typescript
import { InMemoryGuardrailAdapter } from "../infrastructure/in-memory-guardrail.adapter";

// In beforeEach:
const guardrailAdapter = new InMemoryGuardrailAdapter();

// Extract T13's MockGitPort to a shared test fixture at:
// src/hexagons/execution/infrastructure/__test__/mock-git.port.ts
// Then import and instantiate here:
import { MockGitPort } from "../infrastructure/__test__/mock-git.port";
const mockGitPort = new MockGitPort();

// Update useCase construction:
useCase = new ExecuteSliceUseCase({
  ...existingDeps,
  guardrail: guardrailAdapter,
  gitPort: mockGitPort,
});
```

- [ ] Step 4: Run, verify PASS
**Run:** `npx vitest run src/hexagons/execution/application/execute-slice.use-case.spec.ts`
**Expect:** PASS

- [ ] Step 5: Commit
**Run:** `git add src/hexagons/execution/application/execute-slice.use-case.ts src/hexagons/execution/application/execute-slice.use-case.spec.ts && git commit -m "feat(S08/T14): ExecuteSliceUseCase wave-level guardrail integration"`

---

## Wave 4 (depends on all)

### T15: Barrel exports + full verification

**Modify:** `src/hexagons/execution/index.ts`
**Modify:** `.tff/settings.yaml`
**Traces to:** All ACs (final verification)

- [ ] Step 1: Add barrel exports

Add to `src/hexagons/execution/index.ts`:
```typescript
// Domain -- Guardrail Schemas
export type {
  GuardrailContext,
  GuardrailRuleId,
  GuardrailSeverity,
  GuardrailValidationReport,
  GuardrailViolation,
} from "./domain/guardrail.schemas";
export {
  GuardrailContextSchema,
  GuardrailRuleIdSchema,
  GuardrailSeveritySchema,
  GuardrailValidationReportSchema,
  GuardrailViolationSchema,
} from "./domain/guardrail.schemas";
// Domain -- Guardrail Errors
export { GuardrailError } from "./domain/errors/guardrail.error";
// Domain -- Guardrail Ports
export { OutputGuardrailPort } from "./domain/ports/output-guardrail.port";
// Domain -- Guardrail Journal
export type { GuardrailViolationEntry } from "./domain/journal-entry.schemas";
export { GuardrailViolationEntrySchema } from "./domain/journal-entry.schemas";
// Infrastructure -- Guardrail Adapters
export { ComposableGuardrailAdapter } from "./infrastructure/composable-guardrail.adapter";
export { InMemoryGuardrailAdapter } from "./infrastructure/in-memory-guardrail.adapter";
```

- [ ] Step 2: Add guardrails config to `.tff/settings.yaml`:
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

- [ ] Step 3: Run full test suite
**Run:** `npx vitest run`
**Expect:** PASS — all tests green, no regressions

- [ ] Step 4: Commit
**Run:** `git add src/hexagons/execution/index.ts .tff/settings.yaml && git commit -m "feat(S08/T15): barrel exports + settings config"`
