import { isErr, isOk, ok } from "@kernel";
import type { GitError } from "@kernel/errors";
import { InMemoryWorktreeAdapter } from "@kernel/infrastructure/worktree/in-memory-worktree.adapter";
import { GitPort } from "@kernel/ports/git.port";
import type { GitLogEntry, GitStatus, GitWorktreeEntry } from "@kernel/ports/git.schemas";
import { StateBranchOpsPort } from "@kernel/ports/state-branch-ops.port";
import type { Result } from "@kernel/result";
import { describe, expect, it } from "vitest";
import { Slice } from "../domain/slice.aggregate";
import { SliceBuilder } from "../domain/slice.builder";
import { InMemorySliceRepository } from "../infrastructure/in-memory-slice.repository";
import { RemoveSliceUseCase } from "./remove-slice.use-case";

const MS_ID = "a0000000-0000-1000-a000-000000000001";
const S1_ID = "c0000000-0000-1000-a000-000000000001";
const S2_ID = "c0000000-0000-1000-a000-000000000002";
const S3_ID = "c0000000-0000-1000-a000-000000000003";

class StubStateBranchOps extends StateBranchOpsPort {
  deletedBranches: string[] = [];
  private _existingBranches = new Set<string>();

  seedBranch(name: string): void {
    this._existingBranches.add(name);
  }

  async createOrphan(): Promise<Result<void, GitError>> {
    return ok(undefined);
  }
  async forkBranch(): Promise<Result<void, GitError>> {
    return ok(undefined);
  }
  async deleteBranch(name: string): Promise<Result<void, GitError>> {
    this.deletedBranches.push(name);
    this._existingBranches.delete(name);
    return ok(undefined);
  }
  async branchExists(name: string): Promise<Result<boolean, GitError>> {
    return ok(this._existingBranches.has(name));
  }
  async renameBranch(): Promise<Result<void, GitError>> {
    return ok(undefined);
  }
  async syncToStateBranch(): Promise<Result<string, GitError>> {
    return ok("abc123");
  }
  async readFromStateBranch(): Promise<Result<string | null, GitError>> {
    return ok(null);
  }
  async readAllFromStateBranch(): Promise<Result<Map<string, string>, GitError>> {
    return ok(new Map());
  }
}

class StubGitPort extends GitPort {
  deletedBranches: string[] = [];

  async listBranches(): Promise<Result<string[], GitError>> {
    return ok([]);
  }
  async createBranch(): Promise<Result<void, GitError>> {
    return ok(undefined);
  }
  async showFile(): Promise<Result<string | null, GitError>> {
    return ok(null);
  }
  async log(): Promise<Result<GitLogEntry[], GitError>> {
    return ok([]);
  }
  async status(): Promise<Result<GitStatus, GitError>> {
    return ok({ branch: "test", clean: true, entries: [] });
  }
  async commit(): Promise<Result<string, GitError>> {
    return ok("abc123");
  }
  async revert(): Promise<Result<void, GitError>> {
    return ok(undefined);
  }
  async isAncestor(): Promise<Result<boolean, GitError>> {
    return ok(true);
  }
  async worktreeAdd(): Promise<Result<void, GitError>> {
    return ok(undefined);
  }
  async worktreeRemove(): Promise<Result<void, GitError>> {
    return ok(undefined);
  }
  async worktreeList(): Promise<Result<GitWorktreeEntry[], GitError>> {
    return ok([]);
  }
  async deleteBranch(name: string): Promise<Result<void, GitError>> {
    this.deletedBranches.push(name);
    return ok(undefined);
  }
  async statusAt(): Promise<Result<GitStatus, GitError>> {
    return ok({ branch: "test", clean: true, entries: [] });
  }
  async diffNameOnly(): Promise<Result<string[], GitError>> {
    return ok([]);
  }
  async diff(): Promise<Result<string, GitError>> {
    return ok("");
  }
  async diffAgainst(): Promise<Result<string, GitError>> {
    return ok("");
  }
  async restoreWorktree(): Promise<Result<void, GitError>> {
    return ok(undefined);
  }
  async pushFrom(): Promise<Result<void, GitError>> {
    return ok(undefined);
  }
  async currentBranch(): Promise<Result<string | null, GitError>> {
    return ok("main");
  }
  async branchExists(): Promise<Result<boolean, GitError>> {
    return ok(false);
  }
}

function setup() {
  const sliceRepo = new InMemorySliceRepository();
  const worktreePort = new InMemoryWorktreeAdapter();
  const stateBranchOps = new StubStateBranchOps();
  const gitPort = new StubGitPort();
  const useCase = new RemoveSliceUseCase(sliceRepo, worktreePort, stateBranchOps, gitPort);
  return { sliceRepo, worktreePort, stateBranchOps, gitPort, useCase };
}

