import { err, GitError, ok, type Result } from "@kernel";
import { GitPort } from "@kernel/ports/git.port";
import type { GitLogEntry, GitStatus, GitWorktreeEntry } from "@kernel/ports/git.schemas";
import { describe, expect, it } from "vitest";
import { JournalEntryBuilder } from "../domain/journal-entry.builder";
import { JournalEntrySchema } from "../domain/journal-entry.schemas";
import type { PhaseTransitionPort } from "../domain/ports/phase-transition.port";
import { InMemoryJournalRepository } from "../infrastructure/in-memory-journal.repository";
import { type RollbackInput, RollbackSliceUseCase } from "./rollback-slice.use-case";

// ---------------------------------------------------------------------------
// Mock GitPort
// ---------------------------------------------------------------------------
class MockGitPort extends GitPort {
  revertCalls: string[] = [];
  isAncestorResults = new Map<string, boolean>();
  revertFailAt: string | null = null;

  async revert(commitHash: string): Promise<Result<void, GitError>> {
    this.revertCalls.push(commitHash);
    if (this.revertFailAt === commitHash)
      return err(new GitError("COMMAND_FAILED", "revert conflict"));
    return ok(undefined);
  }

  async isAncestor(ancestor: string, descendant: string): Promise<Result<boolean, GitError>> {
    const key = `${ancestor}:${descendant}`;
    return ok(this.isAncestorResults.get(key) ?? true);
  }

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

  async worktreeAdd(): Promise<Result<void, GitError>> {
    return ok(undefined);
  }

  async worktreeRemove(): Promise<Result<void, GitError>> {
    return ok(undefined);
  }

  async worktreeList(): Promise<Result<GitWorktreeEntry[], GitError>> {
    return ok([]);
  }

  async deleteBranch(): Promise<Result<void, GitError>> {
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

  async restoreWorktree(): Promise<Result<void, GitError>> {
    return ok(undefined);
  }
}

// ---------------------------------------------------------------------------
// Mock PhaseTransitionPort
// ---------------------------------------------------------------------------
class MockPhaseTransition implements PhaseTransitionPort {
  calls: { sliceId: string; from: string; to: string }[] = [];

  async transition(sliceId: string, from: string, to: string): Promise<Result<void, Error>> {
    this.calls.push({ sliceId, from, to });
    return ok(undefined);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const SLICE_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const BASE_COMMIT = "base-abc";

function makeInput(overrides?: Partial<RollbackInput>): RollbackInput {
  return { sliceId: SLICE_ID, baseCommit: BASE_COMMIT, ...overrides };
}

function makeSeedEntry(builder: JournalEntryBuilder, seq: number, commitHash?: string) {
  return JournalEntrySchema.parse({
    ...builder.buildTaskCompleted({ commitHash }),
    seq,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("RollbackSliceUseCase", () => {
  it("AC6: reverts commits in reverse chronological order", async () => {
    const repo = new InMemoryJournalRepository();
    const git = new MockGitPort();
    const phase = new MockPhaseTransition();
    const useCase = new RollbackSliceUseCase(repo, git, phase);

    const builder = new JournalEntryBuilder().withSliceId(SLICE_ID);
    repo.seed(SLICE_ID, [
      makeSeedEntry(builder, 0, "a"),
      makeSeedEntry(builder, 1, "b"),
      makeSeedEntry(builder, 2, "c"),
    ]);

    const result = await useCase.execute(makeInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(git.revertCalls).toEqual(["c", "b", "a"]);
    expect(result.data.revertedCommits).toEqual(["c", "b", "a"]);
  });

  it("AC7: excludes non-task-completed entries and task-completed entries without commitHash", async () => {
    const repo = new InMemoryJournalRepository();
    const git = new MockGitPort();
    const phase = new MockPhaseTransition();
    const useCase = new RollbackSliceUseCase(repo, git, phase);

    const builder = new JournalEntryBuilder().withSliceId(SLICE_ID);

    const completedWithHash = JournalEntrySchema.parse({
      ...builder.buildTaskCompleted({ commitHash: "abc" }),
      seq: 0,
    });
    const artifactWritten = JournalEntrySchema.parse({
      ...builder.buildArtifactWritten(),
      seq: 1,
    });
    const completedNoHash = JournalEntrySchema.parse({
      ...builder.buildTaskCompleted({ commitHash: undefined }),
      seq: 2,
    });

    repo.seed(SLICE_ID, [completedWithHash, artifactWritten, completedNoHash]);

    const result = await useCase.execute(makeInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(git.revertCalls).toEqual(["abc"]);
    expect(result.data.journalEntriesProcessed).toBe(3);
  });

  it("AC12: partial failure — returns RollbackError with partial result", async () => {
    const repo = new InMemoryJournalRepository();
    const git = new MockGitPort();
    const phase = new MockPhaseTransition();
    const useCase = new RollbackSliceUseCase(repo, git, phase);

    const builder = new JournalEntryBuilder().withSliceId(SLICE_ID);
    repo.seed(SLICE_ID, [
      makeSeedEntry(builder, 0, "a"),
      makeSeedEntry(builder, 1, "b"),
      makeSeedEntry(builder, 2, "c"),
    ]);

    // Revert order will be c, b, a — fail on "b"
    git.revertFailAt = "b";

    const result = await useCase.execute(makeInput());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("JOURNAL.ROLLBACK_FAILURE");
    expect(result.error.metadata).toMatchObject({
      revertedCommits: ["c"],
      failedCommit: "b",
    });
  });

  it("transitions executing→planning on full success", async () => {
    const repo = new InMemoryJournalRepository();
    const git = new MockGitPort();
    const phase = new MockPhaseTransition();
    const useCase = new RollbackSliceUseCase(repo, git, phase);

    const builder = new JournalEntryBuilder().withSliceId(SLICE_ID);
    repo.seed(SLICE_ID, [makeSeedEntry(builder, 0, "x")]);

    const result = await useCase.execute(makeInput());

    expect(result.ok).toBe(true);
    expect(phase.calls).toEqual([{ sliceId: SLICE_ID, from: "executing", to: "planning" }]);
  });

  it("empty journal → ok with empty result and still transitions", async () => {
    const repo = new InMemoryJournalRepository();
    const git = new MockGitPort();
    const phase = new MockPhaseTransition();
    const useCase = new RollbackSliceUseCase(repo, git, phase);

    repo.seed(SLICE_ID, []);

    const result = await useCase.execute(makeInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.revertedCommits).toEqual([]);
    expect(result.data.failedReverts).toEqual([]);
    expect(result.data.journalEntriesProcessed).toBe(0);
    expect(phase.calls).toEqual([{ sliceId: SLICE_ID, from: "executing", to: "planning" }]);
  });
});
