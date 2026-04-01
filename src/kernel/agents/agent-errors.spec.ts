import { BaseDomainError } from "@kernel";
import { describe, expect, it } from "vitest";
import { AgentLoadError, AgentRegistryError, AgentValidationError } from "./agent-errors";

describe("AgentValidationError", () => {
  it("extends BaseDomainError", () => {
    const err = AgentValidationError.identityTooLong(35);
    expect(err).toBeInstanceOf(BaseDomainError);
    expect(err.code).toBe("AGENT.IDENTITY_TOO_LONG");
    expect(err.metadata).toEqual({ lineCount: 35, maxLines: 30 });
  });

  it("creates methodologyDetected error", () => {
    const err = AgentValidationError.methodologyDetected(["you must", "step 1"]);
    expect(err.code).toBe("AGENT.METHODOLOGY_DETECTED");
    expect(err.metadata?.matches).toEqual(["you must", "step 1"]);
  });

  it("creates missingFreshReviewerRule error", () => {
    const err = AgentValidationError.missingFreshReviewerRule("code-reviewer");
    expect(err.code).toBe("AGENT.MISSING_FRESH_REVIEWER_RULE");
  });

  it("creates invalidFreshReviewerRule error", () => {
    const err = AgentValidationError.invalidFreshReviewerRule("fixer");
    expect(err.code).toBe("AGENT.INVALID_FRESH_REVIEWER_RULE");
  });

  it("creates noSkillsDeclared error", () => {
    const err = AgentValidationError.noSkillsDeclared("executor");
    expect(err.code).toBe("AGENT.NO_SKILLS_DECLARED");
  });
});

describe("AgentLoadError", () => {
  it("creates parseError", () => {
    const err = AgentLoadError.parseError("/path/to/file.md", "bad yaml");
    expect(err).toBeInstanceOf(BaseDomainError);
    expect(err.code).toBe("AGENT.PARSE_ERROR");
    expect(err.metadata?.filePath).toBe("/path/to/file.md");
  });

  it("creates promptNotFound", () => {
    const err = AgentLoadError.promptNotFound("/agents/x.md", "prompts/missing.md");
    expect(err.code).toBe("AGENT.PROMPT_NOT_FOUND");
  });

  it("creates duplicateType", () => {
    const err = AgentLoadError.duplicateType("fixer", ["a.md", "b.md"]);
    expect(err.code).toBe("AGENT.DUPLICATE_TYPE");
  });

  it("creates noAgentFiles", () => {
    const err = AgentLoadError.noAgentFiles("/empty/dir");
    expect(err.code).toBe("AGENT.NO_AGENT_FILES");
  });

  it("creates multipleErrors", () => {
    const causes = [
      AgentLoadError.parseError("a.md", "bad"),
      AgentLoadError.parseError("b.md", "worse"),
    ];
    const err = AgentLoadError.multipleErrors(causes);
    expect(err.code).toBe("AGENT.MULTIPLE_LOAD_ERRORS");
    expect(err.metadata?.errorCount).toBe(2);
  });
});

describe("AgentRegistryError", () => {
  it("creates notLoaded", () => {
    const err = AgentRegistryError.notLoaded();
    expect(err).toBeInstanceOf(BaseDomainError);
    expect(err.code).toBe("AGENT.REGISTRY_NOT_LOADED");
  });

  it("creates agentNotFound", () => {
    const err = AgentRegistryError.agentNotFound("brainstormer");
    expect(err.code).toBe("AGENT.NOT_FOUND");
  });
});
