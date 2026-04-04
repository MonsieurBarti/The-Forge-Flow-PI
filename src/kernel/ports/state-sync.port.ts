import type { SyncError } from "@kernel/errors";
import type { Result } from "@kernel/result";
import type { LockRelease } from "@kernel/infrastructure/state-branch/advisory-lock";
import type { SyncReport } from "./state-sync.schemas";

export interface SyncOptions {
  lockToken?: LockRelease;
}

export abstract class StateSyncPort {
  abstract syncToStateBranch(
    codeBranch: string,
    tffDir: string,
    options?: SyncOptions,
  ): Promise<Result<void, SyncError>>;
  abstract restoreFromStateBranch(
    codeBranch: string,
    tffDir: string,
    options?: SyncOptions,
  ): Promise<Result<SyncReport, SyncError>>;
  abstract mergeStateBranches(
    child: string,
    parent: string,
    sliceId: string,
  ): Promise<Result<void, SyncError>>;
  abstract createStateBranch(
    codeBranch: string,
    parentStateBranch: string,
  ): Promise<Result<void, SyncError>>;
  abstract deleteStateBranch(codeBranch: string): Promise<Result<void, SyncError>>;
}

export const SYNC_ERROR_CODES = {
  BRANCH_NOT_FOUND: "BRANCH_NOT_FOUND",
  LOCK_CONTENTION: "LOCK_CONTENTION",
  SCHEMA_VERSION_MISMATCH: "SCHEMA_VERSION_MISMATCH",
  EXPORT_FAILED: "EXPORT_FAILED",
  IMPORT_FAILED: "IMPORT_FAILED",
} as const;
