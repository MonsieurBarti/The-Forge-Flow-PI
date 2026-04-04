import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ok, err } from "@kernel/result";
import { GitError, SyncError } from "@kernel/errors";
import type { StateBranchOpsPort } from "@kernel/ports/state-branch-ops.port";
import { AdvisoryLock } from "./advisory-lock";
import { GitStateSyncAdapter, type GitStateSyncAdapterDeps } from "./git-state-sync.adapter";
import type { StateExporter } from "@kernel/services/state-exporter";
import type { StateImporter } from "@kernel/services/state-importer";
import { SCHEMA_VERSION } from "./state-snapshot.schemas";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function createMockBranchOps(): StateBranchOpsPort {
  const files = new Map<string, Map<string, string>>();

  return {
    createOrphan: vi.fn().mockResolvedValue(ok(undefined)),
    forkBranch: vi.fn().mockImplementation(async (_source: string, target: string) => {
      files.set(target, new Map());
      return ok(undefined);
    }),
    deleteBranch: vi.fn().mockResolvedValue(ok(undefined)),
    branchExists: vi.fn().mockImplementation(async (name: string) => {
      return ok(files.has(name));
    }),
    renameBranch: vi.fn().mockResolvedValue(ok(undefined)),
    syncToStateBranch: vi.fn().mockImplementation(async (branch: string, newFiles: Map<string, string>) => {
      const existing = files.get(branch) ?? new Map();
      for (const [k, v] of newFiles) existing.set(k, v);
      files.set(branch, existing);
      return ok("abc1234");
    }),
    readFromStateBranch: vi.fn().mockImplementation(async (branch: string, path: string) => {
      const branchFiles = files.get(branch);
      if (!branchFiles) return ok(null);
      return ok(branchFiles.get(path) ?? null);
    }),
    readAllFromStateBranch: vi.fn().mockImplementation(async (branch: string) => {
      const branchFiles = files.get(branch);
      if (!branchFiles) return err(new GitError("REF_NOT_FOUND", `Branch ${branch} not found`));
      return ok(new Map(branchFiles));
    }),
  } as unknown as StateBranchOpsPort;
}

