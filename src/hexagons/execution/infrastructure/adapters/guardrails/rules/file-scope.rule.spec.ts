import { AgentResultBuilder } from "@kernel/agents";
import { describe, expect, it } from "vitest";
import type { EnrichedGuardrailContext } from "../../../../domain/enriched-guardrail-context";
import { FileScopeRule } from "./file-scope.rule";

const TASK_ID = "10000001-0000-4000-a000-000000000001";

function makeContext(overrides: Partial<EnrichedGuardrailContext> = {}): EnrichedGuardrailContext {
  return {
    agentResult: new AgentResultBuilder().withTaskId(TASK_ID).asDone().build(),
    taskFilePaths: ["src/foo.ts", "src/bar.ts"],
    workingDirectory: "/tmp",
    filesChanged: ["src/foo.ts"],
    fileContents: new Map(),
    gitDiff: "",
    ...overrides,
  };
}

describe("FileScopeRule", () => {
  const rule = new FileScopeRule();

  it("no violation when all files in scope", () => {
    const violations = rule.evaluate(makeContext({ filesChanged: ["src/foo.ts"] }));
    expect(violations).toEqual([]);
  });

  it("violation for out-of-scope file", () => {
    const violations = rule.evaluate(makeContext({ filesChanged: ["src/foo.ts", "src/evil.ts"] }));
    expect(violations).toHaveLength(1);
    expect(violations[0].ruleId).toBe("file-scope");
    expect(violations[0].severity).toBe("warning");
    expect(violations[0].filePath).toBe("src/evil.ts");
  });

  it("returns empty when taskFilePaths is empty (no constraint)", () => {
    const violations = rule.evaluate(
      makeContext({ taskFilePaths: [], filesChanged: ["src/anything.ts"] }),
    );
    expect(violations).toEqual([]);
  });

  it("multiple out-of-scope files produce multiple violations", () => {
    const violations = rule.evaluate(makeContext({ filesChanged: ["src/a.ts", "src/b.ts"] }));
    expect(violations).toHaveLength(2);
  });
});
