import { describe, expect, it } from "vitest";
import type { FindingProps } from "../domain/schemas/review.schemas";
import { FixerOutputParser } from "./fixer-output-parser";

const FINDINGS: FindingProps[] = [
  {
    id: "a1b2c3d4-e5f6-4789-8abc-def012345678",
    severity: "critical",
    message: "SQL injection",
    filePath: "src/db.ts",
    lineStart: 10,
  },
  {
    id: "b2c3d4e5-f6a7-4890-9bcd-ef0123456789",
    severity: "medium",
    message: "Unused import",
    filePath: "src/app.ts",
    lineStart: 1,
  },
  {
    id: "c3d4e5f6-a7b8-4901-abcd-f01234567890",
    severity: "low",
    message: "Naming convention",
    filePath: "src/utils.ts",
    lineStart: 5,
  },
];

const parser = new FixerOutputParser();

describe("FixerOutputParser", () => {
  it("parses valid fenced JSON block with fixed and deferred IDs", () => {
    const agentOutput = `
I've addressed the findings.

\`\`\`json
{
  "fixed": ["a1b2c3d4-e5f6-4789-8abc-def012345678"],
  "deferred": ["b2c3d4e5-f6a7-4890-9bcd-ef0123456789"],
  "justifications": {
    "b2c3d4e5-f6a7-4890-9bcd-ef0123456789": "Out of scope"
  },
  "testsPassing": true
}
\`\`\`
`;

    const result = parser.parse(agentOutput, FINDINGS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.fixed).toHaveLength(1);
    const firstFixed = result.data.fixed[0];
    expect(firstFixed?.id).toBe("a1b2c3d4-e5f6-4789-8abc-def012345678");
    expect(firstFixed?.message).toBe("SQL injection");

    expect(result.data.deferred).toHaveLength(2);
    const deferredIds = result.data.deferred.map((f) => f.id);
    expect(deferredIds).toContain("b2c3d4e5-f6a7-4890-9bcd-ef0123456789");
    // unmentioned finding auto-deferred
    expect(deferredIds).toContain("c3d4e5f6-a7b8-4901-abcd-f01234567890");

    expect(result.data.justifications).toEqual({
      "b2c3d4e5-f6a7-4890-9bcd-ef0123456789": "Out of scope",
    });
    expect(result.data.testsPassing).toBe(true);
  });

  it("auto-defers unmentioned findings (AC5c)", () => {
    const agentOutput = `
\`\`\`json
{
  "fixed": ["a1b2c3d4-e5f6-4789-8abc-def012345678"],
  "deferred": [],
  "testsPassing": false
}
\`\`\`
`;

    const result = parser.parse(agentOutput, FINDINGS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.fixed).toHaveLength(1);
    expect(result.data.fixed[0]?.id).toBe("a1b2c3d4-e5f6-4789-8abc-def012345678");

    // The two unmentioned findings should be auto-deferred
    expect(result.data.deferred).toHaveLength(2);
    const deferredIds = result.data.deferred.map((f) => f.id);
    expect(deferredIds).toContain("b2c3d4e5-f6a7-4890-9bcd-ef0123456789");
    expect(deferredIds).toContain("c3d4e5f6-a7b8-4901-abcd-f01234567890");
  });

  it("silently ignores unknown finding IDs (AC5b)", () => {
    const agentOutput = `
\`\`\`json
{
  "fixed": ["a1b2c3d4-e5f6-4789-8abc-def012345678", "unknown-id-that-does-not-exist"],
  "deferred": ["b2c3d4e5-f6a7-4890-9bcd-ef0123456789"],
  "testsPassing": true
}
\`\`\`
`;

    const result = parser.parse(agentOutput, FINDINGS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Only the known ID should appear in fixed
    expect(result.data.fixed).toHaveLength(1);
    expect(result.data.fixed[0]?.id).toBe("a1b2c3d4-e5f6-4789-8abc-def012345678");

    // The unknown ID is silently dropped — not in deferred either
    const allIds = [
      ...result.data.fixed.map((f) => f.id),
      ...result.data.deferred.map((f) => f.id),
    ];
    expect(allIds).not.toContain("unknown-id-that-does-not-exist");
  });

  it("returns Err for missing JSON block (AC6)", () => {
    const agentOutput = "I tried to fix things but here is just text with no JSON.";

    const result = parser.parse(agentOutput, FINDINGS);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("REVIEW.FIXER_FAILED");
    expect(result.error.message).toContain("Failed to parse fixer output");
  });

  it("returns Err for malformed JSON (AC6)", () => {
    const agentOutput = `
\`\`\`json
{ "fixed": ["a1b2c3d4-e5f6-4789-8abc-def012345678", INVALID_JSON }
\`\`\`
`;

    const result = parser.parse(agentOutput, FINDINGS);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("REVIEW.FIXER_FAILED");
    expect(result.error.message).toContain("Failed to parse fixer output");
  });

  it("handles bare JSON object without fences", () => {
    const agentOutput = `Here is my output: { "fixed": ["a1b2c3d4-e5f6-4789-8abc-def012345678"], "deferred": [], "testsPassing": true }`;

    const result = parser.parse(agentOutput, FINDINGS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.fixed).toHaveLength(1);
    expect(result.data.fixed[0]?.id).toBe("a1b2c3d4-e5f6-4789-8abc-def012345678");
  });

  it("maps FindingProps fields correctly from original findings", () => {
    const agentOutput = `
\`\`\`json
{
  "fixed": ["c3d4e5f6-a7b8-4901-abcd-f01234567890"],
  "deferred": ["a1b2c3d4-e5f6-4789-8abc-def012345678", "b2c3d4e5-f6a7-4890-9bcd-ef0123456789"],
  "testsPassing": false
}
\`\`\`
`;

    const result = parser.parse(agentOutput, FINDINGS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const fixed = result.data.fixed[0];
    expect(fixed?.severity).toBe("low");
    expect(fixed?.message).toBe("Naming convention");
    expect(fixed?.filePath).toBe("src/utils.ts");
    expect(fixed?.lineStart).toBe(5);
  });

  it("preserves testsPassing false", () => {
    const agentOutput = `
\`\`\`json
{
  "fixed": [],
  "deferred": ["a1b2c3d4-e5f6-4789-8abc-def012345678"],
  "testsPassing": false
}
\`\`\`
`;

    const result = parser.parse(agentOutput, FINDINGS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.testsPassing).toBe(false);
  });

  it("stores rawOutput in error metadata for missing JSON block", () => {
    const agentOutput = "No JSON here at all.";

    const result = parser.parse(agentOutput, FINDINGS);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.metadata).toBeDefined();
    expect(result.error.metadata?.rawOutput).toBeDefined();
  });
});
