import { err, isErr, isOk, ok } from "@kernel";
import { describe, expect, it } from "vitest";
import { BeadSliceSpecAdapter } from "./bead-slice-spec.adapter";

describe("BeadSliceSpecAdapter", () => {
  const resolveLabels = (_sliceId: string) => ({
    milestoneLabel: "M05",
    sliceLabel: `M05-S04`,
    sliceTitle: "Multi-stage review",
  });

  it("returns SliceSpec on successful read (AC)", async () => {
    const specContent = `# Spec\n\n## Acceptance Criteria\n- AC1: test\n- AC2: test2\n\n## Next Section\nfoo`;
    const readSpec = async () => ok(specContent);
    const adapter = new BeadSliceSpecAdapter(readSpec, resolveLabels);
    const result = await adapter.getSpec("slice-1");
    expect(isOk(result)).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.sliceLabel).toBe("M05-S04");
    expect(result.data.sliceTitle).toBe("Multi-stage review");
    expect(result.data.acceptanceCriteria).toContain("AC1");
    expect(result.data.acceptanceCriteria).not.toContain("Next Section");
  });

  it("returns error when readSpec fails", async () => {
    const readSpec = async () => err(new Error("disk error"));
    const adapter = new BeadSliceSpecAdapter(readSpec, resolveLabels);
    const result = await adapter.getSpec("slice-1");
    expect(isErr(result)).toBe(true);
  });

  it("returns error when spec is null", async () => {
    const readSpec = async () => ok(null);
    const adapter = new BeadSliceSpecAdapter(readSpec, resolveLabels);
    const result = await adapter.getSpec("slice-1");
    expect(isErr(result)).toBe(true);
  });

  it("extracts AC section until next heading", async () => {
    const specContent = `# Spec\n\n## Acceptance Criteria\n- AC1\n\n## Dependencies\n- dep1`;
    const readSpec = async () => ok(specContent);
    const adapter = new BeadSliceSpecAdapter(readSpec, resolveLabels);
    const result = await adapter.getSpec("slice-1");
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.acceptanceCriteria).toContain("AC1");
    expect(result.data.acceptanceCriteria).not.toContain("dep1");
  });

  it("handles spec without AC section", async () => {
    const specContent = `# Spec\n\nNo acceptance criteria here`;
    const readSpec = async () => ok(specContent);
    const adapter = new BeadSliceSpecAdapter(readSpec, resolveLabels);
    const result = await adapter.getSpec("slice-1");
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.acceptanceCriteria).toBe("");
  });
});
