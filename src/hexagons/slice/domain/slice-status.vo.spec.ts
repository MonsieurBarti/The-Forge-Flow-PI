import { isErr, isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import type { SliceStatus } from "./slice.schemas";
import { SliceStatusVO } from "./slice-status.vo";

describe("SliceStatusVO", () => {
  describe("valid transitions", () => {
    const validTransitions: [SliceStatus, SliceStatus][] = [
      ["discussing", "researching"],
      ["researching", "planning"],
      ["planning", "planning"],
      ["planning", "executing"],
      ["executing", "verifying"],
      ["executing", "planning"],
      ["verifying", "executing"],
      ["verifying", "reviewing"],
      ["reviewing", "executing"],
      ["reviewing", "completing"],
      ["completing", "closed"],
    ];

    for (const [from, to] of validTransitions) {
      it(`allows ${from} -> ${to}`, () => {
        const vo = SliceStatusVO.create(from);
        const result = vo.transitionTo(to);

        expect(isOk(result)).toBe(true);
        if (isOk(result)) {
          expect(result.data.value).toBe(to);
        }
      });
    }
  });

  describe("invalid transitions", () => {
    const invalidTransitions: [SliceStatus, SliceStatus][] = [
      ["discussing", "closed"],
      ["discussing", "planning"],
      ["researching", "executing"],
      ["closed", "discussing"],
      ["closed", "closed"],
      ["completing", "reviewing"],
      ["verifying", "planning"],
    ];

    for (const [from, to] of invalidTransitions) {
      it(`rejects ${from} -> ${to}`, () => {
        const vo = SliceStatusVO.create(from);
        const result = vo.transitionTo(to);

        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe("DOMAIN.INVALID_TRANSITION");
        }
      });
    }
  });

  describe("canTransitionTo", () => {
    it("returns true for valid transition", () => {
      const vo = SliceStatusVO.create("discussing");
      expect(vo.canTransitionTo("researching")).toBe(true);
    });

    it("returns false for invalid transition", () => {
      const vo = SliceStatusVO.create("discussing");
      expect(vo.canTransitionTo("closed")).toBe(false);
    });
  });

  describe("immutability", () => {
    it("transitionTo returns a new instance", () => {
      const vo = SliceStatusVO.create("discussing");
      const result = vo.transitionTo("researching");

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).not.toBe(vo);
        expect(vo.value).toBe("discussing");
      }
    });
  });

  describe("equality", () => {
    it("two VOs with same status are equal", () => {
      const a = SliceStatusVO.create("planning");
      const b = SliceStatusVO.create("planning");
      expect(a.equals(b)).toBe(true);
    });

    it("two VOs with different status are not equal", () => {
      const a = SliceStatusVO.create("planning");
      const b = SliceStatusVO.create("executing");
      expect(a.equals(b)).toBe(false);
    });
  });
});
