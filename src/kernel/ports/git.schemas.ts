import { TimestampSchema } from "@kernel/schemas";
import { z } from "zod";

export const GitLogEntrySchema = z.object({
  hash: z.string(),
  message: z.string(),
  author: z.string(),
  date: TimestampSchema,
});
export type GitLogEntry = z.infer<typeof GitLogEntrySchema>;

export const GitFileStatusSchema = z.enum(["added", "modified", "deleted", "renamed", "untracked"]);
export type GitFileStatus = z.infer<typeof GitFileStatusSchema>;

export const GitStatusEntrySchema = z.object({
  path: z.string(),
  status: GitFileStatusSchema,
});
export type GitStatusEntry = z.infer<typeof GitStatusEntrySchema>;

export const GitStatusSchema = z.object({
  branch: z.string(),
  clean: z.boolean(),
  entries: z.array(GitStatusEntrySchema),
});
export type GitStatus = z.infer<typeof GitStatusSchema>;

export const GitWorktreeEntrySchema = z.object({
  path: z.string(),
  branch: z.string().optional(),
  head: z.string(),
  bare: z.boolean(),
});
export type GitWorktreeEntry = z.infer<typeof GitWorktreeEntrySchema>;
