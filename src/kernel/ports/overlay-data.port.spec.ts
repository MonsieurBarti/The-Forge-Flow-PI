import type { Id, Result } from "@kernel";
import { describe, expect, it } from "vitest";

// These imports should exist after T02 implementation
import {
  OverlayDataPort,
  type OverlayProjectSnapshot,
  type OverlaySliceSnapshot,
} from "./overlay-data.port";

describe("OverlayDataPort", () => {
  // Concrete test double for the abstract class
  class TestOverlayDataPort extends OverlayDataPort {
    async getProjectSnapshot(): Promise<Result<OverlayProjectSnapshot, Error>> {
      return {
        ok: true,
        data: {
          project: null,
          milestone: null,
          slices: [],
          taskCounts: new Map(),
        },
      };
    }

    async getSliceSnapshot(_sliceId: Id): Promise<Result<OverlaySliceSnapshot, Error>> {
      return {
        ok: true,
        data: {
          slice: null as never,
          tasks: [],
        },
      };
    }
  }

  it("can be instantiated via concrete subclass", () => {
    const port = new TestOverlayDataPort();
    expect(port).toBeInstanceOf(OverlayDataPort);
  });

  it("getProjectSnapshot returns Result with OverlayProjectSnapshot", async () => {
    const port = new TestOverlayDataPort();
    const result = await port.getProjectSnapshot();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveProperty("project");
      expect(result.data).toHaveProperty("milestone");
      expect(result.data).toHaveProperty("slices");
      expect(result.data).toHaveProperty("taskCounts");
      expect(result.data.taskCounts).toBeInstanceOf(Map);
    }
  });

  it("getSliceSnapshot returns Result with OverlaySliceSnapshot", async () => {
    const port = new TestOverlayDataPort();
    const result = await port.getSliceSnapshot("00000000-0000-0000-0000-000000000001");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveProperty("slice");
      expect(result.data).toHaveProperty("tasks");
      expect(Array.isArray(result.data.tasks)).toBe(true);
    }
  });
});
