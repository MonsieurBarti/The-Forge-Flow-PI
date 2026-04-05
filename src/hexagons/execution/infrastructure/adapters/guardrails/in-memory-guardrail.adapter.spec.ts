import { AgentResultBuilder } from "@kernel/agents";
import { describe, expect, it } from "vitest";
import type {
  GuardrailContext,
  GuardrailValidationReport,
} from "../../../domain/guardrail.schemas";
import { InMemoryGuardrailAdapter } from "./in-memory-guardrail.adapter";

function makeContext(overrides?: Partial<GuardrailContext>): GuardrailContext {
  return {
    agentResult: new AgentResultBuilder().asDone().build(),
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
