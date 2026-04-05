import { describe, expect, it } from "vitest";
import { COMPRESSOR_PROMPT } from "./compressor-prompt";

describe("COMPRESSOR_PROMPT", () => {
  it("exports a non-empty string", () => {
    expect(typeof COMPRESSOR_PROMPT).toBe("string");
    expect(COMPRESSOR_PROMPT.length).toBeGreaterThan(0);
  });

  it("contains notation vocabulary symbols", () => {
    const requiredSymbols = ["∀", "∃", "∈", "∧", "∨", "¬", "→"];
    for (const symbol of requiredSymbols) {
      expect(COMPRESSOR_PROMPT).toContain(symbol);
    }
  });

  it("instructs to preserve code blocks verbatim", () => {
    expect(COMPRESSOR_PROMPT.toLowerCase()).toMatch(/code block|fenced|verbatim/);
  });

  it("stays within 300 token budget (≤1200 chars as proxy)", () => {
    // ~4 chars per token average for English text with symbols
    expect(COMPRESSOR_PROMPT.length).toBeLessThanOrEqual(1200);
  });
});
