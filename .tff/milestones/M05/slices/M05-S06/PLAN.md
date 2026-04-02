# M05-S06: Agent Authoring Protocol — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Formalize agent authoring from hardcoded registry → declarative `.agent.md` resource files with validation, loading, and enforcement.

**Convention override:** The SPEC's directory structure shows tests in `__tests__/` subdirectory. This plan uses colocated flat `.spec.ts` files (matching existing project convention — all 11 existing spec files in `src/kernel/agents/` are colocated, not in `__tests__/`). The spec diagram is aspirational; this plan follows the established pattern.
**Architecture:** Markdown frontmatter files → loader → registry cache → dispatch queries unchanged.
**Tech Stack:** Zod schemas, `yaml` package (existing), `node:fs`, vitest.

## File Structure

### New Files
| File | Responsibility |
|---|---|
| `src/kernel/agents/agent-errors.ts` | AgentValidationError, AgentLoadError, AgentRegistryError |
| `src/kernel/agents/agent-errors.spec.ts` | Error factory tests |
| `src/kernel/agents/agent-validation.service.ts` | Identity/blocklist/rule validation |
| `src/kernel/agents/agent-validation.service.spec.ts` | Validation unit tests |
| `src/kernel/agents/agent-resource-loader.ts` | Parse `.agent.md` files, validate, return Map |
| `src/kernel/agents/agent-resource-loader.spec.ts` | Loader unit tests |
| `src/kernel/agents/agent-template.ts` | `createAgentTemplate()` scaffolding function |
| `src/kernel/agents/agent-template.spec.ts` | Template output validation tests |
| `src/kernel/agents/agent-boundary.spec.ts` | Structural scan of real agent files |
| `src/resources/agents/spec-reviewer.agent.md` | Spec reviewer identity |
| `src/resources/agents/code-reviewer.agent.md` | Code reviewer identity |
| `src/resources/agents/security-auditor.agent.md` | Security auditor identity |
| `src/resources/agents/fixer.agent.md` | Fixer identity |
| `src/resources/agents/executor.agent.md` | Executor identity |

### Modified Files
| File | Change |
|---|---|
| `src/kernel/agents/agent-card.schema.ts` | Add AgentSkillSchema, extend AgentCardSchema |
| `src/kernel/agents/agent-card.schema.spec.ts` | Add tests for new fields |
| `src/kernel/agents/agent-registry.ts` | Refactor to class + singleton + wrappers |
| `src/kernel/agents/agent-registry.spec.ts` | Use `fromCards()` setup, test class API |
| `src/kernel/agents/index.ts` | Export new types/classes |
| `src/kernel/index.ts` | Export new types |
| `src/cli/extension.ts` | Add `initializeAgentRegistry()` call |

---

## Wave 0 (parallel — no dependencies)

### T01: Error types

**Files:** Create `src/kernel/agents/agent-errors.ts`, Create `src/kernel/agents/agent-errors.spec.ts`
**Traces to:** AC16

