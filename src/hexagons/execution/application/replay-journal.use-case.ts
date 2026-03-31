import { err, ok, type Result } from "@kernel";
import { JournalReplayError } from "../domain/errors/journal-replay.error";
import type { JournalRepositoryPort } from "../domain/ports/journal-repository.port";

interface ReplayInput {
  sliceId: string;
  checkpoint: {
    completedTasks: readonly string[];
    currentWaveIndex: number;
  };
}

export interface ReplayResult {
  resumeFromWave: number;
  completedTaskIds: string[];
  lastProcessedSeq: number;
  consistent: boolean;
}

export class ReplayJournalUseCase {
  constructor(private readonly journalRepo: JournalRepositoryPort) {}

  async execute(input: ReplayInput): Promise<Result<ReplayResult, JournalReplayError>> {
    const readResult = await this.journalRepo.readAll(input.sliceId);
    if (!readResult.ok) {
      return err(new JournalReplayError(readResult.error.message));
    }

    const entries = readResult.data;

    // Empty journal + non-empty checkpoint → pre-journal checkpoints not supported
    if (entries.length === 0 && input.checkpoint.completedTasks.length > 0) {
      return err(
        new JournalReplayError(
          "Journal is empty but checkpoint has completed tasks — pre-journal checkpoints are not supported",
          { seq: -1, entryType: "none", reason: "empty-journal-nonempty-checkpoint" },
        ),
      );
    }

    // Walk entries in seq order, collecting completed tasks and highest checkpoint wave
    const completedTaskIds = new Set<string>();
    let highestWave = -1;
    let lastProcessedSeq = -1;

    for (const entry of entries) {
      lastProcessedSeq = entry.seq;
      if (entry.type === "task-completed") {
        completedTaskIds.add(entry.taskId);
      }
      if (entry.type === "checkpoint-saved") {
        highestWave = Math.max(highestWave, entry.waveIndex);
      }
    }

    // Cross-validate: every task the checkpoint claims as completed must have a journal entry
    for (const taskId of input.checkpoint.completedTasks) {
      if (!completedTaskIds.has(taskId)) {
        return err(
          new JournalReplayError(
            `Checkpoint claims task ${taskId} completed but no journal entry found`,
            {
              seq: lastProcessedSeq,
              entryType: "task-completed",
              reason: "missing-task-completed",
            },
          ),
        );
      }
    }

    // Determine resume wave:
    //   - If any checkpoint-saved entries existed, resume = highestWave + 1
    //   - Otherwise fall back to checkpoint.currentWaveIndex (already advanced by caller)
    //   - Fresh start (empty journal, empty checkpoint) → 0
    let resumeFromWave: number;
    if (entries.length === 0) {
      resumeFromWave = 0;
    } else if (highestWave >= 0) {
      resumeFromWave = Math.max(highestWave + 1, input.checkpoint.currentWaveIndex);
    } else {
      resumeFromWave = input.checkpoint.currentWaveIndex;
    }

    return ok({
      resumeFromWave,
      completedTaskIds: [...completedTaskIds],
      lastProcessedSeq,
      consistent: true,
    });
  }
}
