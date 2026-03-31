import { describe, expect, it } from "vitest";
import {
  GuardrailContextSchema,
  GuardrailRuleIdSchema,
  GuardrailSeveritySchema,
  GuardrailValidationReportSchema,
  GuardrailViolationSchema,
} from "./guardrail.schemas";

describe("GuardrailRuleIdSchema", () => {
  it("accepts valid rule IDs", () => {
    for (const id of [
      "dangerous-commands",
      "credential-exposure",
      "destructive-git",
      "file-scope",
      "suspicious-content",
    ]) {
      expect(GuardrailRuleIdSchema.safeParse(id).success).toBe(true);
    }
  });
  it("rejects unknown rule IDs", () => {
    expect(GuardrailRuleIdSchema.safeParse("unknown-rule").success).toBe(false);
  });
});

describe("GuardrailSeveritySchema", () => {
  it("accepts error, warning, info", () => {
    for (const s of ["error", "warning", "info"]) {
      expect(GuardrailSeveritySchema.safeParse(s).success).toBe(true);
    }
  });
});

describe("GuardrailViolationSchema", () => {
  it("accepts a full violation", () => {
    const result = GuardrailViolationSchema.safeParse({
      ruleId: "dangerous-commands",
      severity: "error",
      filePath: "src/index.ts",
      pattern: "rm\\s+-rf",
      message: "Dangerous command detected: rm -rf",
      line: 42,
    });
    expect(result.success).toBe(true);
  });
  it("accepts minimal violation (optional fields omitted)", () => {
    const result = GuardrailViolationSchema.safeParse({
      ruleId: "file-scope",
      severity: "warning",
      message: "File outside scope",
    });
    expect(result.success).toBe(true);
  });
});

describe("GuardrailValidationReportSchema", () => {
  it("accepts a report with violations", () => {
    const result = GuardrailValidationReportSchema.safeParse({
      violations: [{ ruleId: "dangerous-commands", severity: "error", message: "rm -rf found" }],
      passed: false,
      summary: "1 error",
    });
    expect(result.success).toBe(true);
  });
  it("accepts a clean report", () => {
    const result = GuardrailValidationReportSchema.safeParse({
      violations: [],
      passed: true,
      summary: "0 violations",
    });
    expect(result.success).toBe(true);
  });
});

describe("GuardrailContextSchema", () => {
  it("requires workingDirectory and taskFilePaths", () => {
    const result = GuardrailContextSchema.safeParse({
      agentResult: {},
      taskFilePaths: ["src/foo.ts"],
      workingDirectory: "/tmp/worktree",
      filesChanged: ["src/foo.ts"],
    });
    expect(result.success).toBe(false);
  });
});
