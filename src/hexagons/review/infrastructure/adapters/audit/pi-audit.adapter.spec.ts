import { InMemoryAgentDispatchAdapter } from "@hexagons/execution";
import { err, isErr, isOk, ok, SilentLoggerAdapter } from "@kernel";
import { AgentDispatchError, AgentResultBuilder } from "@kernel/agents";
import { describe, expect, it } from "vitest";
import type { AuditReportProps } from "../../../domain/schemas/completion.schemas";
import { PiAuditAdapter } from "./pi-audit.adapter";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MILESTONE_LABEL = "M05";
const REQUIREMENTS = "Must implement feature X and feature Y.";
const DIFF_CONTENT = "diff --git a/src/x.ts b/src/x.ts\n+export function featureX() {}";
const TASK_ID = "22222222-2222-4222-8222-222222222222";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIntentPromptTemplate(): string {
  return "Audit intent:\nRequirements: {{requirements_content}}\nDiff: {{diff_content}}";
}

function makeSecurityPromptTemplate(): string {
  return "Audit security:\nDiff: {{diff_content}}";
}

function makePromptLoader(): (path: string) => string {
  return (path: string) => {
    if (path === "prompts/audit-milestone-intent.md") return makeIntentPromptTemplate();
    if (path === "prompts/audit-milestone-security.md") return makeSecurityPromptTemplate();
    throw new Error(`Unknown prompt path: ${path}`);
  };
}

function makeModelResolver() {
  return (_profile: string) => ({
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
  });
}

function makeAdapter(dispatch: InMemoryAgentDispatchAdapter) {
  return new PiAuditAdapter(
    dispatch,
    makePromptLoader(),
    makeModelResolver(),
    new SilentLoggerAdapter(),
    () => TASK_ID,
  );
}

function makeValidAuditOutput(verdict: "PASS" | "FAIL", findings: unknown[] = []): string {
  return JSON.stringify({
    verdict,
    findings,
    summary: `Audit completed with verdict ${verdict}`,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PiAuditAdapter", () => {
  it("dispatches spec-reviewer agent with correct config", async () => {
    const dispatch = new InMemoryAgentDispatchAdapter();
    const output = makeValidAuditOutput("PASS");
    dispatch.givenResult(
      TASK_ID,
      ok(new AgentResultBuilder().withTaskId(TASK_ID).withOutput(output).build()),
    );

    const adapter = makeAdapter(dispatch);
    await adapter.auditMilestone({
      milestoneLabel: MILESTONE_LABEL,
      requirementsContent: REQUIREMENTS,
      diffContent: DIFF_CONTENT,
      agentType: "spec-reviewer",
    });

    expect(dispatch.dispatchedConfigs).toHaveLength(1);
    const config = dispatch.dispatchedConfigs[0];
    if (config === undefined) throw new Error("no config dispatched");

    expect(config.taskId).toBe(TASK_ID);
    expect(config.agentType).toBe("spec-reviewer");
    expect(config.sliceId).toBe(MILESTONE_LABEL);
    expect(config.taskPrompt).toContain(REQUIREMENTS);
    expect(config.taskPrompt).toContain(DIFF_CONTENT);
  });

  it("dispatches security-auditor agent with correct config", async () => {
    const dispatch = new InMemoryAgentDispatchAdapter();
    const output = makeValidAuditOutput("PASS");
    dispatch.givenResult(
      TASK_ID,
      ok(new AgentResultBuilder().withTaskId(TASK_ID).withOutput(output).build()),
    );

    const adapter = makeAdapter(dispatch);
    await adapter.auditMilestone({
      milestoneLabel: MILESTONE_LABEL,
      requirementsContent: REQUIREMENTS,
      diffContent: DIFF_CONTENT,
      agentType: "security-auditor",
    });

    expect(dispatch.dispatchedConfigs).toHaveLength(1);
    const config = dispatch.dispatchedConfigs[0];
    if (config === undefined) throw new Error("no config dispatched");

    expect(config.taskId).toBe(TASK_ID);
    expect(config.agentType).toBe("security-auditor");
    expect(config.sliceId).toBe(MILESTONE_LABEL);
    expect(config.taskPrompt).toContain(DIFF_CONTENT);
  });

  it("parses valid JSON output into AuditReportProps", async () => {
    const dispatch = new InMemoryAgentDispatchAdapter();
    const findings = [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        severity: "high",
        message: "Missing validation",
        filePath: "src/foo.ts",
        lineStart: 42,
      },
    ];
    const output = makeValidAuditOutput("FAIL", findings);
    dispatch.givenResult(
      TASK_ID,
      ok(new AgentResultBuilder().withTaskId(TASK_ID).withOutput(output).build()),
    );

    const adapter = makeAdapter(dispatch);
    const result = await adapter.auditMilestone({
      milestoneLabel: MILESTONE_LABEL,
      requirementsContent: REQUIREMENTS,
      diffContent: DIFF_CONTENT,
      agentType: "spec-reviewer",
    });

    expect(isOk(result)).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const report: AuditReportProps = result.data;
    expect(report.verdict).toBe("FAIL");
    expect(report.agentType).toBe("spec-reviewer");
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.severity).toBe("high");
    expect(report.summary).toContain("FAIL");
  });

  it("returns AuditError.parseFailed on invalid JSON output", async () => {
    const dispatch = new InMemoryAgentDispatchAdapter();
    dispatch.givenResult(
      TASK_ID,
      ok(
        new AgentResultBuilder()
          .withTaskId(TASK_ID)
          .withOutput("This is not valid JSON at all.")
          .build(),
      ),
    );

    const adapter = makeAdapter(dispatch);
    const result = await adapter.auditMilestone({
      milestoneLabel: MILESTONE_LABEL,
      requirementsContent: REQUIREMENTS,
      diffContent: DIFF_CONTENT,
      agentType: "spec-reviewer",
    });

    expect(isErr(result)).toBe(true);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("AUDIT.PARSE_FAILED");
    expect(result.error.message).toContain("spec-reviewer");
  });

  it("returns AuditError.dispatchFailed on dispatch failure", async () => {
    const dispatch = new InMemoryAgentDispatchAdapter();
    dispatch.givenResult(TASK_ID, err(AgentDispatchError.sessionTimedOut(TASK_ID, 30000)));

    const adapter = makeAdapter(dispatch);
    const result = await adapter.auditMilestone({
      milestoneLabel: MILESTONE_LABEL,
      requirementsContent: REQUIREMENTS,
      diffContent: DIFF_CONTENT,
      agentType: "security-auditor",
    });

    expect(isErr(result)).toBe(true);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("AUDIT.DISPATCH_FAILED");
    expect(result.error.message).toContain("security-auditor");
  });
});
