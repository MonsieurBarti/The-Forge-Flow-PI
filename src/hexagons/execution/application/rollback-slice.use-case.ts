import { err, ok, type Result } from "@kernel";
import type { GitPort } from "@kernel/ports/git.port";
import { RollbackError } from "../domain/errors/rollback.error";
import type { JournalRepositoryPort } from "../domain/ports/journal-repository.port";
import type { PhaseTransitionPort } from "../domain/ports/phase-transition.port";

export interface RollbackInput {
  sliceId: string;
  baseCommit: string;
}

export interface RollbackResult {
  revertedCommits: string[];
  failedReverts: string[];
  journalEntriesProcessed: number;
}

export class RollbackSliceUseCase {
  constructor(
    private readonly journalRepo: JournalRepositoryPort,
    private readonly gitPort: GitPort,
    private readonly phaseTransition: PhaseTransitionPort,
  ) {}

  async execute(input: RollbackInput): Promise<Result<RollbackResult, RollbackError>> {
    // 1. Read journal
    const readResult = await this.journalRepo.readAll(input.sliceId);
    if (!readResult.ok) {
      return err(new RollbackError(readResult.error.message));
    }

    const entries = readResult.data;

    // 2. Collect commitHashes from task-completed entries
    const commitHashes: string[] = [];
    for (const entry of entries) {
      if (entry.type === "task-completed" && entry.commitHash) {
        commitHashes.push(entry.commitHash);
      }
    }

    // 3. Filter: only commits after baseCommit
    const filteredHashes: string[] = [];
    for (const hash of commitHashes) {
      if (input.baseCommit) {
        const ancestorResult = await this.gitPort.isAncestor(input.baseCommit, hash);
        if (ancestorResult.ok && ancestorResult.data) {
          filteredHashes.push(hash);
        }
      } else {
        filteredHashes.push(hash);
      }
    }

    // 4. Revert in reverse chronological order
    const reversed = [...filteredHashes].reverse();
    const revertedCommits: string[] = [];
    const failedReverts: string[] = [];

    for (const hash of reversed) {
      const revertResult = await this.gitPort.revert(hash);
      if (!revertResult.ok) {
        failedReverts.push(hash);
        return err(
          new RollbackError(`Revert failed at commit ${hash}: ${revertResult.error.message}`, {
            revertedCommits,
            failedCommit: hash,
          }),
        );
      }
      revertedCommits.push(hash);
    }

    // 5. Transition executing -> planning
    await this.phaseTransition.transition(input.sliceId, "executing", "planning");

    // 6. Return result
    return ok({
      revertedCommits,
      failedReverts,
      journalEntriesProcessed: entries.length,
    });
  }
}
