import type { SyncError } from "@kernel/errors";
import type { Result } from "@kernel/result";
import type { SyncReport } from "./state-sync.schemas";

export abstract class StateSyncPort {
  abstract push(): Promise<Result<void, SyncError>>;
  abstract pull(): Promise<Result<SyncReport, SyncError>>;
  abstract markDirty(): Promise<void>;
}
