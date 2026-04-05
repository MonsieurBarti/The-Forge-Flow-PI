import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { SyncError } from "@kernel/errors";
import type { StateBranchOpsPort } from "@kernel/ports/state-branch-ops.port";
import { StateSyncPort, type SyncOptions } from "@kernel/ports/state-sync.port";
import type { SyncReport } from "@kernel/ports/state-sync.schemas";
import { err, ok, type Result } from "@kernel/result";
import type { StateExporter } from "@kernel/services/state-exporter";
import type { StateImporter } from "@kernel/services/state-importer";
import type { AdvisoryLock, LockRelease } from "./advisory-lock";
import { mergeSnapshots, type Snapshot } from "./json-snapshot-merger";
import {
  type BranchMeta,
  BranchMetaSchema,
  migrateSnapshot,
  SCHEMA_VERSION,
  StateSnapshotSchema,
} from "./state-snapshot.schemas";

export interface GitStateSyncAdapterDeps {
  stateBranchOps: StateBranchOpsPort;
  stateExporter: StateExporter;
  stateImporter: StateImporter;
  advisoryLock: AdvisoryLock;
  tffDir: string;
  projectRoot: string;
}

function resolveStateBranch(codeBranch: string): string {
  return `tff-state/${codeBranch}`;
}

export class GitStateSyncAdapter extends StateSyncPort {
  constructor(private readonly deps: GitStateSyncAdapterDeps) {
    super();
  }

  async createStateBranch(
    codeBranch: string,
    parentStateBranch: string,
  ): Promise<Result<void, SyncError>> {
    const stateBranch = resolveStateBranch(codeBranch);
    const { stateBranchOps } = this.deps;

    // Check if already exists
    const existsResult = await stateBranchOps.branchExists(stateBranch);
    if (!existsResult.ok) return err(new SyncError("BRANCH_NOT_FOUND", existsResult.error.message));
    if (existsResult.data) return ok(undefined); // Already exists

    // Fork from parent
    const forkResult = await stateBranchOps.forkBranch(parentStateBranch, stateBranch);
    if (!forkResult.ok) return err(new SyncError("BRANCH_NOT_FOUND", forkResult.error.message));

    // Write initial branch-meta.json
    const meta: BranchMeta = {
      version: SCHEMA_VERSION,
      stateId: crypto.randomUUID(),
      codeBranch,
      stateBranch,
      parentStateBranch,
      lastSyncedAt: null,
      lastSyncedHash: null,
      lastJournalOffset: 0,
      dirty: false,
    };

    const syncResult = await stateBranchOps.syncToStateBranch(
      stateBranch,
      new Map([["branch-meta.json", JSON.stringify(meta, null, 2)]]),
    );
    if (!syncResult.ok) return err(new SyncError("EXPORT_FAILED", syncResult.error.message));

    return ok(undefined);
  }

  async deleteStateBranch(codeBranch: string): Promise<Result<void, SyncError>> {
    const stateBranch = resolveStateBranch(codeBranch);
    const result = await this.deps.stateBranchOps.deleteBranch(stateBranch);
    if (!result.ok) return err(new SyncError("BRANCH_NOT_FOUND", result.error.message));
    return ok(undefined);
  }

