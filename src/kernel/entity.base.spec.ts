import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Entity } from "./entity.base";

const TestEntitySchema = z.object({
  id: z.uuid(),
  name: z.string(),
});

type TestEntityProps = z.infer<typeof TestEntitySchema>;

class TestEntity extends Entity<TestEntityProps> {
  constructor(props: TestEntityProps) {
    super(props, TestEntitySchema);
  }

  get id(): string {
    return this.props.id;
  }
}

describe("Entity", () => {
  const validProps: TestEntityProps = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    name: "Test",
  };

  it("constructs with valid props", () => {
    const entity = new TestEntity(validProps);
    expect(entity).toBeInstanceOf(TestEntity);
  });

  it("throws ZodError on invalid props", () => {
    expect(() => new TestEntity({ id: "not-a-uuid", name: "Test" })).toThrow();
  });

  it("id accessor returns the id from props", () => {
    const entity = new TestEntity(validProps);
    expect(entity.id).toBe(validProps.id);
  });

  it("toJSON returns a shallow copy, not the same reference", () => {
    const entity = new TestEntity(validProps);
    const first = entity.toJSON();
    const second = entity.toJSON();
    expect(first).toEqual(validProps);
    expect(first).not.toBe(second);
  });
});