- [ ] Step 1: Write test `src/kernel/agents/agent-errors.spec.ts`
```typescript
import { describe, expect, it } from "vitest";
import { BaseDomainError } from "@kernel";
import { AgentLoadError, AgentRegistryError, AgentValidationError } from "./agent-errors";

describe("AgentValidationError", () => {
  it("extends BaseDomainError", () => {
    const err = AgentValidationError.identityTooLong(35);
    expect(err).toBeInstanceOf(BaseDomainError);
    expect(err.code).toBe("AGENT.IDENTITY_TOO_LONG");
    expect(err.metadata).toEqual({ lineCount: 35, maxLines: 30 });
  });

  it("creates methodologyDetected error", () => {
    const err = AgentValidationError.methodologyDetected(["you must", "step 1"]);
    expect(err.code).toBe("AGENT.METHODOLOGY_DETECTED");
    expect(err.metadata?.matches).toEqual(["you must", "step 1"]);
  });

  it("creates missingFreshReviewerRule error", () => {
    const err = AgentValidationError.missingFreshReviewerRule("code-reviewer");
    expect(err.code).toBe("AGENT.MISSING_FRESH_REVIEWER_RULE");
  });

  it("creates invalidFreshReviewerRule error", () => {
    const err = AgentValidationError.invalidFreshReviewerRule("fixer");
    expect(err.code).toBe("AGENT.INVALID_FRESH_REVIEWER_RULE");
  });

  it("creates noSkillsDeclared error", () => {
    const err = AgentValidationError.noSkillsDeclared("executor");
    expect(err.code).toBe("AGENT.NO_SKILLS_DECLARED");
  });
});

describe("AgentLoadError", () => {
  it("creates parseError", () => {
    const err = AgentLoadError.parseError("/path/to/file.md", "bad yaml");
    expect(err).toBeInstanceOf(BaseDomainError);
    expect(err.code).toBe("AGENT.PARSE_ERROR");
    expect(err.metadata?.filePath).toBe("/path/to/file.md");
  });

  it("creates promptNotFound", () => {
    const err = AgentLoadError.promptNotFound("/agents/x.md", "prompts/missing.md");
    expect(err.code).toBe("AGENT.PROMPT_NOT_FOUND");
  });

  it("creates duplicateType", () => {
    const err = AgentLoadError.duplicateType("fixer", ["a.md", "b.md"]);
    expect(err.code).toBe("AGENT.DUPLICATE_TYPE");
  });

  it("creates noAgentFiles", () => {
    const err = AgentLoadError.noAgentFiles("/empty/dir");
    expect(err.code).toBe("AGENT.NO_AGENT_FILES");
  });

  it("creates multipleErrors", () => {
    const causes = [
      AgentLoadError.parseError("a.md", "bad"),
      AgentLoadError.parseError("b.md", "worse"),
    ];
    const err = AgentLoadError.multipleErrors(causes);
    expect(err.code).toBe("AGENT.MULTIPLE_LOAD_ERRORS");
    expect(err.metadata?.errorCount).toBe(2);
  });
});

describe("AgentRegistryError", () => {
  it("creates notLoaded", () => {
    const err = AgentRegistryError.notLoaded();
    expect(err).toBeInstanceOf(BaseDomainError);
    expect(err.code).toBe("AGENT.REGISTRY_NOT_LOADED");
  });

  it("creates agentNotFound", () => {
    const err = AgentRegistryError.agentNotFound("brainstormer");
    expect(err.code).toBe("AGENT.NOT_FOUND");
  });
});
```
- [ ] Step 2: Run `npx vitest run src/kernel/agents/agent-errors.spec.ts`, verify FAIL
- [ ] Step 3: Implement `src/kernel/agents/agent-errors.ts`
```typescript
import { BaseDomainError } from "@kernel/errors/base-domain.error";

export class AgentValidationError extends BaseDomainError {
  readonly code: string;

  private constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = code;
  }

  static identityTooLong(lineCount: number): AgentValidationError {
    return new AgentValidationError(
      "AGENT.IDENTITY_TOO_LONG",
      `Agent identity is ${lineCount} lines (max 30)`,
      { lineCount, maxLines: 30 },
    );
  }

  static methodologyDetected(matches: string[]): AgentValidationError {
    return new AgentValidationError(
      "AGENT.METHODOLOGY_DETECTED",
      `Agent identity contains methodology patterns: ${matches.join(", ")}`,
      { matches },
    );
  }

  static missingFreshReviewerRule(agentType: string): AgentValidationError {
    return new AgentValidationError(
      "AGENT.MISSING_FRESH_REVIEWER_RULE",
      `Review-capable agent "${agentType}" must have freshReviewerRule "must-not-be-executor"`,
      { agentType },
    );
  }

  static invalidFreshReviewerRule(agentType: string): AgentValidationError {
    return new AgentValidationError(
      "AGENT.INVALID_FRESH_REVIEWER_RULE",
      `Non-review agent "${agentType}" must have freshReviewerRule "none"`,
      { agentType },
    );
  }

  static noSkillsDeclared(agentType: string): AgentValidationError {
    return new AgentValidationError(
      "AGENT.NO_SKILLS_DECLARED",
      `Agent "${agentType}" must declare at least one skill`,
      { agentType },
    );
  }
}

export class AgentLoadError extends BaseDomainError {
  readonly code: string;

  private constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = code;
  }

  static parseError(filePath: string, cause: string): AgentLoadError {
    return new AgentLoadError(
      "AGENT.PARSE_ERROR",
      `Failed to parse agent file ${filePath}: ${cause}`,
      { filePath, cause },
    );
  }

  static promptNotFound(filePath: string, promptPath: string): AgentLoadError {
    return new AgentLoadError(
      "AGENT.PROMPT_NOT_FOUND",
      `Agent file ${filePath} references nonexistent prompt: ${promptPath}`,
      { filePath, promptPath },
    );
  }

  static duplicateType(agentType: string, files: string[]): AgentLoadError {
    return new AgentLoadError(
      "AGENT.DUPLICATE_TYPE",
      `Agent type "${agentType}" defined in multiple files: ${files.join(", ")}`,
      { agentType, files },
    );
  }

  static noAgentFiles(dir: string): AgentLoadError {
    return new AgentLoadError(
      "AGENT.NO_AGENT_FILES",
      `No *.agent.md files found in ${dir}`,
      { dir },
    );
  }

  static multipleErrors(causes: AgentLoadError[]): AgentLoadError {
    return new AgentLoadError(
      "AGENT.MULTIPLE_LOAD_ERRORS",
      `${causes.length} agent files failed to load:\n${causes.map((e) => `  - ${e.message}`).join("\n")}`,
      { errorCount: causes.length, errors: causes.map((e) => e.message) },
    );
  }
}

export class AgentRegistryError extends BaseDomainError {
  readonly code: string;

  private constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message, metadata);
    this.code = code;
  }

  static notLoaded(): AgentRegistryError {
    return new AgentRegistryError(
      "AGENT.REGISTRY_NOT_LOADED",
      "Agent registry accessed before initialization. Call initializeAgentRegistry() first.",
    );
  }

  static agentNotFound(agentType: string): AgentRegistryError {
    return new AgentRegistryError(
      "AGENT.NOT_FOUND",
      `No agent registered for type "${agentType}"`,
      { agentType },
    );
  }
}
```
- [ ] Step 4: Run `npx vitest run src/kernel/agents/agent-errors.spec.ts`, verify PASS
- [ ] Step 5: Commit `test(S06/T01): agent error types with factory methods`

---

### T02: Schema extension

**Files:** Modify `src/kernel/agents/agent-card.schema.ts`, Modify `src/kernel/agents/agent-card.schema.spec.ts`
**Traces to:** AC2, AC3

