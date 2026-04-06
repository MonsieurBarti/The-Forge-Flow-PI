# M07-S07: Compressor Notation — Implementation Plan

> For agentic workers: execute task-by-task with TDD.

**Goal:** Formalize existing logic notation into a `COMPRESSOR_PROMPT` constant ∧ inject at dispatch time → all agents write compressed.
**Architecture:** New prompt constant in kernel, injected via existing `PiAgentDispatchAdapter` prompt construction.
**Tech Stack:** TypeScript, Vitest

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/kernel/agents/prompts/compressor-prompt.ts` | Exports `COMPRESSOR_PROMPT` constant w/ notation vocabulary ∧ rules |
| Create | `src/kernel/agents/prompts/compressor-prompt.spec.ts` | Unit tests: content validation, token budget |
| Modify | `src/kernel/agents/index.ts` | Re-export `COMPRESSOR_PROMPT` (line 96 pattern) |
| Modify | `src/hexagons/execution/infrastructure/adapters/agent-dispatch/pi-agent-dispatch.adapter.ts` | Append `COMPRESSOR_PROMPT` to system prompt (lines 283-285) |

---

## Wave 0

### T01: Write failing test for compressor prompt constant

**Files:** Create `src/kernel/agents/prompts/compressor-prompt.spec.ts`
**Traces to:** AC1, AC4

```typescript
// src/kernel/agents/prompts/compressor-prompt.spec.ts
import { describe, expect, it } from "vitest";
import { COMPRESSOR_PROMPT } from "./compressor-prompt";

describe("COMPRESSOR_PROMPT", () => {
  it("exports a non-empty string", () => {
    expect(typeof COMPRESSOR_PROMPT).toBe("string");
    expect(COMPRESSOR_PROMPT.length).toBeGreaterThan(0);
  });

  it("contains notation vocabulary symbols", () => {
    const requiredSymbols = ["∀", "∃", "∈", "∧", "∨", "¬", "→"];
    for (const symbol of requiredSymbols) {
      expect(COMPRESSOR_PROMPT).toContain(symbol);
    }
  });

  it("instructs to preserve code blocks verbatim", () => {
    expect(COMPRESSOR_PROMPT.toLowerCase()).toMatch(/code block|fenced|verbatim/);
  });

  it("stays within 300 token budget (≤1200 chars as proxy)", () => {
    // ~4 chars per token average for English text with symbols
    expect(COMPRESSOR_PROMPT.length).toBeLessThanOrEqual(1200);
  });
});
```

- **Run:** `npx vitest run src/kernel/agents/prompts/compressor-prompt.spec.ts`
- **Expect:** FAIL — module `./compressor-prompt` not found

---

### T02: Implement compressor prompt constant

**Files:** Create `src/kernel/agents/prompts/compressor-prompt.ts`
**Traces to:** AC1, AC3, AC4

```typescript
// src/kernel/agents/prompts/compressor-prompt.ts
export const COMPRESSOR_PROMPT = `
## Compressed Notation

Write all artifacts (specs, plans, research, reports) using compressed notation:

Symbols: ∀ (for all), ∃ (exists), ∈ (element of), ∧ (and), ∨ (or), ¬ (not), → (implies), ⟺ (iff), ⇒ (therefore), ⊆ (subset), | (alternative), ≡ (defined as)

Rules:
- condition → action (not "If condition, then action")
- ∀ item: rule (not "For every item, rule applies")
- x ∈ set (not "x belongs to set")
- ¬action (not "Do not action")
- Short headings (2-4 words), single-line rules, tables over prose
- Collapse multi-line conditionals to single-line

Preserve verbatim: code blocks, schemas, CLI commands, error messages, file paths.
`.trim();
```

- **Run:** `npx vitest run src/kernel/agents/prompts/compressor-prompt.spec.ts`
- **Expect:** PASS — 4/4 tests passing
- **Commit:** `feat(S07/T02): add COMPRESSOR_PROMPT constant`

---

## Wave 1 (depends on Wave 0)

### T03: Add barrel re-export + inject COMPRESSOR_PROMPT into PiAgentDispatchAdapter

**Files:** Modify `src/kernel/agents/index.ts`, Modify `src/hexagons/execution/infrastructure/adapters/agent-dispatch/pi-agent-dispatch.adapter.ts`
**Traces to:** AC1, AC2

**Step A: Barrel re-export** — add after line 96 of `src/kernel/agents/index.ts`:

```typescript
export { COMPRESSOR_PROMPT } from "./prompts/compressor-prompt";
```

**Step B: Adapter injection** — at top of `pi-agent-dispatch.adapter.ts`, add import:
```typescript
import { COMPRESSOR_PROMPT } from "@kernel/agents/prompts/compressor-prompt";
```

Replace lines 283-285:
```typescript
// Before:
const fullSystemPrompt = config.systemPrompt
  ? `${config.systemPrompt}\n\n${AGENT_STATUS_PROMPT}\n\n${GUARDRAIL_PROMPT}`
  : `${AGENT_STATUS_PROMPT}\n\n${GUARDRAIL_PROMPT}`;

// After:
const fullSystemPrompt = config.systemPrompt
  ? `${config.systemPrompt}\n\n${AGENT_STATUS_PROMPT}\n\n${GUARDRAIL_PROMPT}\n\n${COMPRESSOR_PROMPT}`
  : `${AGENT_STATUS_PROMPT}\n\n${GUARDRAIL_PROMPT}\n\n${COMPRESSOR_PROMPT}`;
```

- **Run:** `npx vitest run src/hexagons/execution/ --reporter=verbose`
- **Expect:** PASS — all existing execution tests still pass
- **Commit:** `feat(S07/T03): re-export + inject COMPRESSOR_PROMPT`

---

## Wave 2 (depends on Wave 1)

### T04: Full test suite verification

**Files:** No file changes — verification only
**Traces to:** AC4, AC5

1. Run full test suite: `npx vitest run`
2. Verify AC4: count chars in `COMPRESSOR_PROMPT` (must be ≤1200 chars ≈ ≤300 tokens)
3. AC5 (no information loss) verified during /tff:verify on before/after sample artifact

- **Run:** `npx vitest run`
- **Expect:** PASS — zero regressions
