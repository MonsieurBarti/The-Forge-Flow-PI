import { isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { FindingBuilder } from "../domain/builders/finding.builder";
import { StubFixerAdapter } from "./stub-fixer.adapter";

describe("StubFixerAdapter", () => {
  it("returns all findings as deferred with testsPassing=true (AC17)", async () => {
    const adapter = new StubFixerAdapter();
    const findings = [new FindingBuilder().build(), new FindingBuilder().build()];
    const result = await adapter.fix({
      sliceId: "slice-1",
      findings,
      workingDirectory: "/tmp",
    });
    expect(isOk(result)).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.fixed).toEqual([]);
    expect(result.data.deferred).toEqual(findings);
    expect(result.data.testsPassing).toBe(true);
  });

  it("handles empty findings array", async () => {
    const adapter = new StubFixerAdapter();
    const result = await adapter.fix({
      sliceId: "slice-1",
      findings: [],
      workingDirectory: "/tmp",
    });
    expect(isOk(result)).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.deferred).toEqual([]);
  });
});
