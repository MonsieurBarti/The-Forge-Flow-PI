import { isErr, isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { TaskStatusVO } from "./task-status.vo";

describe("TaskStatusVO", () => {
  describe("valid transitions", () => {
    const validTransitions: [string, string][] = [
      ["open", "in_progress"],
      ["open", "blocked"],
      ["in_progress", "closed"],
      ["blocked", "open"],
      ["blocked", "blocked"],
    ];

    for (const [from, to] of validTransitions) {
      it(`allows ${from} -> ${to}`, () => {
        const vo = TaskStatusVO.create(from as "open");
        const result = vo.transitionTo(to as "open");

        expect(isOk(result)).toBe(true);
        if (isOk(result)) {
          expect(result.data.value).toBe(to);
        }
      });
    }
  });

  describe("invalid transitions", () => {
    const invalidTransitions: [string, string][] = [
      ["open", "closed"],
      ["open", "open"],
      ["in_progress", "open"],
      ["in_progress", "blocked"],
      ["in_progress", "in_progress"],
      ["blocked", "in_progress"],
      ["blocked", "closed"],
      ["closed", "open"],
      ["closed", "in_progress"],
      ["closed", "blocked"],
      ["closed", "closed"],
    ];

    for (const [from, to] of invalidTransitions) {
      it(`rejects ${from} -> ${to}`, () => {
        const vo = TaskStatusVO.create(from as "open");
        const result = vo.transitionTo(to as "open");

        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe("DOMAIN.INVALID_TRANSITION");
        }
      });
    }
  });

  describe("canTransitionTo", () => {
    it("returns true for valid transition", () => {
      const vo = TaskStatusVO.create("open");
      expect(vo.canTransitionTo("in_progress")).toBe(true);
    });

    it("returns false for invalid transition", () => {
      const vo = TaskStatusVO.create("open");
      expect(vo.canTransitionTo("closed")).toBe(false);
    });
  });

  describe("immutability", () => {
    it("transitionTo returns a new instance", () => {
      const vo = TaskStatusVO.create("open");
      const result = vo.transitionTo("in_progress");

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).not.toBe(vo);
        expect(vo.value).toBe("open");
      }
    });
  });

  describe("equality", () => {
    it("two VOs with same status are equal", () => {
      const a = TaskStatusVO.create("open");
      const b = TaskStatusVO.create("open");
      expect(a.equals(b)).toBe(true);
    });

    it("two VOs with different status are not equal", () => {
      const a = TaskStatusVO.create("open");
      const b = TaskStatusVO.create("blocked");
      expect(a.equals(b)).toBe(false);
    });
  });
});