- [ ] Step 1: Add new test cases to `src/kernel/agents/agent-card.schema.spec.ts`
```typescript
// Add to existing imports:
import { AgentSkillSchema } from "./agent-card.schema";

// Add new describe blocks:
describe("AgentSkillSchema", () => {
  it("accepts valid skill", () => {
    const skill = AgentSkillSchema.parse({
      name: "critique-then-reflection",
      prompt: "prompts/critique-then-reflection.md",
      strategy: "critique-then-reflection",
    });
    expect(skill.name).toBe("critique-then-reflection");
  });

  it("rejects missing name", () => {
    expect(() => AgentSkillSchema.parse({ prompt: "p.md", strategy: "standard" })).toThrow();
  });

  it("rejects invalid strategy", () => {
    expect(() =>
      AgentSkillSchema.parse({ name: "x", prompt: "p.md", strategy: "unknown" }),
    ).toThrow();
  });
});

// Replace existing AgentCardSchema tests with updated versions including new required fields:
describe("AgentCardSchema (extended)", () => {
  const validCard = {
    type: "code-reviewer",
    displayName: "Code Reviewer",
    description: "Reviews code",
    identity: "You are a senior code reviewer.",
    purpose: "Review code changes for quality",
    scope: "slice",
    freshReviewerRule: "must-not-be-executor",
    capabilities: ["review"],
    defaultModelProfile: "quality",
    skills: [{ name: "ctr", prompt: "prompts/ctr.md", strategy: "critique-then-reflection" }],
    requiredTools: ["Read", "Glob", "Grep"],
  };

  it("parses a fully populated card", () => {
    const card = AgentCardSchema.parse(validCard);
    expect(card.type).toBe("code-reviewer");
    expect(card.identity).toBe("You are a senior code reviewer.");
    expect(card.purpose).toBe("Review code changes for quality");
    expect(card.scope).toBe("slice");
    expect(card.freshReviewerRule).toBe("must-not-be-executor");
    expect(card.skills).toHaveLength(1);
    expect(card.optionalTools).toEqual([]);
  });

  it("rejects card missing identity", () => {
    const { identity: _, ...noIdentity } = validCard;
    expect(() => AgentCardSchema.parse(noIdentity)).toThrow();
  });

  it("rejects card missing purpose", () => {
    const { purpose: _, ...noPurpose } = validCard;
    expect(() => AgentCardSchema.parse(noPurpose)).toThrow();
  });

  it("rejects card missing scope", () => {
    const { scope: _, ...noScope } = validCard;
    expect(() => AgentCardSchema.parse(noScope)).toThrow();
  });

  it("rejects card missing skills", () => {
    const { skills: _, ...noSkills } = validCard;
    expect(() => AgentCardSchema.parse(noSkills)).toThrow();
  });

  it("rejects card missing freshReviewerRule", () => {
    const { freshReviewerRule: _, ...noRule } = validCard;
    expect(() => AgentCardSchema.parse(noRule)).toThrow();
  });

  it("retains defaultModelProfile field name", () => {
    const card = AgentCardSchema.parse(validCard);
    expect(card.defaultModelProfile).toBe("quality");
  });
});
```
- [ ] Step 2: Run `npx vitest run src/kernel/agents/agent-card.schema.spec.ts`, verify FAIL (new fields missing from schema)
- [ ] Step 3: Extend `src/kernel/agents/agent-card.schema.ts`
```typescript
import { ModelProfileNameSchema } from "@kernel/schemas";
import { z } from "zod";

export const AgentTypeSchema = z.enum([
  "spec-reviewer",
  "code-reviewer",
  "security-auditor",
  "fixer",
  "executor",
]);
export type AgentType = z.infer<typeof AgentTypeSchema>;

export const AgentCapabilitySchema = z.enum(["review", "fix", "execute"]);
export type AgentCapability = z.infer<typeof AgentCapabilitySchema>;

export const FreshReviewerRuleSchema = z.enum(["must-not-be-executor", "none"]);
export type FreshReviewerRule = z.infer<typeof FreshReviewerRuleSchema>;

export const AgentScopeSchema = z.enum(["slice", "task"]);
export type AgentScope = z.infer<typeof AgentScopeSchema>;

export const ReviewStrategySchema = z.enum(["standard", "critique-then-reflection"]);

export const AgentSkillSchema = z.object({
  name: z.string().min(1),
  prompt: z.string().min(1),
  strategy: ReviewStrategySchema,
});
export type AgentSkill = z.infer<typeof AgentSkillSchema>;

export const AgentCardSchema = z.object({
  type: AgentTypeSchema,
  displayName: z.string().min(1),
  description: z.string().min(1),
  identity: z.string().min(1),
  purpose: z.string().min(1),
  scope: AgentScopeSchema,
  freshReviewerRule: FreshReviewerRuleSchema,
  capabilities: z.array(AgentCapabilitySchema).min(1),
  defaultModelProfile: ModelProfileNameSchema,
  skills: z.array(AgentSkillSchema).min(1),
  requiredTools: z.array(z.string()),
  optionalTools: z.array(z.string()).default([]),
});
export type AgentCard = z.infer<typeof AgentCardSchema>;
```
- [ ] Step 4: Run `npx vitest run src/kernel/agents/agent-card.schema.spec.ts`, verify PASS
- [ ] Step 5: Commit `feat(S06/T02): extend AgentCard schema with identity, purpose, scope, skills, freshReviewerRule`

**Note:** T02 introduces a `ReviewStrategySchema` in the agent-card schema module. This is a local definition using the same enum values as `review.schemas.ts` — NOT a duplicate. The review hexagon's `ReviewStrategySchema` stays where it is. The agent module needs its own to avoid a kernel→hexagon import.

---

### T03: Agent resource files

**Files:** Create `src/resources/agents/spec-reviewer.agent.md`, `code-reviewer.agent.md`, `security-auditor.agent.md`, `fixer.agent.md`, `executor.agent.md`
**Traces to:** AC1

- [ ] Step 1: Create directory `src/resources/agents/`
- [ ] Step 2: Create `src/resources/agents/spec-reviewer.agent.md`
```markdown
---
type: spec-reviewer
displayName: Spec Reviewer
purpose: Review specifications for completeness, buildability, and correctness
scope: slice
freshReviewerRule: must-not-be-executor
modelProfile: quality
skills:
  - name: standard-review
    prompt: prompts/standard-review.md
    strategy: standard
requiredTools: [Read, Glob, Grep]
capabilities: [review]
---

You are a specification reviewer with deep expertise in software design.
You value clarity, completeness, and buildability above all.
You think in terms of acceptance criteria: can each one be tested?
You approach specs as an architect would review blueprints —
structural integrity matters more than cosmetic finish.
```
- [ ] Step 3: Create `src/resources/agents/code-reviewer.agent.md`
```markdown
---
type: code-reviewer
displayName: Code Reviewer
purpose: Review code changes for correctness, patterns, and quality
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

You are a senior code reviewer who values working software over theoretical purity.
You focus on patterns, YAGNI, test coverage, and readability.
You think about maintainability: will the next developer understand this?
You weigh the cost of change against the severity of the issue.
```
- [ ] Step 4: Create `src/resources/agents/security-auditor.agent.md`
```markdown
---
type: security-auditor
displayName: Security Auditor
purpose: Audit code for security vulnerabilities and OWASP compliance
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

You are a security auditor who thinks like an attacker to defend like an engineer.
You evaluate code through OWASP Top 10 and STRIDE threat models.
You prioritize findings by exploitability and blast radius.
Critical vulnerabilities are non-negotiable; defense in depth is a principle, not a suggestion.
```
- [ ] Step 5: Create `src/resources/agents/fixer.agent.md`
```markdown
---
type: fixer
displayName: Fixer
purpose: Diagnose and fix bugs, test failures, and review feedback
scope: task
freshReviewerRule: none
modelProfile: budget
skills:
  - name: standard-review
    prompt: prompts/standard-review.md
    strategy: standard
requiredTools: [Read, Write, Edit, Bash, Glob, Grep]
capabilities: [fix]
---

You are a diagnostic engineer who fixes problems at their root cause.
You investigate before acting: read the error, check assumptions, try a focused fix.
You run tests after every change to verify the fix doesn't break adjacent behavior.
You push back on incorrect review findings with evidence, not compliance.
```
- [ ] Step 6: Create `src/resources/agents/executor.agent.md`
```markdown
---
type: executor
displayName: Executor
purpose: Execute slice tasks via wave-based parallelism with agent dispatch
scope: slice
freshReviewerRule: none
modelProfile: budget
skills:
  - name: standard-review
    prompt: prompts/standard-review.md
    strategy: standard
requiredTools: [Read, Write, Edit, Bash, Glob, Grep]
capabilities: [execute]
---

You are a disciplined executor who follows plans precisely and reports status honestly.
You claim tasks atomically, execute them in order, and close them with evidence.
You surface blockers early rather than guessing through ambiguity.
You value TDD discipline: failing test first, minimal implementation, then verify.
```
- [ ] Step 7: Commit `feat(S06/T03): create 5 agent resource files`

