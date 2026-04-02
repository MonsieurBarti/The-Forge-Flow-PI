import { describe, expect, it } from "vitest";
import { ShipError } from "./ship.error";

describe("ShipError", () => {
  it("prerequisiteFailed", () => {
    const e = ShipError.prerequisiteFailed("slice-1", "not in shipping state");
    expect(e.code).toBe("SHIP.PREREQUISITE_FAILED");
    expect(e.message).toContain("slice-1");
  });
  it("prCreationFailed", () => {
    const e = ShipError.prCreationFailed("slice-1", new Error("auth failed"));
    expect(e.code).toBe("SHIP.PR_CREATION_FAILED");
    expect(e.message).toContain("auth failed");
  });
  it("cleanupFailed", () => {
    const e = ShipError.cleanupFailed("slice-1", new Error("branch locked"));
    expect(e.code).toBe("SHIP.CLEANUP_FAILED");
  });
  it("mergeDeclined", () => {
    const e = ShipError.mergeDeclined("slice-1");
    expect(e.code).toBe("SHIP.MERGE_DECLINED");
  });
  it("contextResolutionFailed", () => {
    const e = ShipError.contextResolutionFailed("slice-1", new Error("no spec"));
    expect(e.code).toBe("SHIP.CONTEXT_RESOLUTION_FAILED");
  });
});
