# Spec — M07-S07: Compressor Notation

## Problem

Generated artifacts (SPEC.md, RESEARCH.md, PLAN.md, task prompts) consume significant context window ∧ API tokens. TFF skills/workflows already use formal logic notation organically (66 files), but ¬explicit standard exists. Agents sometimes write verbose prose, sometimes compressed → inconsistent output. This slice formalizes existing notation into a prompt constant ∧ injects it at dispatch time → all dispatched agents write compressed by default.

**Drivers:** context window pressure ∧ cost savings (equal weight).

## Approach

**Skill + dispatch-time injection (Approach B)**

1. Define `COMPRESSOR_PROMPT` constant in `src/kernel/agents/prompts/`
2. Modify `PiAgentDispatchAdapter` (line 283-286) to append `COMPRESSOR_PROMPT` to system prompt block
3. Applies to ALL dispatched agents — no conditional logic, no phase detection

Injection point: `systemPrompt + AGENT_STATUS_PROMPT + GUARDRAIL_PROMPT + COMPRESSOR_PROMPT + taskPrompt`

## Notation Vocabulary

### Logic Operators

| Symbol | Meaning | Replaces |
|---|---|---|
| ∀ | for all | "For every", "Each" |
| ∃ | exists | "There exists", "There is" |
| ∈ | element of | "is in", "belongs to" |
| ∧ | and | "and", "as well as" |
| ∨ | or | "or" |
| ¬ | not | "Do not", "Never", "Must not" |
| → | implies/then | "If...then", "leads to" |
| ⟺ | if and only if | "if and only if", "exactly when" |
| ⇒ | therefore | "therefore", "thus" |
| ⊆ | subset of | "is a subset of", "contained in" |

### Delimiters

| Symbol | Meaning |
|---|---|
| \| | or/alternative |
| ≡ | defined as |

### Shorthand Conventions

- Conditional: `condition → action` replaces "If condition, then action"
- Universal: `∀ item: rule` replaces "For every item, rule applies"
- Membership: `x ∈ set` replaces "x is in/belongs to set"
- Negation: `¬ action` replaces "Do not / Never action"

### Structural Rules

- Short section headings (2-4 words)
- Single-line rules where possible
- Tables over prose lists
- Collapse multi-line conditionals to single-line `condition → action`

### Preserved Verbatim

- Code blocks (fenced)
- Schema definitions
- CLI examples ∧ commands
- Error messages
- File paths

## Injection Mechanism

### Current (line 283-286, pi-agent-dispatch.adapter.ts)

```typescript
const fullSystemPrompt = config.systemPrompt
  ? `${config.systemPrompt}\n\n${AGENT_STATUS_PROMPT}\n\n${GUARDRAIL_PROMPT}`
  : `${AGENT_STATUS_PROMPT}\n\n${GUARDRAIL_PROMPT}`;
const prompt = `${fullSystemPrompt}\n\n---\n\n${config.taskPrompt}`;
```

### Proposed

```typescript
import { COMPRESSOR_PROMPT } from "@kernel/agents/prompts/compressor-prompt";

const fullSystemPrompt = config.systemPrompt
  ? `${config.systemPrompt}\n\n${AGENT_STATUS_PROMPT}\n\n${GUARDRAIL_PROMPT}\n\n${COMPRESSOR_PROMPT}`
  : `${AGENT_STATUS_PROMPT}\n\n${GUARDRAIL_PROMPT}\n\n${COMPRESSOR_PROMPT}`;
const prompt = `${fullSystemPrompt}\n\n---\n\n${config.taskPrompt}`;
```

### File Structure

```
src/kernel/agents/prompts/
  compressor-prompt.ts    ← new: exports COMPRESSOR_PROMPT constant
  guardrail-prompt.ts     ← existing
src/kernel/agents/
  index.ts                ← re-export COMPRESSOR_PROMPT (follows GUARDRAIL_PROMPT pattern)
```

## Acceptance Criteria

- **AC1:** Compressor prompt constant exists w/ formalized vocabulary, rules, ∧ examples
- **AC2:** `COMPRESSOR_PROMPT` injected into all dispatched agent prompts via `PiAgentDispatchAdapter`
- **AC3:** Schemas, code blocks, ∧ CLI examples remain uncompressed (verified by inspection)
- **AC4:** `COMPRESSOR_PROMPT` ≤ 300 tokens ∧ sample artifact written w/ compression is measurably shorter than verbose equivalent (verified during /tff:verify on before/after pair)
- **AC5:** ¬information loss — every branch/edge case in original survives compression (verified by comparing before/after sample artifact during /tff:verify)

## Non-Goals

- ¬bulk migration of existing artifacts (lazy: compressed on next edit only)
- ¬runtime compression transform — agents write compressed natively via prompt
- ¬token counting infrastructure — AC4 verified manually on sample artifacts
- ¬per-agent opt-out — all dispatched agents get compression
- ¬changes to tff plugin skills/workflows — only PI codebase touched

## Complexity Signals

- `estimatedFilesAffected`: 3 (compressor-prompt.ts, pi-agent-dispatch.adapter.ts, kernel/agents/index.ts)
- `newFilesCreated`: 1 (compressor-prompt.ts)
- `modulesAffected`: 1 (execution/infrastructure)
- `requiresInvestigation`: false
- `architectureImpact`: false (additive prompt injection, no port changes)
- `hasExternalIntegrations`: false
- `taskCount`: ~4 (prompt constant, adapter injection, test, AC4 measurement)
- `unknownsSurfaced`: 0
