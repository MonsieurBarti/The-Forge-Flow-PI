import { z } from "zod";

export const IdSchema = z.uuid();
export type Id = z.infer<typeof IdSchema>;

export const TimestampSchema = z.coerce.date();
export type Timestamp = z.infer<typeof TimestampSchema>;
