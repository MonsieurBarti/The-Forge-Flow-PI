import type { SliceStatus } from "@hexagons/slice";
import { err, isOk, ok, type Result } from "@kernel";
import { beforeEach, describe, expect, it } from "vitest";
import type { SliceStatusProvider } from "../domain/ports/slice-status-provider.port";
import type { WorktreeInfo } from "@kernel/ports/worktree.schemas";
import { InMemoryWorktreeAdapter } from "@kernel/infrastructure/worktree/in-memory-worktree.adapter";
import { CleanupOrphanedWorktreesUseCase } from "./cleanup-orphaned-worktrees.use-case";

class StubSliceStatusProvider implements SliceStatusProvider {
  private statuses = new Map<string, SliceStatus>();

  givenStatus(sliceId: string, status: SliceStatus): void {
    this.statuses.set(sliceId, status);
  }

  async getStatus(sliceId: string): Promise<Result<SliceStatus, Error>> {
    const status = this.statuses.get(sliceId);
    if (!status) return err(new Error(`Slice ${sliceId} not found`));
    return ok(status);
  }
}

function makeInfo(sliceId: string): WorktreeInfo {
  return {
    sliceId,
    branch: `slice/${sliceId}`,
    path: `/mock/${sliceId}`,
    baseBranch: "milestone/M04",
  };
}

describe("CleanupOrphanedWorktreesUseCase", () => {
  let worktreeAdapter: InMemoryWorktreeAdapter;
  let statusProvider: StubSliceStatusProvider;
  let useCase: CleanupOrphanedWorktreesUseCase;

  beforeEach(() => {
    worktreeAdapter = new InMemoryWorktreeAdapter();
    statusProvider = new StubSliceStatusProvider();
    useCase = new CleanupOrphanedWorktreesUseCase(worktreeAdapter, statusProvider);
  });

  it("deletes worktrees for closed slices (AC5)", async () => {
    worktreeAdapter.seed(makeInfo("M04-S01"));
    worktreeAdapter.seed(makeInfo("M04-S02"));
    statusProvider.givenStatus("M04-S01", "closed");
    statusProvider.givenStatus("M04-S02", "executing");

    const result = await useCase.execute();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.deleted).toEqual(["M04-S01"]);
      expect(result.data.skipped).toEqual(["M04-S02"]);
    }
    expect(await worktreeAdapter.exists("M04-S01")).toBe(false);
    expect(await worktreeAdapter.exists("M04-S02")).toBe(true);
  });

  it("skips on status-lookup failure (AC5)", async () => {
    worktreeAdapter.seed(makeInfo("M04-S01"));

    const result = await useCase.execute();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.skipped).toEqual(["M04-S01"]);
      expect(result.data.deleted).toEqual([]);
    }
  });

  it("returns empty report when no worktrees exist", async () => {
    const result = await useCase.execute();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.deleted).toEqual([]);
      expect(result.data.skipped).toEqual([]);
      expect(result.data.errors).toEqual([]);
    }
  });

  it("does not delete worktrees in completing status", async () => {
    worktreeAdapter.seed(makeInfo("M04-S01"));
    statusProvider.givenStatus("M04-S01", "completing");

    const result = await useCase.execute();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.skipped).toEqual(["M04-S01"]);
      expect(result.data.deleted).toEqual([]);
    }
  });
});
