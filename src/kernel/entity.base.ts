import type { ZodType } from "zod";

export abstract class Entity<TProps> {
  protected constructor(
    protected props: TProps,
    schema: ZodType<TProps>,
  ) {
    this.props = schema.parse(props);
  }

  abstract get id(): string;

  toJSON(): TProps {
    return { ...this.props };
  }
}
