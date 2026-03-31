import { AgentResultBuilder } from "@kernel/agents";
import { describe, expect, it } from "vitest";
import type { EnrichedGuardrailContext } from "../../domain/enriched-guardrail-context";
import { CredentialExposureRule } from "./credential-exposure.rule";

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

describe("CredentialExposureRule", () => {
  const rule = new CredentialExposureRule();

  it("detects AWS access key", () => {
    const violations = rule.evaluate(
      makeContext({ "src/config.ts": "const key = 'AKIAIOSFODNN7EXAMPLE'" }),
    );
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].ruleId).toBe("credential-exposure");
  });

  it("detects RSA private key", () => {
    const violations = rule.evaluate(
      makeContext({ "src/key.ts": "-----BEGIN RSA PRIVATE KEY-----" }),
    );
    expect(violations.length).toBeGreaterThan(0);
  });

  it("detects OPENSSH private key", () => {
    const violations = rule.evaluate(
      makeContext({ "src/key.ts": "-----BEGIN OPENSSH PRIVATE KEY-----" }),
    );
    expect(violations.length).toBeGreaterThan(0);
  });

  it("detects password assignment", () => {
    const violations = rule.evaluate(makeContext({ "src/db.ts": 'password = "hunter2"' }));
    expect(violations.length).toBeGreaterThan(0);
  });

  it("detects api_key assignment", () => {
    const violations = rule.evaluate(makeContext({ "src/api.ts": 'api_key = "sk-123abc"' }));
    expect(violations.length).toBeGreaterThan(0);
  });

  it("detects secret_key assignment", () => {
    const violations = rule.evaluate(makeContext({ "src/api.ts": 'secret_key = "mysecret"' }));
    expect(violations.length).toBeGreaterThan(0);
  });

  it("detects auth_token assignment", () => {
    const violations = rule.evaluate(makeContext({ "src/api.ts": 'auth_token = "tok-abc"' }));
    expect(violations.length).toBeGreaterThan(0);
  });

  it("ignores import statements with password", () => {
    const violations = rule.evaluate(
      makeContext({ "src/auth.ts": 'import { password } from "./config"' }),
    );
    expect(violations).toEqual([]);
  });

  it("skips .md files", () => {
    const violations = rule.evaluate(makeContext({ "docs/README.md": "AKIAIOSFODNN7EXAMPLE" }));
    expect(violations).toEqual([]);
  });

  it("skips .spec.ts files", () => {
    const violations = rule.evaluate(makeContext({ "src/a.spec.ts": 'password = "test"' }));
    expect(violations).toEqual([]);
  });
});
