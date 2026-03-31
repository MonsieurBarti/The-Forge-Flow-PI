import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ReviewPromptBuilder, type ReviewPromptConfig } from "./review-prompt-builder";

const realLoader = (path: string) =>
  readFileSync(join(import.meta.dirname, "../../../resources", path), "utf-8");

const baseConfig: ReviewPromptConfig = {
  sliceId: "slice-123",
  sliceLabel: "M05-S03",
  sliceTitle: "Critique-then-reflection",
  role: "code-reviewer",
  changedFiles: "- src/foo.ts\n- src/bar.ts",
  acceptanceCriteria: "- AC1: Must pass",
};

describe("ReviewPromptBuilder", () => {
  it("builds CTR prompt for code-reviewer with PASS 1 and PASS 2 (AC15)", () => {
    const builder = new ReviewPromptBuilder(realLoader);
    const prompt = builder.build(baseConfig);
    expect(prompt).toContain("PASS 1");
    expect(prompt).toContain("PASS 2");
    expect(prompt).toContain('"critique"');
  });

  it("builds CTR prompt for security-auditor (AC18)", () => {
    const builder = new ReviewPromptBuilder(realLoader);
    const prompt = builder.build({ ...baseConfig, role: "security-auditor" });
    expect(prompt).toContain("PASS 1");
    expect(prompt).toContain("security-auditor");
  });

  it("builds standard prompt for spec-reviewer without two-pass (AC16)", () => {
    const builder = new ReviewPromptBuilder(realLoader);
    const prompt = builder.build({ ...baseConfig, role: "spec-reviewer" });
    expect(prompt).not.toContain("PASS 1");
    expect(prompt).not.toContain("PASS 2");
  });

  it("interpolates all placeholders — no raw {{...}} tokens (AC17)", () => {
    const builder = new ReviewPromptBuilder(realLoader);
    const prompt = builder.build(baseConfig);
    expect(prompt).not.toMatch(/\{\{.*?\}\}/);
  });

  it("includes slice context in output", () => {
    const builder = new ReviewPromptBuilder(realLoader);
    const prompt = builder.build(baseConfig);
    expect(prompt).toContain("M05-S03");
    expect(prompt).toContain("slice-123");
    expect(prompt).toContain("src/foo.ts");
  });

  it("uses injected template loader", () => {
    let loadedPath = "";
    const spyLoader = (path: string) => {
      loadedPath = path;
      return "# Mock template\n{{sliceLabel}} {{reviewRole}}";
    };
    const builder = new ReviewPromptBuilder(spyLoader);
    builder.build(baseConfig);
    expect(loadedPath).toBe("prompts/critique-then-reflection.md");
  });
});
