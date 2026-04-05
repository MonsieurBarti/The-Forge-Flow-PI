import { AgentResultBuilder } from "@kernel/agents";
import { describe, expect, it } from "vitest";
import type { EnrichedGuardrailContext } from "../../../../domain/enriched-guardrail-context";
import { DangerousCommandRule } from "./dangerous-command.rule";

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
