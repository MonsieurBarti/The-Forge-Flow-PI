import type { ZodType } from "zod";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (!isRecord(value)) {
    return JSON.stringify(value);
  }
  const sorted = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${sorted.join(",")}}`;
}

export abstract class ValueObject<TProps> {
  protected constructor(
    protected readonly props: TProps,
    schema: ZodType<TProps>,
  ) {
    this.props = schema.parse(props);
  }

  equals(other: ValueObject<TProps>): boolean {
    return stableStringify(this.props) === stableStringify(other.props);
  }
}
