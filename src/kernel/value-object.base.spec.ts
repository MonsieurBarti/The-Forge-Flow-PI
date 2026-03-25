import { describe, expect, it } from "vitest";
import { ZodError, z } from "zod";
import { ValueObject } from "./value-object.base";

const PointSchema = z.object({ x: z.number(), y: z.number() });
type PointProps = z.infer<typeof PointSchema>;

class TestVO extends ValueObject<PointProps> {
  constructor(props: PointProps) {
    super(props, PointSchema);
  }

  get x(): number {
    return this.props.x;
  }

  get y(): number {
    return this.props.y;
  }
}

const NestedSchema = z.object({
  label: z.string(),
  coord: z.object({ x: z.number(), y: z.number() }),
});
type NestedProps = z.infer<typeof NestedSchema>;

class NestedVO extends ValueObject<NestedProps> {
  constructor(props: NestedProps) {
    super(props, NestedSchema);
  }
}

describe("ValueObject", () => {
  it("constructs with valid props", () => {
    const vo = new TestVO({ x: 1, y: 2 });
    expect(vo.x).toBe(1);
    expect(vo.y).toBe(2);
  });

  it("throws ZodError on invalid props", () => {
    const badProps: PointProps = Object.assign({ x: 1, y: 2 }, { x: "bad" });
    expect(() => new TestVO(badProps)).toThrow(ZodError);
  });

  it("equals() returns true for same props", () => {
    const a = new TestVO({ x: 1, y: 2 });
    const b = new TestVO({ x: 1, y: 2 });
    expect(a.equals(b)).toBe(true);
  });

  it("equals() returns true for same props created in different key order", () => {
    const a = new TestVO({ y: 2, x: 1 });
    const b = new TestVO({ x: 1, y: 2 });
    expect(a.equals(b)).toBe(true);
  });

  it("equals() returns false for different props", () => {
    const a = new TestVO({ x: 1, y: 2 });
    const b = new TestVO({ x: 3, y: 4 });
    expect(a.equals(b)).toBe(false);
  });

  it("equals() handles nested objects deterministically", () => {
    const a = new NestedVO({ label: "p", coord: { x: 1, y: 2 } });
    const b = new NestedVO({ coord: { y: 2, x: 1 }, label: "p" });
    expect(a.equals(b)).toBe(true);

    const c = new NestedVO({ label: "p", coord: { x: 9, y: 9 } });
    expect(a.equals(c)).toBe(false);
  });
});
