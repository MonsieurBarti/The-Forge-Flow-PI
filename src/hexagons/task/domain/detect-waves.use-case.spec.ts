import { isErr, isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { DetectWavesUseCase } from "./detect-waves.use-case";
import { CyclicDependencyError } from "./errors/cyclic-dependency.error";
import type { TaskDependencyInput } from "./wave.schemas";

function makeInput(id: string, blockedBy: string[] = []): TaskDependencyInput {
  return { id, blockedBy };
}

describe("DetectWavesUseCase", () => {
  const useCase = new DetectWavesUseCase();

  describe("AC1: empty input", () => {
    it("returns ok([])", () => {
      const result = useCase.detectWaves([]);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toEqual([]);
      }
    });
  });

  describe("AC2: all independent tasks", () => {
    it("lands all in wave 0 with sorted taskIds", () => {
      const result = useCase.detectWaves([makeInput("ccc"), makeInput("aaa"), makeInput("bbb")]);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].index).toBe(0);
        expect(result.data[0].taskIds).toEqual(["aaa", "bbb", "ccc"]);
      }
    });
  });

  describe("AC3: sequential dependencies", () => {
    it("produces contiguous ordered waves (A->B->C = 3 waves)", () => {
      const result = useCase.detectWaves([
        makeInput("C", ["B"]),
        makeInput("B", ["A"]),
        makeInput("A"),
      ]);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toEqual([
          { index: 0, taskIds: ["A"] },
          { index: 1, taskIds: ["B"] },
          { index: 2, taskIds: ["C"] },
        ]);
      }
    });
  });

  describe("AC4: diamond dependencies", () => {
    it("parallel tasks share a wave", () => {
      const result = useCase.detectWaves([
        makeInput("D", ["B", "C"]),
        makeInput("B", ["A"]),
        makeInput("C", ["A"]),
        makeInput("A"),
      ]);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toEqual([
          { index: 0, taskIds: ["A"] },
          { index: 1, taskIds: ["B", "C"] },
          { index: 2, taskIds: ["D"] },
        ]);
      }
    });
  });

  describe("AC5: cyclic dependency", () => {
    it("returns err with CyclicDependencyError containing cycle path", () => {
      const result = useCase.detectWaves([
        makeInput("A", ["C"]),
        makeInput("B", ["A"]),
        makeInput("C", ["B"]),
      ]);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toBeInstanceOf(CyclicDependencyError);
        expect(result.error.cyclePath.length).toBeGreaterThanOrEqual(2);
      }
    });

    it("detects self-referential cycle", () => {
      const result = useCase.detectWaves([makeInput("A", ["A"])]);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toBeInstanceOf(CyclicDependencyError);
      }
    });
  });

  describe("AC6: determinism", () => {
    it("same input in different order produces identical output", () => {
      const input1: TaskDependencyInput[] = [
        makeInput("C", ["A"]),
        makeInput("B", ["A"]),
        makeInput("A"),
      ];
      const input2: TaskDependencyInput[] = [
        makeInput("A"),
        makeInput("B", ["A"]),
        makeInput("C", ["A"]),
      ];

      const result1 = useCase.detectWaves(input1);
      const result2 = useCase.detectWaves(input2);

      expect(isOk(result1)).toBe(true);
      expect(isOk(result2)).toBe(true);
      if (isOk(result1) && isOk(result2)) {
        expect(result1.data).toEqual(result2.data);
      }
    });
  });

  describe("AC7: unknown IDs in blockedBy", () => {
    it("ignores unknown dependency IDs", () => {
      const result = useCase.detectWaves([makeInput("A", ["nonexistent"]), makeInput("B")]);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toEqual([{ index: 0, taskIds: ["A", "B"] }]);
      }
    });
  });
});
