import { describe, expect, it } from "vitest";
import { PrFilterSchema, PullRequestConfigSchema, PullRequestInfoSchema } from "./github.schemas";

describe("GitHub schemas", () => {
  describe("PullRequestConfigSchema", () => {
    it("accepts valid config with title, body, head, base", () => {
      const input = {
        title: "feat: add login",
        body: "Implements login flow",
        head: "feat/login",
        base: "main",
      };
      const result = PullRequestConfigSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(input);
      }
    });

    it("accepts config with optional draft: true", () => {
      const input = {
        title: "feat: add login",
        body: "Implements login flow",
        head: "feat/login",
        base: "main",
        draft: true,
      };
      const result = PullRequestConfigSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.draft).toBe(true);
      }
    });

    it("rejects missing required fields", () => {
      const result = PullRequestConfigSchema.safeParse({ title: "only title" });
      expect(result.success).toBe(false);
    });
  });

  describe("PullRequestInfoSchema", () => {
    const validPrInfo = {
      number: 42,
      title: "feat: add login",
      url: "https://github.com/org/repo/pull/42",
      state: "open" as const,
      head: "feat/login",
      base: "main",
      createdAt: "2026-03-25T10:00:00Z",
    };

    it("accepts valid PR info", () => {
      const result = PullRequestInfoSchema.safeParse(validPrInfo);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.number).toBe(42);
        expect(result.data.state).toBe("open");
      }
    });

    it("coerces createdAt ISO string to Date", () => {
      const result = PullRequestInfoSchema.safeParse(validPrInfo);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.createdAt).toBeInstanceOf(Date);
      }
    });

    it('rejects invalid state (e.g., "pending")', () => {
      const result = PullRequestInfoSchema.safeParse({
        ...validPrInfo,
        state: "pending",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("PrFilterSchema", () => {
    it("accepts undefined", () => {
      const result = PrFilterSchema.safeParse(undefined);
      expect(result.success).toBe(true);
    });

    it('accepts partial filter (e.g., just { state: "open" })', () => {
      const result = PrFilterSchema.safeParse({ state: "open" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data?.state).toBe("open");
      }
    });

    it("accepts empty object", () => {
      const result = PrFilterSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });
});
