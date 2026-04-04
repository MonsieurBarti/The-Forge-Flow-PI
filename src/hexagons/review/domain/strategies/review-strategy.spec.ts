import { describe, expect, it } from "vitest";
import { strategyForRole } from "./review-strategy";

describe("strategyForRole", () => {
  it("returns critique-then-reflection for code-reviewer", () => {
    expect(strategyForRole("code-reviewer")).toBe("critique-then-reflection");
  });

  it("returns critique-then-reflection for security-auditor", () => {
    expect(strategyForRole("security-auditor")).toBe("critique-then-reflection");
  });

  it("returns standard for spec-reviewer", () => {
    expect(strategyForRole("spec-reviewer")).toBe("standard");
  });
});
