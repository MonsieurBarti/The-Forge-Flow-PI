import type { SliceStatus } from "@hexagons/slice";
import type { Result } from "@kernel";

export interface SliceStatusProvider {
  getStatus(sliceId: string): Promise<Result<SliceStatus, Error>>;
}
