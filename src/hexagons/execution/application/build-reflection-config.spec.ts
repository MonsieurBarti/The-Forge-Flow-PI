import { AgentDispatchConfigBuilder } from "@kernel/agents";
import { describe, expect, it } from "vitest";
import {
  type BuildReflectionConfigParams,
  buildReflectionConfig,
  REFLECTION_TOOLS,
} from "./build-reflection-config";

const ACCEPTANCE_CRITERIA = "- All tests pass\n- No regressions";
const GIT_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index abc..def 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,5 @@
+export function bar() {}`;

function makeParams(overrides?: Partial<BuildReflectionConfigParams>): BuildReflectionConfigParams {
  const originalConfig = new AgentDispatchConfigBuilder()
    .withTaskId("10000001-0000-4000-a000-000000000001")
    .withSliceId("a1b2c3d4-e5f6-7890-abcd-ef1234567890")
    .withAgentType("tff-executor")
    .withWorkingDirectory("/tmp/workspace")
    .withSystemPrompt("You are an executor agent.")
    .withTaskPrompt("Implement feature X.")
    .withModel({ provider: "anthropic", modelId: "claude-sonnet-4-6" })
    .withTools(["Read", "Write", "Edit", "Bash", "Glob", "Grep"])
    .withFilePaths(["src/foo.ts", "src/bar.ts"])
    .build();

  return {
    originalConfig,
    acceptanceCriteria: ACCEPTANCE_CRITERIA,
    gitDiff: GIT_DIFF,
    ...overrides,
  };
}

describe("buildReflectionConfig", () => {
  it("sets taskId to {originalId}-reflection", () => {
    const result = buildReflectionConfig(makeParams());
    expect(result.taskId).toBe("10000001-0000-4000-a000-000000000001-reflection");
  });

  it("uses read-only tools", () => {
    const result = buildReflectionConfig(makeParams());
    expect(result.tools).toEqual(["Read", "Glob", "Grep", "Bash"]);
    expect(result.tools).not.toContain("Write");
    expect(result.tools).not.toContain("Edit");
  });

  it("preserves model from original config", () => {
    const result = buildReflectionConfig(makeParams());
    expect(result.model).toEqual({
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
    });
  });

  it("preserves agentType from original config", () => {
    const result = buildReflectionConfig(makeParams());
    expect(result.agentType).toBe("tff-executor");
  });

  it("preserves sliceId from original config", () => {
    const result = buildReflectionConfig(makeParams());
    expect(result.sliceId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
  });

  it("includes acceptance criteria in taskPrompt", () => {
    const result = buildReflectionConfig(makeParams());
    expect(result.taskPrompt).toContain(ACCEPTANCE_CRITERIA);
  });

  it("includes git diff in taskPrompt", () => {
    const result = buildReflectionConfig(makeParams());
    expect(result.taskPrompt).toContain(GIT_DIFF);
  });

  it("includes TFF_REFLECTION_REPORT marker in systemPrompt", () => {
    const result = buildReflectionConfig(makeParams());
    expect(result.systemPrompt).toContain("TFF_REFLECTION_REPORT");
  });

  it("preserves workingDirectory from original config", () => {
    const result = buildReflectionConfig(makeParams());
    expect(result.workingDirectory).toBe("/tmp/workspace");
  });

  it("includes original task prompt in taskPrompt", () => {
    const result = buildReflectionConfig(makeParams());
    expect(result.taskPrompt).toContain("Implement feature X.");
  });

  it("preserves filePaths from original config", () => {
    const result = buildReflectionConfig(makeParams());
    expect(result.filePaths).toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  it("does not mutate original config filePaths", () => {
    const params = makeParams();
    const result = buildReflectionConfig(params);
    result.filePaths.push("src/baz.ts");
    expect(params.originalConfig.filePaths).toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  it("exports REFLECTION_TOOLS as a readonly tuple", () => {
    expect(REFLECTION_TOOLS).toEqual(["Read", "Glob", "Grep", "Bash"]);
  });
});
