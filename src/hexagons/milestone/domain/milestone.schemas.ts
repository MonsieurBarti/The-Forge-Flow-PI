import { IdSchema, TimestampSchema } from "@kernel";
import { z } from "zod";

export const MilestoneStatusSchema = z.enum(["open", "in_progress", "closed"]);
export type MilestoneStatus = z.infer<typeof MilestoneStatusSchema>;

export const MilestoneLabelSchema = z.string().regex(/^M\d{2,}$/);
export type MilestoneLabel = z.infer<typeof MilestoneLabelSchema>;

export const MilestonePropsSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  label: MilestoneLabelSchema,
  title: z.string().min(1),
  description: z.string().default(""),
  status: MilestoneStatusSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type MilestoneProps = z.infer<typeof MilestonePropsSchema>;
export type MilestoneDTO = MilestoneProps;
