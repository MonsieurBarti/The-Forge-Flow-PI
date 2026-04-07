import { describe, expect, it } from "vitest";
import { AgentValidationError } from "../errors/agent-errors";
import type { AgentCard } from "../schemas/agent-card.schema";
import { AgentValidationService } from "./agent-validation.service";

function makeCard(overrides: Partial<AgentCard> = {}): AgentCard {
  return {
    type: "tff-code-reviewer",
    displayName: "Code Reviewer",
    description: "Reviews code",
    identity: "You are a code reviewer.",
    purpose: "Review code",
    scope: "slice",
    freshReviewerRule: "must-not-be-executor",
    capabilities: ["review"],
    defaultModelProfile: "quality",
    skills: [{ name: "ctr", prompt: "prompts/ctr.md", strategy: "critique-then-reflection" }],
    requiredTools: ["Read"],
    optionalTools: [],
    ...overrides,
  };
}

describe("AgentValidationService", () => {
  const service = new AgentValidationService();

  it("returns Ok for valid card", () => {
    const result = service.validate(makeCard());
    expect(result.ok).toBe(true);
  });

  it("returns Err for identity > 30 lines", () => {
    const longIdentity = Array.from({ length: 31 }, (_, i) => `Line ${i + 1}`).join("\n");
    const result = service.validate(makeCard({ identity: longIdentity }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(AgentValidationError);
      expect(result.error.code).toBe("AGENT.IDENTITY_TOO_LONG");
    }
  });

  it("accepts identity with exactly 30 lines", () => {
    const identity = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`).join("\n");
    const result = service.validate(makeCard({ identity }));
    expect(result.ok).toBe(true);
  });

  describe("blocklist", () => {
    it.each([
      ["you must follow", "\\byou must\\b"],
      ["you should always", "\\byou should\\b"],
      ["step 1: do thing", "\\bstep \\d"],
      ["import { foo } from 'bar'", "^import "],
      ["const x = 5", "\\bconst\\s+\\w+\\s*="],
      ["function doThing() {", "\\bfunction\\s+\\w+"],
      ["class MyClass {", "\\bclass\\s+[A-Z]"],
    ])("rejects identity containing '%s'", (identity) => {
      const result = service.validate(makeCard({ identity }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("AGENT.METHODOLOGY_DETECTED");
    });

    it("allows natural language with 'class' in non-code context", () => {
      const result = service.validate(makeCard({ identity: "I value world-class engineering." }));
      expect(result.ok).toBe(true);
    });

    it("allows 'always' and 'never' in identity voice", () => {
      const result = service.validate(
        makeCard({ identity: "I always consider the broader context. I never cut corners." }),
      );
      expect(result.ok).toBe(true);
    });
  });

  describe("freshReviewerRule", () => {
    it("rejects review agent with rule 'none'", () => {
      const result = service.validate(
        makeCard({ capabilities: ["review"], freshReviewerRule: "none" }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("AGENT.MISSING_FRESH_REVIEWER_RULE");
    });

    it("rejects non-review agent with rule 'must-not-be-executor'", () => {
      const result = service.validate(
        makeCard({
          type: "tff-fixer",
          capabilities: ["fix"],
          freshReviewerRule: "must-not-be-executor",
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("AGENT.INVALID_FRESH_REVIEWER_RULE");
    });

    it("accepts non-review agent with rule 'none'", () => {
      const result = service.validate(
        makeCard({ type: "tff-fixer", capabilities: ["fix"], freshReviewerRule: "none" }),
      );
      expect(result.ok).toBe(true);
    });
  });

  it("rejects card with empty skills", () => {
    const result = service.validate(makeCard({ skills: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AGENT.NO_SKILLS_DECLARED");
  });
});
