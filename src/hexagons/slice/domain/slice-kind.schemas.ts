import { z } from "zod";

export const SliceKindSchema = z.enum(["milestone", "quick", "debug"]);
export type SliceKind = z.infer<typeof SliceKindSchema>;
