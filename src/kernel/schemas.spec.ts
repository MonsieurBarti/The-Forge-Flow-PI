import { describe, expect, it } from "vitest";
import { IdSchema, ModelProfileNameSchema, TimestampSchema } from "./schemas";

describe("IdSchema", () => {
  it("accepts valid UUID", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(IdSchema.parse(uuid)).toBe(uuid);
  });

  it("rejects non-UUID string", () => {
    expect(() => IdSchema.parse("not-a-uuid")).toThrow();
  });
});

describe("TimestampSchema", () => {
  it("coerces ISO string to Date", () => {
    const iso = "2024-01-15T10:30:00.000Z";
    const result = TimestampSchema.parse(iso);
    expect(result).toBeInstanceOf(Date);
    expect(result.toISOString()).toBe(iso);
  });

  it("coerces number (epoch ms) to Date", () => {
    const epoch = 1705312200000;
    const result = TimestampSchema.parse(epoch);
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBe(epoch);
  });

  it("accepts Date object", () => {
    const date = new Date("2024-01-15T10:30:00.000Z");
    const result = TimestampSchema.parse(date);
    expect(result).toBeInstanceOf(Date);
    expect(result.toISOString()).toBe(date.toISOString());
  });

  it("rejects invalid string", () => {
    expect(() => TimestampSchema.parse("not-a-date")).toThrow();
  });
});

describe("ModelProfileNameSchema", () => {
  it("accepts valid profile names", () => {
    expect(ModelProfileNameSchema.parse("quality")).toBe("quality");
    expect(ModelProfileNameSchema.parse("balanced")).toBe("balanced");
    expect(ModelProfileNameSchema.parse("budget")).toBe("budget");
  });

  it("rejects invalid profile name", () => {
    expect(() => ModelProfileNameSchema.parse("premium")).toThrow();
  });
});
