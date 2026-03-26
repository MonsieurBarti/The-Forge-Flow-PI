import { z } from "zod";

export const IdSchema = z.uuid();
export type Id = z.infer<typeof IdSchema>;

export const TimestampSchema = z.coerce.date();
export type Timestamp = z.infer<typeof TimestampSchema>;

export const ComplexityTierSchema = z.enum(["S", "F-lite", "F-full"]);
export type ComplexityTier = z.infer<typeof ComplexityTierSchema>;

export const ModelProfileNameSchema = z.enum(["quality", "balanced", "budget"]);
export type ModelProfileName = z.infer<typeof ModelProfileNameSchema>;
