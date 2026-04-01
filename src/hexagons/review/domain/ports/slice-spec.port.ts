import type { Result } from "@kernel";
import { z } from "zod";
import type { SliceSpecError } from "../errors/review-context.error";

export const SliceSpecSchema = z.object({
  sliceId: z.string().min(1),
  sliceLabel: z.string().min(1),
  sliceTitle: z.string().min(1),
  specContent: z.string().min(1),
  acceptanceCriteria: z.string().min(1),
});
export type SliceSpec = z.infer<typeof SliceSpecSchema>;

export abstract class SliceSpecPort {
  abstract getSpec(sliceId: string): Promise<Result<SliceSpec, SliceSpecError>>;
}
