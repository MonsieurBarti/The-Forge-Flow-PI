import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PROMPT_PATH = join(import.meta.dirname, "fixer.md");

describe("fixer prompt template", () => {
  const content = readFileSync(PROMPT_PATH, "utf-8");

  it("contains findings_json placeholder", () => {
    expect(content).toContain("{{findings_json}}");
  });

  it("contains severity-priority instruction with critical and high", () => {
    expect(content.toLowerCase()).toContain("critical");
    expect(content.toLowerCase()).toContain("high");
  });

  it("contains test-run instruction with vitest", () => {
    expect(content.toLowerCase()).toContain("vitest");
  });

  it("contains structured-output instruction with JSON", () => {
    expect(content).toContain("JSON");
  });
});