---

## Wave 1 (depends on T01, T02)

### T04: Validation service

**Files:** Create `src/kernel/agents/agent-validation.service.ts`, Create `src/kernel/agents/agent-validation.service.spec.ts`
**Traces to:** AC4, AC5, AC6

- [ ] Step 1: Write test `src/kernel/agents/agent-validation.service.spec.ts`
```typescript
import { describe, expect, it } from "vitest";
import type { AgentCard } from "./agent-card.schema";
import { AgentValidationError } from "./agent-errors";
import { AgentValidationService } from "./agent-validation.service";

function makeCard(overrides: Partial<AgentCard> = {}): AgentCard {
  return {
    type: "code-reviewer",
    displayName: "Code Reviewer",
    description: "Reviews code",
    identity: "You are a code reviewer.",
    purpose: "Review code",
    scope: "slice",
    freshReviewerRule: "must-not-be-executor",
    capabilities: ["review"],
    defaultModelProfile: "quality",
    skills: [{ name: "ctr", prompt: "prompts/ctr.md", strategy: "critique-then-reflection" }],
    requiredTools: ["Read"],
    optionalTools: [],
    ...overrides,
  };
}

describe("AgentValidationService", () => {
  const service = new AgentValidationService();

  it("returns Ok for valid card", () => {
    const result = service.validate(makeCard());
    expect(result.ok).toBe(true);
  });

  it("returns Err for identity > 30 lines", () => {
    const longIdentity = Array.from({ length: 31 }, (_, i) => `Line ${i + 1}`).join("\n");
    const result = service.validate(makeCard({ identity: longIdentity }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(AgentValidationError);
      expect(result.error.code).toBe("AGENT.IDENTITY_TOO_LONG");
    }
  });

  it("accepts identity with exactly 30 lines", () => {
    const identity = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`).join("\n");
    const result = service.validate(makeCard({ identity }));
    expect(result.ok).toBe(true);
  });

  describe("blocklist", () => {
    it.each([
      ["you must follow", "\\byou must\\b"],
      ["you should always", "\\byou should\\b"],
      ["step 1: do thing", "\\bstep \\d"],
      ["import { foo } from 'bar'", "^import "],
      ["const x = 5", "\\bconst\\s+\\w+\\s*="],
      ["function doThing() {", "\\bfunction\\s+\\w+"],
      ["class MyClass {", "\\bclass\\s+[A-Z]"],
    ])("rejects identity containing '%s'", (identity) => {
      const result = service.validate(makeCard({ identity }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("AGENT.METHODOLOGY_DETECTED");
    });

    it("allows natural language with 'class' in non-code context", () => {
      const result = service.validate(makeCard({ identity: "I value world-class engineering." }));
      expect(result.ok).toBe(true);
    });

    it("allows 'always' and 'never' in identity voice", () => {
      const result = service.validate(
        makeCard({ identity: "I always consider the broader context. I never cut corners." }),
      );
      expect(result.ok).toBe(true);
    });
  });

  describe("freshReviewerRule", () => {
    it("rejects review agent with rule 'none'", () => {
      const result = service.validate(
        makeCard({ capabilities: ["review"], freshReviewerRule: "none" }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("AGENT.MISSING_FRESH_REVIEWER_RULE");
    });

    it("rejects non-review agent with rule 'must-not-be-executor'", () => {
      const result = service.validate(
        makeCard({
          type: "fixer",
          capabilities: ["fix"],
          freshReviewerRule: "must-not-be-executor",
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("AGENT.INVALID_FRESH_REVIEWER_RULE");
    });

    it("accepts non-review agent with rule 'none'", () => {
      const result = service.validate(
        makeCard({ type: "fixer", capabilities: ["fix"], freshReviewerRule: "none" }),
      );
      expect(result.ok).toBe(true);
    });
  });

  it("rejects card with empty skills", () => {
    const result = service.validate(makeCard({ skills: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AGENT.NO_SKILLS_DECLARED");
  });
});
```
- [ ] Step 2: Run `npx vitest run src/kernel/agents/agent-validation.service.spec.ts`, verify FAIL
- [ ] Step 3: Implement `src/kernel/agents/agent-validation.service.ts`
```typescript
import { type Result, err, ok } from "@kernel/result";
import type { AgentCard } from "./agent-card.schema";
import { AgentValidationError } from "./agent-errors";

const MAX_IDENTITY_LINES = 30;

const METHODOLOGY_BLOCKLIST: RegExp[] = [
  // Instructional patterns
  /\bstep \d/,
  /\byou must\b/,
  /\byou should\b/,
  /\byou will\b/,
  /\byou need to\b/,
  // Code syntax (not natural English)
  /^import /m,
  /\brequire\(/,
  /\bfunction\s+\w+/,
  /\bclass\s+[A-Z]/,
  /^export /m,
  /\bconst\s+\w+\s*=/,
  /\blet\s+\w+\s*=/,
  /\bvar\s+\w+\s*=/,
  /\bif\s*\(/,
  /\bfor\s*\(/,
  /\bwhile\s*\(/,
  /\breturn\s+[^.]*;/,
  /=>\s*\{/,
];

export class AgentValidationService {
  validate(card: AgentCard): Result<AgentCard, AgentValidationError> {
    // Rule 1: Identity line count
    const lines = card.identity.split("\n").length;
    if (lines > MAX_IDENTITY_LINES) {
      return err(AgentValidationError.identityTooLong(lines));
    }

    // Rule 2: Methodology blocklist
    const matches: string[] = [];
    for (const pattern of METHODOLOGY_BLOCKLIST) {
      if (pattern.test(card.identity)) {
        matches.push(pattern.source);
      }
    }
    if (matches.length > 0) {
      return err(AgentValidationError.methodologyDetected(matches));
    }

    // Rule 4: Review agents must have must-not-be-executor
    const hasReviewCapability = card.capabilities.includes("review");
    if (hasReviewCapability && card.freshReviewerRule !== "must-not-be-executor") {
      return err(AgentValidationError.missingFreshReviewerRule(card.type));
    }

    // Rule 5: Non-review agents must have none
    if (!hasReviewCapability && card.freshReviewerRule !== "none") {
      return err(AgentValidationError.invalidFreshReviewerRule(card.type));
    }

    // Rule 6: At least one skill
    if (card.skills.length === 0) {
      return err(AgentValidationError.noSkillsDeclared(card.type));
    }

    return ok(card);
  }
}
```
- [ ] Step 4: Run `npx vitest run src/kernel/agents/agent-validation.service.spec.ts`, verify PASS
- [ ] Step 5: Commit `feat(S06/T04): agent validation service with blocklist and rule enforcement`

---

## Wave 2 (parallel — depends on T04)

### T05: Resource loader

**Files:** Create `src/kernel/agents/agent-resource-loader.ts`, Create `src/kernel/agents/agent-resource-loader.spec.ts`
**Traces to:** AC7, AC8, AC9

- [ ] Step 1: Write test `src/kernel/agents/agent-resource-loader.spec.ts`
```typescript
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentLoadError } from "./agent-errors";
import { AgentResourceLoader } from "./agent-resource-loader";

const TEST_DIR = join(tmpdir(), "tff-agent-loader-test");

function writeAgent(name: string, content: string): void {
  writeFileSync(join(TEST_DIR, "agents", name), content, "utf-8");
}

function writePrompt(name: string): void {
  writeFileSync(join(TEST_DIR, name), "prompt content", "utf-8");
}

const VALID_AGENT = `---
type: fixer
displayName: Fixer
purpose: Fix bugs
scope: task
freshReviewerRule: none
modelProfile: budget
skills:
  - name: standard
    prompt: prompts/standard.md
    strategy: standard
requiredTools: [Read, Bash]
capabilities: [fix]
---

You are a fixer.`;

describe("AgentResourceLoader", () => {
  const loader = new AgentResourceLoader();

  beforeEach(() => {
    mkdirSync(join(TEST_DIR, "agents"), { recursive: true });
    mkdirSync(join(TEST_DIR, "prompts"), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  it("loads a valid agent file", () => {
    writeAgent("fixer.agent.md", VALID_AGENT);
    writePrompt("prompts/standard.md");
    const result = loader.loadAll(TEST_DIR);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.size).toBe(1);
      const card = result.data.get("fixer");
      expect(card?.identity).toBe("You are a fixer.");
      expect(card?.description).toBe("Fix bugs"); // derived from purpose
      expect(card?.defaultModelProfile).toBe("budget"); // mapped from modelProfile
    }
  });

  it("returns Err for malformed YAML", () => {
    writeAgent("bad.agent.md", "---\n: invalid yaml [[[");
    const result = loader.loadAll(TEST_DIR);
    expect(result.ok).toBe(false);
  });

  it("returns Err when prompt file does not exist", () => {
    writeAgent("fixer.agent.md", VALID_AGENT);
    // Do NOT create the prompt file
    const result = loader.loadAll(TEST_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toMatch(/PROMPT_NOT_FOUND|MULTIPLE/);
    }
  });

  it("returns Err with multiple causes for multiple invalid files", () => {
    writeAgent("a.agent.md", "---\n: bad");
    writeAgent("b.agent.md", "---\n: also bad");
    const result = loader.loadAll(TEST_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AGENT.MULTIPLE_LOAD_ERRORS");
    }
  });

  it("returns Err for duplicate agent types", () => {
    writeAgent("fixer1.agent.md", VALID_AGENT);
    writeAgent("fixer2.agent.md", VALID_AGENT);
    writePrompt("prompts/standard.md");
    const result = loader.loadAll(TEST_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("duplicate");
    }
  });

  it("returns Err when no agent files exist", () => {
    const result = loader.loadAll(TEST_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AGENT.NO_AGENT_FILES");
    }
  });

  it("maps modelProfile to defaultModelProfile", () => {
    writeAgent("fixer.agent.md", VALID_AGENT);
    writePrompt("prompts/standard.md");
    const result = loader.loadAll(TEST_DIR);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.get("fixer")?.defaultModelProfile).toBe("budget");
    }
  });

  it("sets description equal to purpose", () => {
    writeAgent("fixer.agent.md", VALID_AGENT);
    writePrompt("prompts/standard.md");
    const result = loader.loadAll(TEST_DIR);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.get("fixer")?.description).toBe("Fix bugs");
    }
  });
});
```
- [ ] Step 2: Run `npx vitest run src/kernel/agents/agent-resource-loader.spec.ts`, verify FAIL
- [ ] Step 3: Implement `src/kernel/agents/agent-resource-loader.ts`

Key implementation points:
- `parseFrontmatter(content: string)`: split on `---` delimiters, parse YAML with `import { parse as parseYaml } from "yaml"`, return `{ frontmatter: Record<string, unknown>, body: string }`
- `loadAll(resourceDir: string)`: glob `agents/*.agent.md`, parse each, validate each, check prompt existence, collect errors, return `Result<Map, AgentLoadError>`
- Map frontmatter `modelProfile` → card `defaultModelProfile`
- Set card `description` = frontmatter `purpose`
- Use `AgentCardSchema.safeParse()` for Zod validation
- Use `AgentValidationService.validate()` for domain validation
- Check `existsSync(join(resourceDir, skill.prompt))` for prompt existence
- Collect all errors → `AgentLoadError.multipleErrors()` if >1, single error if 1

- [ ] Step 4: Run `npx vitest run src/kernel/agents/agent-resource-loader.spec.ts`, verify PASS
- [ ] Step 5: Commit `feat(S06/T05): agent resource loader with frontmatter parsing and collect-all errors`

---

### T06: Template scaffolding

**Files:** Create `src/kernel/agents/agent-template.ts`, Create `src/kernel/agents/agent-template.spec.ts`
**Traces to:** AC12

- [ ] Step 1: Write test `src/kernel/agents/agent-template.spec.ts`
```typescript
import { describe, expect, it } from "vitest";
import { AgentCardSchema } from "./agent-card.schema";
import { createAgentTemplate } from "./agent-template";
import { AgentValidationService } from "./agent-validation.service";

describe("createAgentTemplate", () => {
  it("produces valid .agent.md content", () => {
    const content = createAgentTemplate("fixer", {
      displayName: "Fixer",
      purpose: "Fix things",
      scope: "task",
      capabilities: ["fix"],
      modelProfile: "budget",
      freshReviewerRule: "none",
      skills: [{ name: "standard", prompt: "prompts/standard-review.md", strategy: "standard" }],
    });

    expect(content).toContain("---");
    expect(content).toContain("type: fixer");
    expect(content).toContain("displayName: Fixer");
  });

  it("output passes AgentValidationService", () => {
    const content = createAgentTemplate("code-reviewer", {
      displayName: "Code Reviewer",
      purpose: "Review code",
      scope: "slice",
      capabilities: ["review"],
      modelProfile: "quality",
      freshReviewerRule: "must-not-be-executor",
      skills: [{ name: "ctr", prompt: "prompts/ctr.md", strategy: "critique-then-reflection" }],
    });

    // Parse the generated content through the same pipeline the loader uses
    const lines = content.split("\n");
    const firstDash = lines.indexOf("---");
    const secondDash = lines.indexOf("---", firstDash + 1);
    const body = lines.slice(secondDash + 1).join("\n").trim();

    // Body should be valid for validation service (<=30 lines, no methodology)
    expect(body.split("\n").length).toBeLessThanOrEqual(30);

    const service = new AgentValidationService();
    const card = AgentCardSchema.parse({
      type: "code-reviewer",
      displayName: "Code Reviewer",
      description: "Review code",
      identity: body,
      purpose: "Review code",
      scope: "slice",
      freshReviewerRule: "must-not-be-executor",
      capabilities: ["review"],
      defaultModelProfile: "quality",
      skills: [{ name: "ctr", prompt: "prompts/ctr.md", strategy: "critique-then-reflection" }],
      requiredTools: [],
      optionalTools: [],
    });
    const result = service.validate(card);
    expect(result.ok).toBe(true);
  });

  it("uses placeholder identity when none provided", () => {
    const content = createAgentTemplate("fixer", {
      displayName: "Fixer",
      purpose: "Fix things",
      scope: "task",
      capabilities: ["fix"],
      modelProfile: "budget",
      freshReviewerRule: "none",
    });

    expect(content).toContain("You are a Fixer");
  });

  it("uses custom identity when provided", () => {
    const content = createAgentTemplate("fixer", {
      displayName: "Fixer",
      purpose: "Fix things",
      scope: "task",
      capabilities: ["fix"],
      modelProfile: "budget",
      freshReviewerRule: "none",
      identity: "Custom identity text here.",
    });

    expect(content).toContain("Custom identity text here.");
  });
});
```
- [ ] Step 2: Run `npx vitest run src/kernel/agents/agent-template.spec.ts`, verify FAIL
- [ ] Step 3: Implement `src/kernel/agents/agent-template.ts`

Key implementation: use `yaml` package's `stringify()` to serialize frontmatter, concatenate with body.
```typescript
import { stringify } from "yaml";
import type { AgentCapability, AgentSkill, AgentType } from "./agent-card.schema";

export interface CreateAgentOptions {
  displayName: string;
  purpose: string;
  scope: "slice" | "task";
  capabilities: AgentCapability[];
  modelProfile: "quality" | "balanced" | "budget";
  freshReviewerRule: "must-not-be-executor" | "none";
  skills?: AgentSkill[];
  identity?: string;
  requiredTools?: string[];
}

export function createAgentTemplate(type: AgentType, options: CreateAgentOptions): string {
  const frontmatter = {
    type,
    displayName: options.displayName,
    purpose: options.purpose,
    scope: options.scope,
    freshReviewerRule: options.freshReviewerRule,
    modelProfile: options.modelProfile,
    skills: options.skills ?? [
      { name: "standard", prompt: "prompts/standard-review.md", strategy: "standard" },
    ],
    requiredTools: options.requiredTools ?? [],
    capabilities: options.capabilities,
  };

  const identity =
    options.identity ?? `You are a ${options.displayName}. Define your values and perspective here.`;

  return `---\n${stringify(frontmatter).trimEnd()}\n---\n\n${identity}\n`;
}
```
- [ ] Step 4: Run `npx vitest run src/kernel/agents/agent-template.spec.ts`, verify PASS
- [ ] Step 5: Commit `feat(S06/T06): agent template scaffolding function`

---

## Wave 3 (depends on T05, T02)

### T07: Registry refactor

**Files:** Modify `src/kernel/agents/agent-registry.ts`, Modify `src/kernel/agents/agent-registry.spec.ts`
**Traces to:** AC10, AC11, AC15b

- [ ] Step 1: Update test `src/kernel/agents/agent-registry.spec.ts`

Replace the existing test file to test the new class API while preserving backward-compat function tests:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentCard, AgentType } from "./agent-card.schema";
import { AgentTypeSchema } from "./agent-card.schema";
import {
  AgentRegistry,
  findAgentsByCapability,
  getAgentCard,
  initializeAgentRegistry,
  resetAgentRegistry,
} from "./agent-registry";

function makeTestCard(type: AgentType): AgentCard {
  return {
    type,
    displayName: type,
    description: `Agent: ${type}`,
    identity: `You are a ${type}.`,
    purpose: `Purpose of ${type}`,
    scope: "slice",
    freshReviewerRule: type === "fixer" || type === "executor" ? "none" : "must-not-be-executor",
    capabilities: type === "fixer" ? ["fix"] : type === "executor" ? ["execute"] : ["review"],
    defaultModelProfile: type === "fixer" || type === "executor" ? "budget" : "quality",
    skills: [{ name: "std", prompt: "prompts/std.md", strategy: "standard" }],
    requiredTools: ["Read"],
    optionalTools: [],
  };
}

function makeTestCards(): Map<AgentType, AgentCard> {
  const cards = new Map<AgentType, AgentCard>();
  for (const type of AgentTypeSchema.options) {
    cards.set(type, makeTestCard(type));
  }
  return cards;
}

describe("AgentRegistry", () => {
  describe("fromCards", () => {
    it("creates registry queryable by get()", () => {
      const registry = AgentRegistry.fromCards(makeTestCards());
      const card = registry.get("code-reviewer");
      expect(card?.type).toBe("code-reviewer");
    });

    it("has() returns true for known types", () => {
      const registry = AgentRegistry.fromCards(makeTestCards());
      expect(registry.has("fixer")).toBe(true);
    });

    it("has() returns false for unknown types", () => {
      const registry = AgentRegistry.fromCards(new Map());
      expect(registry.has("fixer")).toBe(false);
    });

    it("getAll() returns all cards", () => {
      const registry = AgentRegistry.fromCards(makeTestCards());
      expect(registry.getAll().size).toBe(5);
    });
  });
});

describe("backward-compat wrappers", () => {
  beforeEach(() => {
    initializeAgentRegistry(AgentRegistry.fromCards(makeTestCards()));
  });

  afterEach(() => {
    resetAgentRegistry();
  });

  it("getAgentCard returns card for valid type", () => {
    const card = getAgentCard("spec-reviewer");
    expect(card.type).toBe("spec-reviewer");
  });

  it("getAgentCard throws for missing type in registry", () => {
    initializeAgentRegistry(AgentRegistry.fromCards(new Map()));
    expect(() => getAgentCard("spec-reviewer")).toThrow(/Missing registry entry/);
  });

  it("findAgentsByCapability returns review agents", () => {
    const agents = findAgentsByCapability("review");
    expect(agents.length).toBe(3);
    for (const a of agents) expect(a.capabilities).toContain("review");
  });

  it("getAll() returns all cards via registry instance", () => {
    const registry = AgentRegistry.fromCards(makeTestCards());
    expect(registry.getAll().size).toBe(5);
  });
});

describe("before initialization", () => {
  beforeEach(() => {
    resetAgentRegistry();
  });

  it("getAgentCard throws AgentRegistryError.notLoaded", () => {
    expect(() => getAgentCard("fixer")).toThrow(/before initialization/);
  });
});
```
- [ ] Step 2: Run `npx vitest run src/kernel/agents/agent-registry.spec.ts`, verify FAIL
- [ ] Step 3: Refactor `src/kernel/agents/agent-registry.ts`

Key implementation:
- `AgentRegistry` class with `private cards`, `static fromCards()`, `static loadFromResources()`, `get()`, `getAll()`, `has()`, `findByCapability()`
- `fromCards()` is pure — only creates instance, does NOT wire singleton
- `initializeAgentRegistry(registry)` is the ONLY way to wire the singleton (explicit, no hidden side effects)
- Module-level `getAgentCard()`, `findAgentsByCapability()` delegate to `_singleton`
- `AGENT_REGISTRY` export is **dropped** — only used in test file which is being rewritten. The getter-via-destructure pattern would throw at import time. Tests use `registry.getAll()` directly.
- `resetAgentRegistry()` for test teardown
- Before init: throw with `AgentRegistryError.notLoaded()` message

```typescript
import type { Result } from "@kernel/result";
import { ok } from "@kernel/result";
import type { AgentCapability, AgentCard, AgentType } from "./agent-card.schema";
import type { AgentLoadError } from "./agent-errors";
import { AgentRegistryError } from "./agent-errors";
import type { AgentResourceLoader } from "./agent-resource-loader";

let _singleton: AgentRegistry | undefined;

export class AgentRegistry {
  private constructor(private readonly cards: ReadonlyMap<AgentType, AgentCard>) {}

  static fromCards(cards: Map<AgentType, AgentCard>): AgentRegistry {
    return new AgentRegistry(cards);
  }

  static loadFromResources(
    loader: AgentResourceLoader,
    resourceDir: string,
  ): Result<AgentRegistry, AgentLoadError> {
    const result = loader.loadAll(resourceDir);
    if (!result.ok) return result;
    return ok(AgentRegistry.fromCards(result.data));
  }

  get(type: AgentType): AgentCard | undefined {
    return this.cards.get(type);
  }

  getAll(): ReadonlyMap<AgentType, AgentCard> {
    return this.cards;
  }

  has(type: AgentType): boolean {
    return this.cards.has(type);
  }

  findByCapability(capability: AgentCapability): AgentCard[] {
    const result: AgentCard[] = [];
    for (const card of this.cards.values()) {
      if (card.capabilities.includes(capability)) result.push(card);
    }
    return result;
  }
}

function requireSingleton(): AgentRegistry {
  if (!_singleton) {
    throw AgentRegistryError.notLoaded();
  }
  return _singleton;
}

export function getAgentCard(type: AgentType): AgentCard {
  const card = requireSingleton().get(type);
  if (!card) {
    throw new Error(
      `[BUG] Missing registry entry for agent type "${type}". This is a programming error.`,
    );
  }
  return card;
}

export function findAgentsByCapability(capability: AgentCapability): AgentCard[] {
  return requireSingleton().findByCapability(capability);
}

export function initializeAgentRegistry(registry: AgentRegistry): void {
  _singleton = registry;
}

export function resetAgentRegistry(): void {
  _singleton = undefined;
}
```

- [ ] Step 4: Run `npx vitest run src/kernel/agents/agent-registry.spec.ts`, verify PASS
- [ ] Step 5: Commit `refactor(S06/T07): agent registry class with singleton and backward-compat wrappers`

---

## Wave 4 (parallel — depends on T07, T03, T05)

### T08: Boundary enforcement test

**Files:** Create `src/kernel/agents/agent-boundary.spec.ts`
**Traces to:** AC13, AC14

- [ ] Step 1: Write structural test `src/kernel/agents/agent-boundary.spec.ts`
```typescript
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentTypeSchema } from "./agent-card.schema";
import { AgentResourceLoader } from "./agent-resource-loader";
import { AgentValidationService } from "./agent-validation.service";

const RESOURCES_DIR = join(import.meta.dirname, "../../resources");

describe("Agent boundary enforcement", () => {
  const loader = new AgentResourceLoader();
  const validator = new AgentValidationService();

  it("loads all agent files without errors", () => {
    const result = loader.loadAll(RESOURCES_DIR);
    expect(result.ok, result.ok ? "" : result.error.message).toBe(true);
  });

  it("all 5 agents are present (migration guard)", () => {
    const result = loader.loadAll(RESOURCES_DIR);
    if (!result.ok) throw new Error(result.error.message);
    const types = [...result.data.keys()];
    for (const expected of AgentTypeSchema.options) {
      expect(types, `Missing agent: ${expected}`).toContain(expected);
    }
    expect(types).toHaveLength(5);
  });

  it("every agent passes validation", () => {
    const result = loader.loadAll(RESOURCES_DIR);
    if (!result.ok) throw new Error(result.error.message);
    for (const [type, card] of result.data) {
      const validation = validator.validate(card);
      expect(validation.ok, `${type} failed validation: ${!validation.ok ? validation.error.message : ""}`).toBe(true);
    }
  });

  it("every agent identity is <=30 lines", () => {
    const result = loader.loadAll(RESOURCES_DIR);
    if (!result.ok) throw new Error(result.error.message);
    for (const [type, card] of result.data) {
      const lines = card.identity.split("\n").length;
      expect(lines, `${type} identity has ${lines} lines`).toBeLessThanOrEqual(30);
    }
  });
});
```
- [ ] Step 2: Run `npx vitest run src/kernel/agents/agent-boundary.spec.ts`, verify PASS (all agents are valid)
- [ ] Step 3: Commit `test(S06/T08): agent boundary enforcement and migration guard`

---

### T09: Barrel exports and composition root

**Files:** Modify `src/kernel/agents/index.ts`, Modify `src/kernel/index.ts`, Modify `src/cli/extension.ts`
**Traces to:** AC15a, AC15b

- [ ] Step 1: Update `src/kernel/agents/index.ts` — remove `AGENT_REGISTRY` export, add new types:
```typescript
// Add after existing schema exports:
export type { AgentScope, AgentSkill, FreshReviewerRule } from "./agent-card.schema";
export { AgentScopeSchema, AgentSkillSchema, FreshReviewerRuleSchema } from "./agent-card.schema";
// Errors
export { AgentLoadError, AgentRegistryError, AgentValidationError } from "./agent-errors";
// Services
export { AgentValidationService } from "./agent-validation.service";
export { AgentResourceLoader } from "./agent-resource-loader";
// Registry (AGENT_REGISTRY dropped — was only used in test, getter would throw at import time)
export {
  AgentRegistry,
  findAgentsByCapability,
  getAgentCard,
  initializeAgentRegistry,
  resetAgentRegistry,
} from "./agent-registry";
// Template
export { createAgentTemplate } from "./agent-template";
export type { CreateAgentOptions } from "./agent-template";
```
- [ ] Step 2: Update `src/kernel/index.ts`:
  - **Remove** `AGENT_REGISTRY` from the import and re-export (it no longer exists in `agent-registry.ts`)
  - **Add** new type exports: `AgentScope`, `AgentSkill`, `FreshReviewerRule`, `CreateAgentOptions`
  - **Add** new value exports: `AgentScopeSchema`, `AgentSkillSchema`, `FreshReviewerRuleSchema`, `AgentRegistry`, `AgentValidationService`, `AgentResourceLoader`, `AgentLoadError`, `AgentRegistryError`, `AgentValidationError`, `createAgentTemplate`, `initializeAgentRegistry`, `resetAgentRegistry`
- [ ] Step 3: Add `initializeAgentRegistry()` to `src/cli/extension.ts` — insert after shared infrastructure, before hexagon extensions:
```typescript
// Add imports:
import { AgentResourceLoader, AgentRegistry, initializeAgentRegistry } from "@kernel/agents";
import { join } from "node:path";

// Inside createTffExtension, after dateProvider (line ~77), before repositories:
// --- Agent registry ---
const agentLoader = new AgentResourceLoader();
const agentRegistryResult = AgentRegistry.loadFromResources(
  agentLoader,
  join(options.projectRoot, "src/resources"),
);
if (!agentRegistryResult.ok) {
  throw new Error(`Failed to load agent registry: ${agentRegistryResult.error.message}`);
}
initializeAgentRegistry(agentRegistryResult.data);
```
- [ ] Step 4: Run full test suite `npx vitest run src/kernel/agents/`, verify all PASS
- [ ] Step 5: Verify `AgentDispatchPort` unchanged: `git diff src/kernel/agents/agent-dispatch.port.ts` should show no changes
- [ ] Step 6: Commit `feat(S06/T09): barrel exports and composition root wiring`

---

## Dependency Graph

```
T01 ─────┐
          ├──► T04 ─────┬──► T05 ───┬──► T07 ───┬──► T08
T02 ─────┤              │           │            ├──► T09
          │              └──► T06    │            │
T03 ──────┼──────────────────────────┘            │
          └───────────────────────────────────────┘
```

## Wave Summary

| Wave | Tasks | Parallel? | Depends On |
|------|-------|-----------|------------|
| 0 | T01, T02, T03 | yes | — |
| 1 | T04 | no | T01, T02 |
| 2 | T05, T06 | yes | T04 |
| 3 | T07 | no | T05, T02 |
| 4 | T08, T09 | yes | T07, T03 |
