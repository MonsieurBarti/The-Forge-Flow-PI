import { TimestampSchema } from "@kernel/schemas";
import { z } from "zod";

export const PullRequestConfigSchema = z.object({
  title: z.string(),
  body: z.string(),
  head: z.string(),
  base: z.string(),
  draft: z.boolean().optional(),
});
export type PullRequestConfig = z.infer<typeof PullRequestConfigSchema>;

export const PullRequestInfoSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  state: z.enum(["open", "closed", "merged"]),
  head: z.string(),
  base: z.string(),
  createdAt: TimestampSchema,
});
export type PullRequestInfo = z.infer<typeof PullRequestInfoSchema>;

export const PrFilterSchema = z
  .object({
    state: z.enum(["open", "closed", "all"]).optional(),
    head: z.string().optional(),
    base: z.string().optional(),
  })
  .optional();
export type PrFilter = z.infer<typeof PrFilterSchema>;