describe("RemoveSliceUseCase", () => {
  it("removes a discussing slice successfully", async () => {
    const { sliceRepo, useCase } = setup();
    sliceRepo.seed(
      Slice.reconstitute(
        new SliceBuilder()
          .withId(S1_ID)
          .withMilestoneId(MS_ID)
          .withLabel("M07-S01")
          .withStatus("discussing")
          .withPosition(0)
          .buildProps(),
      ),
    );

    const result = await useCase.execute({ sliceLabel: "M07-S01" });

    expect(isOk(result)).toBe(true);
    if (!result.ok) return;
    expect(result.data.removedSliceId).toBe(S1_ID);
    expect(result.data.removedLabel).toBe("M07-S01");
    expect(result.data.cleanupActions).toContain("deleted slice record");

    // Verify deleted from repo
    const findResult = await sliceRepo.findById(S1_ID);
    expect(findResult.ok && findResult.data).toBeNull();
  });

  it("removes a researching slice successfully", async () => {
    const { sliceRepo, useCase } = setup();
    sliceRepo.seed(
      Slice.reconstitute(
        new SliceBuilder()
          .withId(S1_ID)
          .withMilestoneId(MS_ID)
          .withLabel("M07-S01")
          .withStatus("researching")
          .withPosition(0)
          .buildProps(),
      ),
    );

    const result = await useCase.execute({ sliceLabel: "M07-S01" });

    expect(isOk(result)).toBe(true);
    if (!result.ok) return;
    expect(result.data.removedSliceId).toBe(S1_ID);
  });

  it("rejects a planning slice", async () => {
    const { sliceRepo, useCase } = setup();
    sliceRepo.seed(
      Slice.reconstitute(
        new SliceBuilder()
          .withId(S1_ID)
          .withMilestoneId(MS_ID)
          .withLabel("M07-S01")
          .withStatus("planning")
          .withPosition(0)
          .buildProps(),
      ),
    );

    const result = await useCase.execute({ sliceLabel: "M07-S01" });

    expect(isErr(result)).toBe(true);
    if (result.ok) return;
    expect(result.error.message).toContain("planning");
  });

  it("rejects an executing slice", async () => {
    const { sliceRepo, useCase } = setup();
    sliceRepo.seed(
      Slice.reconstitute(
        new SliceBuilder()
          .withId(S1_ID)
          .withMilestoneId(MS_ID)
          .withLabel("M07-S01")
          .withStatus("executing")
          .withPosition(0)
          .buildProps(),
      ),
    );

    const result = await useCase.execute({ sliceLabel: "M07-S01" });

    expect(isErr(result)).toBe(true);
    if (result.ok) return;
    expect(result.error.message).toContain("executing");
  });

  it("rejects a closed slice", async () => {
    const { sliceRepo, useCase } = setup();
    sliceRepo.seed(
      Slice.reconstitute(
        new SliceBuilder()
          .withId(S1_ID)
          .withMilestoneId(MS_ID)
          .withLabel("M07-S01")
          .withStatus("closed")
          .withPosition(0)
          .buildProps(),
      ),
    );

    const result = await useCase.execute({ sliceLabel: "M07-S01" });

    expect(isErr(result)).toBe(true);
    if (result.ok) return;
    expect(result.error.message).toContain("closed");
  });

  it("returns error when slice not found", async () => {
    const { useCase } = setup();

    const result = await useCase.execute({ sliceLabel: "M07-S99" });

    expect(isErr(result)).toBe(true);
    if (result.ok) return;
    expect(result.error.message).toContain("Slice not found: M07-S99");
  });

  it("reports cleanup actions for worktree and branches", async () => {
    const { sliceRepo, worktreePort, stateBranchOps, useCase } = setup();
    sliceRepo.seed(
      Slice.reconstitute(
        new SliceBuilder()
          .withId(S1_ID)
          .withMilestoneId(MS_ID)
          .withLabel("M07-S01")
          .withStatus("discussing")
          .withPosition(0)
          .buildProps(),
      ),
    );

    // Seed worktree and state branch
    await worktreePort.create(S1_ID, "milestone/M07");
    stateBranchOps.seedBranch("tff-state/slice/M07-S01");

    const result = await useCase.execute({ sliceLabel: "M07-S01" });

    expect(isOk(result)).toBe(true);
    if (!result.ok) return;
    expect(result.data.cleanupActions).toContain("deleted worktree");
    expect(result.data.cleanupActions).toContain("deleted state branch");
    expect(result.data.cleanupActions).toContain("deleted code branch");
    expect(result.data.cleanupActions).toContain("deleted slice record");
  });

  it("recompacts downstream slice positions after removal", async () => {
    const { sliceRepo, useCase } = setup();

    sliceRepo.seed(
      Slice.reconstitute(
        new SliceBuilder()
          .withId(S1_ID)
          .withMilestoneId(MS_ID)
          .withLabel("M07-S01")
          .withStatus("discussing")
          .withPosition(0)
          .buildProps(),
      ),
    );
    sliceRepo.seed(
      Slice.reconstitute(
        new SliceBuilder()
          .withId(S2_ID)
          .withMilestoneId(MS_ID)
          .withLabel("M07-S02")
          .withStatus("executing")
          .withPosition(1)
          .buildProps(),
      ),
    );
    sliceRepo.seed(
      Slice.reconstitute(
        new SliceBuilder()
          .withId(S3_ID)
          .withMilestoneId(MS_ID)
          .withLabel("M07-S03")
          .withStatus("planning")
          .withPosition(2)
          .buildProps(),
      ),
    );

    // Remove S01 (position 0)
    const result = await useCase.execute({ sliceLabel: "M07-S01" });
    expect(isOk(result)).toBe(true);

    // S02 should now be position 0, S03 position 1
    const s2After = await sliceRepo.findById(S2_ID);
    expect(s2After.ok && s2After.data?.position).toBe(0);

    const s3After = await sliceRepo.findById(S3_ID);
    expect(s3After.ok && s3After.data?.position).toBe(1);
  });
});
