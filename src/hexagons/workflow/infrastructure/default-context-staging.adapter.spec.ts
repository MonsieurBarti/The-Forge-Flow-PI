import { faker } from "@faker-js/faker";
import type { ComplexityTier, ModelProfileName } from "@kernel";
import { describe, expect, it } from "vitest";
import type { ContextStagingRequest } from "../domain/ports/context-staging.port";
import { ModelProfileResolverPort } from "../domain/ports/model-profile-resolver.port";
import { ACTIVE_PHASES } from "../domain/transition-table";
import type { WorkflowPhase } from "../domain/workflow-session.schemas";
import { DefaultContextStagingAdapter } from "./default-context-staging.adapter";

class StubModelProfileResolver extends ModelProfileResolverPort {
  readonly lastCall: { phase?: WorkflowPhase; complexity?: ComplexityTier } = {};

  async resolveForPhase(
    phase: WorkflowPhase,
    complexity: ComplexityTier,
  ): Promise<ModelProfileName> {
    this.lastCall.phase = phase;
    this.lastCall.complexity = complexity;
    return "balanced";
  }
}

function validRequest(overrides?: Partial<ContextStagingRequest>): ContextStagingRequest {
  return {
    phase: "executing",
    sliceId: faker.string.uuid(),
    complexity: "F-lite",
    filePaths: ["src/foo.ts"],
    taskDescription: "Implement the feature",
    acceptanceCriteria: ["It works"],
    ...overrides,
  };
}

describe("DefaultContextStagingAdapter", () => {
  function createSut() {
    const resolver = new StubModelProfileResolver();
    const adapter = new DefaultContextStagingAdapter({
      modelProfileResolver: resolver,
    });
    return { adapter, resolver };
  }

  describe("stage — active phases", () => {
    it("returns a valid ContextPackage for executing", async () => {
      const { adapter } = createSut();
      const result = await adapter.stage(validRequest({ phase: "executing" }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.phase).toBe("executing");
        expect(result.data.agentType).toBe("fixer");
        expect(result.data.modelProfile).toBe("balanced");
        expect(result.data.skills.length).toBeGreaterThan(0);
      }
    });

    it("produces valid ContextPackage for every active phase", async () => {
      const { adapter } = createSut();
      for (const phase of ACTIVE_PHASES) {
        const result = await adapter.stage(validRequest({ phase }));
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.phase).toBe(phase);
        }
      }
    });

    it("passes phase and complexity to ModelProfileResolverPort", async () => {
      const { adapter, resolver } = createSut();
      await adapter.stage(validRequest({ phase: "planning", complexity: "F-full" }));
      expect(resolver.lastCall.phase).toBe("planning");
      expect(resolver.lastCall.complexity).toBe("F-full");
    });

    it("includes taskId when provided", async () => {
      const { adapter } = createSut();
      const taskId = faker.string.uuid();
      const result = await adapter.stage(validRequest({ taskId }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.taskId).toBe(taskId);
      }
    });

    it("builds task prompt from description and criteria", async () => {
      const { adapter } = createSut();
      const result = await adapter.stage(
        validRequest({
          taskDescription: "Do X",
          acceptanceCriteria: ["AC1", "AC2"],
        }),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.taskPrompt).toContain("Do X");
        expect(result.data.taskPrompt).toContain("1. AC1");
        expect(result.data.taskPrompt).toContain("2. AC2");
      }
    });

    it("returns correct agent type for reviewing phase", async () => {
      const { adapter } = createSut();
      const result = await adapter.stage(validRequest({ phase: "reviewing" }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.agentType).toBe("code-reviewer");
      }
    });
  });

  describe("stage — non-active phases", () => {
    const nonActivePhases: WorkflowPhase[] = ["idle", "paused", "blocked", "completing-milestone"];

    for (const phase of nonActivePhases) {
      it(`returns InvalidPhaseForStagingError for ${phase}`, async () => {
        const { adapter } = createSut();
        const result = await adapter.stage(validRequest({ phase }));
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe("CONTEXT_STAGING.INVALID_PHASE");
        }
      });
    }
  });
});