describe("GitStateSyncAdapter", () => {
  let adapter: GitStateSyncAdapter;
  let mockBranchOps: StateBranchOpsPort;
  let mockExporter: StateExporter;
  let mockImporter: StateImporter;
  let tffDir: string;

  beforeEach(() => {
    tffDir = join(tmpdir(), `tff-sync-test-${Date.now()}`);
    mkdirSync(tffDir, { recursive: true });

    mockBranchOps = createMockBranchOps();
    mockExporter = {
      export: vi.fn().mockResolvedValue(ok({
        version: SCHEMA_VERSION,
        exportedAt: new Date(),
        project: null,
        milestones: [],
        slices: [],
        tasks: [],
        shipRecords: [],
        completionRecords: [],
      })),
    } as unknown as StateExporter;
    mockImporter = {
      import: vi.fn().mockResolvedValue(ok(undefined)),
    } as unknown as StateImporter;

    const deps: GitStateSyncAdapterDeps = {
      stateBranchOps: mockBranchOps,
      stateExporter: mockExporter,
      stateImporter: mockImporter,
      advisoryLock: new AdvisoryLock(),
      tffDir,
      projectRoot: tffDir,
    };
    adapter = new GitStateSyncAdapter(deps);
  });

  afterEach(() => {
    try {
      rmSync(tffDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it("createStateBranch forks from parent and writes branch-meta", async () => {
    const result = await adapter.createStateBranch("milestone/M07", "tff-state/main");
    expect(result.ok).toBe(true);
    expect(mockBranchOps.forkBranch).toHaveBeenCalledWith("tff-state/main", "tff-state/milestone/M07");
    expect(mockBranchOps.syncToStateBranch).toHaveBeenCalled();

    // Verify branch-meta was written
    const call = (mockBranchOps.syncToStateBranch as ReturnType<typeof vi.fn>).mock.calls[0];
    const filesMap: Map<string, string> = call[1];
    expect(filesMap.has("branch-meta.json")).toBe(true);
    const meta = JSON.parse(filesMap.get("branch-meta.json")!);
    expect(meta.codeBranch).toBe("milestone/M07");
    expect(meta.parentStateBranch).toBe("tff-state/main");
  });

  it("createStateBranch is idempotent if branch already exists", async () => {
    await adapter.createStateBranch("milestone/M07", "tff-state/main");
    const result = await adapter.createStateBranch("milestone/M07", "tff-state/main");
    expect(result.ok).toBe(true);
    // forkBranch should only be called once
    expect(mockBranchOps.forkBranch).toHaveBeenCalledTimes(1);
  });

  it("deleteStateBranch removes the branch", async () => {
    const result = await adapter.deleteStateBranch("milestone/M07");
    expect(result.ok).toBe(true);
    expect(mockBranchOps.deleteBranch).toHaveBeenCalledWith("tff-state/milestone/M07");
  });

  it("syncToStateBranch exports state and writes files", async () => {
    // Pre-create branch
    await adapter.createStateBranch("milestone/M07", "tff-state/main");

    const result = await adapter.syncToStateBranch("milestone/M07", tffDir);
    expect(result.ok).toBe(true);
    expect(mockExporter.export).toHaveBeenCalled();
  });

  it("syncToStateBranch includes settings.yaml if present", async () => {
    writeFileSync(join(tffDir, "settings.yaml"), "model-profiles:\n  quality:\n    model: opus\n");
    await adapter.createStateBranch("milestone/M07", "tff-state/main");

    const result = await adapter.syncToStateBranch("milestone/M07", tffDir);
    expect(result.ok).toBe(true);

    // Check the last syncToStateBranch call includes settings.yaml
    const calls = (mockBranchOps.syncToStateBranch as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls[calls.length - 1];
    const filesMap: Map<string, string> = lastCall[1];
    expect(filesMap.has("settings.yaml")).toBe(true);
  });

  it("syncToStateBranch includes metrics.jsonl if present", async () => {
    writeFileSync(join(tffDir, "metrics.jsonl"), '{"event":"test"}\n');
    await adapter.createStateBranch("milestone/M07", "tff-state/main");

    await adapter.syncToStateBranch("milestone/M07", tffDir);

    const calls = (mockBranchOps.syncToStateBranch as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls[calls.length - 1];
    const filesMap: Map<string, string> = lastCall[1];
    expect(filesMap.has("metrics.jsonl")).toBe(true);
  });

  it("syncToStateBranch acquires and releases lock", async () => {
    await adapter.createStateBranch("milestone/M07", "tff-state/main");
    const result = await adapter.syncToStateBranch("milestone/M07", tffDir);
    expect(result.ok).toBe(true);
    // If lock wasn't released, a second call would fail
    const result2 = await adapter.syncToStateBranch("milestone/M07", tffDir);
    expect(result2.ok).toBe(true);
  });

  it("restoreFromStateBranch imports snapshot and writes files", async () => {
    // Set up branch with snapshot
    await adapter.createStateBranch("milestone/M07", "tff-state/main");
    await adapter.syncToStateBranch("milestone/M07", tffDir);

    const result = await adapter.restoreFromStateBranch("milestone/M07", tffDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.pulled).toBeGreaterThan(0);
      expect(result.data.conflicts).toEqual([]);
    }
  });

  it("mergeStateBranches merges child into parent", async () => {
    // Create parent with snapshot
    await adapter.createStateBranch("milestone/M07", "tff-state/main");
    await adapter.syncToStateBranch("milestone/M07", tffDir);

    // Create child
    await adapter.createStateBranch("slice/M07-S01", "tff-state/milestone/M07");
    await adapter.syncToStateBranch("slice/M07-S01", tffDir);

    const result = await adapter.mergeStateBranches("slice/M07-S01", "milestone/M07", "s1");
    expect(result.ok).toBe(true);
  });

  describe("lockToken pass-through", () => {
    it("syncToStateBranch with lockToken skips internal lock acquisition", async () => {
      await adapter.createStateBranch("milestone/M07", "tff-state/main");

      // Acquire the lock externally
      const { AdvisoryLock } = await import("./advisory-lock");
      const externalLock = new AdvisoryLock();
      const lockPath = join(tffDir, ".lock");
      const lockResult = externalLock.acquire(lockPath);
      expect(lockResult.ok).toBe(true);
      const externalRelease = lockResult.data!;

      // Adapter should succeed using caller's lock (not try to re-acquire)
      const result = await adapter.syncToStateBranch("milestone/M07", tffDir, { lockToken: externalRelease });
      expect(result.ok).toBe(true);

      // Release the external lock — adapter must NOT have released it already
      externalRelease();

      // Now a fresh call without lockToken should work (lock is free)
      const result2 = await adapter.syncToStateBranch("milestone/M07", tffDir);
      expect(result2.ok).toBe(true);
    });

    it("restoreFromStateBranch with lockToken skips internal lock acquisition", async () => {
      await adapter.createStateBranch("milestone/M07", "tff-state/main");
      await adapter.syncToStateBranch("milestone/M07", tffDir);

      // Acquire the lock externally
      const { AdvisoryLock } = await import("./advisory-lock");
      const externalLock = new AdvisoryLock();
      const lockPath = join(tffDir, ".lock");
      const lockResult = externalLock.acquire(lockPath);
      expect(lockResult.ok).toBe(true);
      const externalRelease = lockResult.data!;

      // Adapter should succeed using caller's lock
      const result = await adapter.restoreFromStateBranch("milestone/M07", tffDir, { lockToken: externalRelease });
      expect(result.ok).toBe(true);

      // Release the external lock — adapter must NOT have released it already
      externalRelease();

      // Now a fresh call without lockToken should work (lock is free)
      const result2 = await adapter.restoreFromStateBranch("milestone/M07", tffDir);
      expect(result2.ok).toBe(true);
    });

    it("syncToStateBranch without lockToken acquires lock internally (existing behavior)", async () => {
      await adapter.createStateBranch("milestone/M07", "tff-state/main");
      const result = await adapter.syncToStateBranch("milestone/M07", tffDir);
      expect(result.ok).toBe(true);
      // Second call should also succeed (lock was released)
      const result2 = await adapter.syncToStateBranch("milestone/M07", tffDir);
      expect(result2.ok).toBe(true);
    });

    it("restoreFromStateBranch without lockToken acquires lock internally (existing behavior)", async () => {
      await adapter.createStateBranch("milestone/M07", "tff-state/main");
      await adapter.syncToStateBranch("milestone/M07", tffDir);
      const result = await adapter.restoreFromStateBranch("milestone/M07", tffDir);
      expect(result.ok).toBe(true);
      // Second call should also succeed (lock was released)
      const result2 = await adapter.restoreFromStateBranch("milestone/M07", tffDir);
      expect(result2.ok).toBe(true);
    });
  });
});
