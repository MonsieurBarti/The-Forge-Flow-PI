import { err, InvalidTransitionError, ok, type Result, ValueObject } from "@kernel";
import { z } from "zod";
import { type SliceStatus, SliceStatusSchema } from "./slice.schemas";

const SliceStatusVOPropsSchema = z.object({ value: SliceStatusSchema });
type SliceStatusVOProps = z.infer<typeof SliceStatusVOPropsSchema>;

export class SliceStatusVO extends ValueObject<SliceStatusVOProps> {
  private static readonly TRANSITIONS: ReadonlyMap<SliceStatus, ReadonlySet<SliceStatus>> = new Map<
    SliceStatus,
    ReadonlySet<SliceStatus>
  >([
    ["discussing", new Set(["researching"])],
    ["researching", new Set(["planning"])],
    ["planning", new Set(["planning", "executing"])],
    ["executing", new Set(["verifying", "planning"])],
    ["verifying", new Set(["executing", "reviewing"])],
    ["reviewing", new Set(["executing", "completing"])],
    ["completing", new Set(["closed"])],
  ]);

  private constructor(props: SliceStatusVOProps) {
    super(props, SliceStatusVOPropsSchema);
  }

  static create(status: SliceStatus): SliceStatusVO {
    return new SliceStatusVO({ value: status });
  }

  get value(): SliceStatus {
    return this.props.value;
  }

  canTransitionTo(target: SliceStatus): boolean {
    const allowed = SliceStatusVO.TRANSITIONS.get(this.props.value);
    return allowed?.has(target) ?? false;
  }

  transitionTo(target: SliceStatus): Result<SliceStatusVO, InvalidTransitionError> {
    if (!this.canTransitionTo(target)) {
      return err(new InvalidTransitionError(this.props.value, target, "Slice"));
    }
    return ok(SliceStatusVO.create(target));
  }
}
