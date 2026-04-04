import { AgentResultBuilder } from "@kernel/agents";
import { describe, expect, it } from "vitest";
import type { EnrichedGuardrailContext } from "../../../../domain/enriched-guardrail-context";
import { DestructiveGitRule } from "./destructive-git.rule";

function makeContext(fileContents: Record<string, string>): EnrichedGuardrailContext {
  return {
    agentResult: new AgentResultBuilder().asDone().build(),
    taskFilePaths: [],
    workingDirectory: "/tmp",
    filesChanged: Object.keys(fileContents),
    fileContents: new Map(Object.entries(fileContents)),
    gitDiff: "",
  };
}

describe("DestructiveGitRule", () => {
  const rule = new DestructiveGitRule();

  it("detects git push --force", () => {
    const violations = rule.evaluate(
      makeContext({ "src/deploy.ts": "git push --force origin main" }),
    );
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].ruleId).toBe("destructive-git");
  });

  it("detects git reset --hard", () => {
    const violations = rule.evaluate(makeContext({ "src/a.ts": "git reset --hard HEAD~1" }));
    expect(violations.length).toBeGreaterThan(0);
  });

  it("detects git clean -fd", () => {
    const violations = rule.evaluate(makeContext({ "src/a.ts": "git clean -fd" }));
    expect(violations.length).toBeGreaterThan(0);
  });

  it("detects git checkout .", () => {
    const violations = rule.evaluate(makeContext({ "src/a.ts": "git checkout ." }));
    expect(violations.length).toBeGreaterThan(0);
  });

  it("ignores git checkout main", () => {
    const violations = rule.evaluate(makeContext({ "src/a.ts": "git checkout main" }));
    expect(violations).toEqual([]);
  });

  it("ignores git push origin main (no --force)", () => {
    const violations = rule.evaluate(makeContext({ "src/a.ts": "git push origin main" }));
    expect(violations).toEqual([]);
  });

  it("skips .md files", () => {
    const violations = rule.evaluate(makeContext({ "docs/README.md": "git push --force" }));
    expect(violations).toEqual([]);
  });
});