  async syncToStateBranch(
    codeBranch: string,
    tffDir: string,
    options?: SyncOptions,
  ): Promise<Result<void, SyncError>> {
    const lockPath = join(tffDir, ".lock");
    let release: LockRelease | undefined;
    if (options?.lockToken) {
      // Caller holds the lock — don't acquire or release
    } else {
      const lockResult = this.deps.advisoryLock.acquire(lockPath);
      if (!lockResult.ok) return lockResult;
      release = lockResult.data;
    }

    try {
      const stateBranch = resolveStateBranch(codeBranch);
      const { stateBranchOps, stateExporter } = this.deps;

      // Export state
      const exportResult = await stateExporter.export();
      if (!exportResult.ok) return exportResult;

      const files = new Map<string, string>();

      // state-snapshot.json
      files.set("state-snapshot.json", JSON.stringify(exportResult.data, null, 2));

      // branch-meta.json
      const existingMeta = await stateBranchOps.readFromStateBranch(
        stateBranch,
        "branch-meta.json",
      );
      let meta: BranchMeta;
      if (existingMeta.ok && existingMeta.data) {
        meta = BranchMetaSchema.parse(JSON.parse(existingMeta.data));
      } else {
        meta = {
          version: SCHEMA_VERSION,
          stateId: crypto.randomUUID(),
          codeBranch,
          stateBranch,
          parentStateBranch: null,
          lastSyncedAt: null,
          lastSyncedHash: null,
          lastJournalOffset: 0,
          dirty: false,
        };
      }
      meta.lastSyncedAt = new Date();
      meta.dirty = false;
      files.set("branch-meta.json", JSON.stringify(meta, null, 2));

      // settings.yaml
      const settingsPath = join(tffDir, "settings.yaml");
      if (existsSync(settingsPath)) {
        files.set("settings.yaml", readFileSync(settingsPath, "utf-8"));
      }

      // Collect milestone artifacts
      this.collectArtifacts(tffDir, files);

      // Journal normalization
      this.collectJournal(tffDir, files, meta);

      // Metrics
      const metricsPath = join(tffDir, "metrics.jsonl");
      if (existsSync(metricsPath)) {
        files.set("metrics.jsonl", readFileSync(metricsPath, "utf-8"));
      }

      // Sync to state branch
      const syncResult = await stateBranchOps.syncToStateBranch(stateBranch, files);
      if (!syncResult.ok) return err(new SyncError("EXPORT_FAILED", syncResult.error.message));

      return ok(undefined);
    } finally {
      release?.();
    }
  }

  async restoreFromStateBranch(
    codeBranch: string,
    tffDir: string,
    options?: SyncOptions,
  ): Promise<Result<SyncReport, SyncError>> {
    const lockPath = join(tffDir, ".lock");
    let release: LockRelease | undefined;
    if (options?.lockToken) {
      // Caller holds the lock — don't acquire or release
    } else {
      const lockResult = this.deps.advisoryLock.acquire(lockPath);
      if (!lockResult.ok) return lockResult;
      release = lockResult.data;
    }

    try {
      const stateBranch = resolveStateBranch(codeBranch);
      const { stateBranchOps, stateImporter } = this.deps;

      // Read all files from state branch
      const readResult = await stateBranchOps.readAllFromStateBranch(stateBranch);
      if (!readResult.ok) return err(new SyncError("BRANCH_NOT_FOUND", readResult.error.message));

      const fileMap = readResult.data;

      // Parse and import state snapshot
      const snapshotJson = fileMap.get("state-snapshot.json");
      if (snapshotJson) {
        const raw = JSON.parse(snapshotJson);
        const migrated = migrateSnapshot(raw);
        StateSnapshotSchema.parse(migrated); // validate
        const importResult = await stateImporter.import(migrated);
        if (!importResult.ok) return importResult;
      }

      // Write artifacts to local paths
      const resolvedTffDir = resolve(tffDir);
      for (const [filePath, content] of fileMap) {
        if (filePath === "state-snapshot.json" || filePath === "branch-meta.json") continue;

        // Path traversal guard
        const localPath = resolve(tffDir, filePath);
        if (!localPath.startsWith(resolvedTffDir + sep)) continue;

        mkdirSync(dirname(localPath), { recursive: true });
        writeFileSync(localPath, content);
      }

      // Update branch-meta
      const branchMetaJson = fileMap.get("branch-meta.json");
      if (branchMetaJson) {
        const meta = BranchMetaSchema.parse(JSON.parse(branchMetaJson));
        meta.lastSyncedAt = new Date();
        writeFileSync(join(tffDir, "branch-meta.json"), JSON.stringify(meta, null, 2));
      }

      return ok({
        pulled: fileMap.size,
        conflicts: [],
        timestamp: new Date(),
      });
    } finally {
      release?.();
    }
  }

