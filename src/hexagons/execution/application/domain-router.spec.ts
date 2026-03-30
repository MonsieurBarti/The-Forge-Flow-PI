import { describe, expect, it } from "vitest";
import { DomainRouter } from "./domain-router";

describe("DomainRouter", () => {
  const router = new DomainRouter();

  it("always includes baseline skills", () => {
    const skills = router.resolve([]);
    expect(skills).toContain("executing-plans");
    expect(skills).toContain("commit-conventions");
  });

  it("maps domain/ paths to hexagonal-architecture", () => {
    const skills = router.resolve(["src/hexagons/execution/domain/foo.ts"]);
    expect(skills).toContain("hexagonal-architecture");
  });

  it("maps application/ paths to hexagonal-architecture", () => {
    const skills = router.resolve(["src/hexagons/execution/application/bar.ts"]);
    expect(skills).toContain("hexagonal-architecture");
  });

  it("maps infrastructure/ paths to hexagonal-architecture", () => {
    const skills = router.resolve(["src/hexagons/execution/infrastructure/baz.ts"]);
    expect(skills).toContain("hexagonal-architecture");
  });

  it("maps .spec.ts files to test-driven-development", () => {
    const skills = router.resolve(["src/foo.spec.ts"]);
    expect(skills).toContain("test-driven-development");
  });

  it("deduplicates skills from multiple matching paths", () => {
    const skills = router.resolve([
      "src/hexagons/execution/domain/a.ts",
      "src/hexagons/execution/application/b.ts",
    ]);
    const hexCount = skills.filter((s) => s === "hexagonal-architecture").length;
    expect(hexCount).toBe(1);
  });

  it("caps at 3 skills maximum", () => {
    const skills = router.resolve(["src/hexagons/execution/domain/a.spec.ts"]);
    expect(skills.length).toBeLessThanOrEqual(3);
  });

  it("prioritizes rigid skills (commit-conventions) over flexible", () => {
    const skills = router.resolve(["src/hexagons/execution/domain/a.spec.ts"]);
    const rigidIdx = skills.indexOf("commit-conventions");
    const flexIdx = skills.indexOf("hexagonal-architecture");
    if (rigidIdx >= 0 && flexIdx >= 0) {
      expect(rigidIdx).toBeLessThan(flexIdx);
    }
  });
});
