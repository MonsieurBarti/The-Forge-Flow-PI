import { AgentResultBuilder } from "@kernel/agents";
import { describe, expect, it } from "vitest";
import type { EnrichedGuardrailContext } from "../../domain/enriched-guardrail-context";
import { SuspiciousContentRule } from "./suspicious-content.rule";

function makeContext(
  fileContents: Record<string, string>,
  overrides: Partial<EnrichedGuardrailContext> = {},
): EnrichedGuardrailContext {
  return {
    agentResult: new AgentResultBuilder().asDone().build(),
    taskFilePaths: [],
    workingDirectory: "/tmp",
    filesChanged: [...Object.keys(fileContents), ...(overrides.filesChanged ?? [])],
    fileContents: new Map(Object.entries(fileContents)),
    gitDiff: "",
    ...overrides,
  };
}

describe("SuspiciousContentRule", () => {
  const rule = new SuspiciousContentRule();

  it("detects eval()", () => {
    const violations = rule.evaluate(makeContext({ "src/a.ts": 'eval("code")' }));
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].ruleId).toBe("suspicious-content");
  });

  it("detects new Function()", () => {
    const violations = rule.evaluate(makeContext({ "src/a.ts": 'new Function("return 1")' }));
    expect(violations.length).toBeGreaterThan(0);
  });

  it("detects dynamic require()", () => {
    const violations = rule.evaluate(makeContext({ "src/a.ts": "require(variable)" }));
    expect(violations.length).toBeGreaterThan(0);
  });

  it("ignores static require()", () => {
    const violations = rule.evaluate(makeContext({ "src/a.ts": 'require("static-module")' }));
    expect(violations).toEqual([]);
  });

  it("detects dynamic import()", () => {
    const violations = rule.evaluate(makeContext({ "src/a.ts": "import(variable)" }));
    expect(violations.length).toBeGreaterThan(0);
  });

  it("ignores static import()", () => {
    const violations = rule.evaluate(makeContext({ "src/a.ts": 'import("./static")' }));
    expect(violations).toEqual([]);
  });

  it("detects package.json in filesChanged", () => {
    const ctx = makeContext({}, { filesChanged: ["package.json"] });
    const violations = rule.evaluate(ctx);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].message).toContain("package.json");
  });

  it("skips .spec.ts files", () => {
    const violations = rule.evaluate(makeContext({ "src/a.spec.ts": 'eval("code")' }));
    expect(violations).toEqual([]);
  });
});