  async mergeStateBranches(
    child: string,
    parent: string,
    sliceId: string,
  ): Promise<Result<void, SyncError>> {
    const lockRelease = this.deps.advisoryLock.acquire(join(this.deps.tffDir, ".lock"));
    if (!lockRelease.ok) return err(lockRelease.error);
    try {
      const { stateBranchOps } = this.deps;
      const childBranch = resolveStateBranch(child);
      const parentBranch = resolveStateBranch(parent);

      // Read both snapshots
      const childRead = await stateBranchOps.readAllFromStateBranch(childBranch);
      if (!childRead.ok) return err(new SyncError("BRANCH_NOT_FOUND", childRead.error.message));

      const parentRead = await stateBranchOps.readAllFromStateBranch(parentBranch);
      if (!parentRead.ok) return err(new SyncError("BRANCH_NOT_FOUND", parentRead.error.message));

      const childFiles = childRead.data;
      const parentFiles = parentRead.data;

      // Parse and validate snapshots (Fix H-02)
      const childSnapshotStr = childFiles.get("state-snapshot.json");
      const parentSnapshotStr = parentFiles.get("state-snapshot.json");

      if (!childSnapshotStr || !parentSnapshotStr) {
        return err(
          new SyncError("IMPORT_FAILED", "Missing state-snapshot.json in one or both branches"),
        );
      }

      const rawParent = JSON.parse(parentSnapshotStr);
      const migratedParent = migrateSnapshot(rawParent);
      const parentSnapshot: Snapshot = StateSnapshotSchema.parse(migratedParent);

      const rawChild = JSON.parse(childSnapshotStr);
      const migratedChild = migrateSnapshot(rawChild);
      const childSnapshot: Snapshot = StateSnapshotSchema.parse(migratedChild);

      // Merge snapshots using ownership rules
      const merged = mergeSnapshots(parentSnapshot, childSnapshot, sliceId);

      // Build full snapshot with required envelope fields (Fix B1)
      const fullSnapshot = {
        version: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        ...merged,
      };

      // Build merged file map
      const mergedFiles = new Map<string, string>(parentFiles);

      // Overwrite with merged snapshot
      mergedFiles.set("state-snapshot.json", JSON.stringify(fullSnapshot, null, 2));

      // Merge metrics (append child entries) — Fix W6: guard against empty parentMetrics
      const parentMetrics = parentFiles.get("metrics.jsonl") ?? "";
      const childMetrics = childFiles.get("metrics.jsonl") ?? "";
      if (childMetrics) {
        mergedFiles.set(
          "metrics.jsonl",
          parentMetrics +
            (parentMetrics && !parentMetrics.endsWith("\n") ? "\n" : "") +
            childMetrics,
        );
      }

      // Copy child's slice-specific artifacts into parent
      for (const [filePath, content] of childFiles) {
        if (filePath.startsWith("milestones/") && filePath !== "state-snapshot.json") {
          mergedFiles.set(filePath, content);
        }
      }

      // Write merged result to parent
      const syncResult = await stateBranchOps.syncToStateBranch(parentBranch, mergedFiles);
      if (!syncResult.ok) return err(new SyncError("EXPORT_FAILED", syncResult.error.message));

      return ok(undefined);
    } finally {
      lockRelease.data();
    }
  }

  private collectArtifacts(tffDir: string, files: Map<string, string>): void {
    const milestonesDir = join(tffDir, "milestones");
    if (!existsSync(milestonesDir)) return;

    this.walkDir(milestonesDir, (filePath) => {
      const content = readFileSync(filePath, "utf-8");
      const relPath = relative(tffDir, filePath);
      files.set(relPath, content);
    });
  }

  private collectJournal(tffDir: string, files: Map<string, string>, meta: BranchMeta): void {
    // Normalize: read local journal files → single journal.jsonl
    const milestonesDir = join(tffDir, "milestones");
    if (!existsSync(milestonesDir)) return;

    const journalLines: string[] = [];
    this.walkDir(milestonesDir, (filePath) => {
      if (filePath.endsWith(".jsonl") && !filePath.endsWith("metrics.jsonl")) {
        const content = readFileSync(filePath, "utf-8").trim();
        if (content) {
          journalLines.push(content);
        }
      }
    });

    if (journalLines.length > 0) {
      files.set("journal.jsonl", `${journalLines.join("\n")}\n`);
      meta.lastJournalOffset = journalLines.join("\n").split("\n").length;
    }
  }

  private walkDir(dir: string, callback: (path: string) => void): void {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        this.walkDir(fullPath, callback);
      } else {
        callback(fullPath);
      }
    }
  }
}
