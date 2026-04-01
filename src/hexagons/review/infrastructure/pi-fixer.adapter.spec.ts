import { InMemoryAgentDispatchAdapter } from "@hexagons/execution";
import { err, isErr, isOk, ok, SilentLoggerAdapter } from "@kernel";
import { AgentDispatchError, AgentResultBuilder } from "@kernel/agents";
import { describe, expect, it } from "vitest";
import { FindingBuilder } from "../domain/finding.builder";
import { PiFixerAdapter } from "./pi-fixer.adapter";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SLICE_ID = "550e8400-e29b-41d4-a716-446655440000";
const WORKING_DIR = "/tmp/worktree";
const TASK_ID = "11111111-1111-4111-8111-111111111111";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeValidFixerOutput(fixedIds: string[], deferredIds: string[]): string {
  return `\`\`\`json
${JSON.stringify({
  fixed: fixedIds,
  deferred: deferredIds,
  justifications: {},
  testsPassing: true,
})}
\`\`\``;
}

function makeAdapter(dispatch: InMemoryAgentDispatchAdapter) {
  const promptLoader = (_path: string) => "Fix the following findings:\n{{findings_json}}";
  const modelResolver = (_profile: string) => ({
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
  });
  const logger = new SilentLoggerAdapter();
  return new PiFixerAdapter(dispatch, promptLoader, modelResolver, logger, () => TASK_ID);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PiFixerAdapter", () => {
  it("returns FixResult when agent produces valid output (AC2, AC8)", async () => {
    const dispatch = new InMemoryAgentDispatchAdapter();
    const finding1 = new FindingBuilder().withId("f-001").withSeverity("critical").build();
    const finding2 = new FindingBuilder().withId("f-002").withSeverity("low").build();

    const agentOutput = makeValidFixerOutput(["f-001"], ["f-002"]);
    dispatch.givenResult(
      TASK_ID,
      ok(new AgentResultBuilder().withTaskId(TASK_ID).withOutput(agentOutput).build()),
    );

    const adapter = makeAdapter(dispatch);
    const result = await adapter.fix({
      sliceId: SLICE_ID,
      findings: [finding1, finding2],
      workingDirectory: WORKING_DIR,
    });

    expect(isOk(result)).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.fixed).toHaveLength(1);
    expect(result.data.fixed[0]?.id).toBe("f-001");
    expect(result.data.deferred).toHaveLength(1);
    expect(result.data.deferred[0]?.id).toBe("f-002");
    expect(result.data.testsPassing).toBe(true);
  });

  it("sorts findings by severity (critical first) in the task prompt (AC3)", async () => {
    const dispatch = new InMemoryAgentDispatchAdapter();
    const lowFinding = new FindingBuilder().withId("f-low").withSeverity("low").build();
    const criticalFinding = new FindingBuilder().withId("f-crit").withSeverity("critical").build();
    const highFinding = new FindingBuilder().withId("f-high").withSeverity("high").build();

    const agentOutput = makeValidFixerOutput([], ["f-low", "f-crit", "f-high"]);
    dispatch.givenResult(
      TASK_ID,
      ok(new AgentResultBuilder().withTaskId(TASK_ID).withOutput(agentOutput).build()),
    );

    const adapter = makeAdapter(dispatch);
    await adapter.fix({
      sliceId: SLICE_ID,
      findings: [lowFinding, criticalFinding, highFinding],
      workingDirectory: WORKING_DIR,
    });

    expect(dispatch.dispatchedConfigs).toHaveLength(1);
    const config = dispatch.dispatchedConfigs[0];
    if (config === undefined) throw new Error("no config dispatched");

    // The taskPrompt should contain a JSON array with findings ordered critical→high→low
    const promptJson = JSON.parse(
      config.taskPrompt.slice(
        config.taskPrompt.indexOf("["),
        config.taskPrompt.lastIndexOf("]") + 1,
      ),
    ) as Array<{ id: string }>;
    expect(promptJson[0]?.id).toBe("f-crit");
    expect(promptJson[1]?.id).toBe("f-high");
    expect(promptJson[2]?.id).toBe("f-low");
  });

  it("returns Err(FixerError) when agent dispatch fails (AC4)", async () => {
    const dispatch = new InMemoryAgentDispatchAdapter();
    dispatch.givenResult(TASK_ID, err(AgentDispatchError.sessionTimedOut(TASK_ID, 30000)));

    const adapter = makeAdapter(dispatch);
    const result = await adapter.fix({
      sliceId: SLICE_ID,
      findings: [new FindingBuilder().build()],
      workingDirectory: WORKING_DIR,
    });

    expect(isErr(result)).toBe(true);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.message).toContain("Fixer agent dispatch failed");
  });

  it("returns Err(FixerError) when agent output cannot be parsed (AC4)", async () => {
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
    const result = await adapter.fix({
      sliceId: SLICE_ID,
      findings: [new FindingBuilder().build()],
      workingDirectory: WORKING_DIR,
    });

    expect(isErr(result)).toBe(true);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.message).toContain("fixer output");
  });
});
