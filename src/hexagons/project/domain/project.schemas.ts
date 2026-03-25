import { IdSchema, TimestampSchema } from "@kernel";
import { z } from "zod";

export const ProjectPropsSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  vision: z.string(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type ProjectProps = z.infer<typeof ProjectPropsSchema>;
export type ProjectDTO = ProjectProps;
