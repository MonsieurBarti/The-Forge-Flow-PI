import { isErr, isOk } from "@kernel";
import { describe, expect, it } from "vitest";
import { CheckpointBuilder } from "../domain/checkpoint.builder";
import { JournalReplayError } from "../domain/errors/journal-replay.error";
import { JournalEntryBuilder } from "../domain/journal-entry.builder";
import { JournalEntrySchema } from "../domain/journal-entry.schemas";
import { InMemoryJournalRepository } from "../infrastructure/repositories/journal/in-memory-journal.repository";
import { ReplayJournalUseCase } from "./replay-journal.use-case";

function setup() {
  const repo = new InMemoryJournalRepository();
  const useCase = new ReplayJournalUseCase(repo);
  return { repo, useCase };
}

describe("ReplayJournalUseCase", () => {
  it("AC4 — consistent journal + checkpoint returns ok with correct resumeFromWave", async () => {
    const { repo, useCase } = setup();
    const sliceId = crypto.randomUUID();
    const taskId = crypto.randomUUID();
    const builder = new JournalEntryBuilder().withSliceId(sliceId);

    const entry0 = JournalEntrySchema.parse({
      ...builder.buildTaskStarted({ taskId, waveIndex: 0 }),
      seq: 0,
    });
    const entry1 = JournalEntrySchema.parse({
      ...builder.buildTaskCompleted({ taskId, waveIndex: 0 }),
      seq: 1,
    });
    const entry2 = JournalEntrySchema.parse({
      ...builder.buildCheckpointSaved({ waveIndex: 0, completedTaskCount: 1 }),
      seq: 2,
    });
    repo.seed(sliceId, [entry0, entry1, entry2]);

    const checkpointProps = new CheckpointBuilder()
      .withSliceId(sliceId)
      .withCompletedTasks([taskId])
      .withCurrentWaveIndex(1)
      .buildProps();

    const result = await useCase.execute({
      sliceId,
      checkpoint: {
        completedTasks: checkpointProps.completedTasks,
        currentWaveIndex: checkpointProps.currentWaveIndex,
      },
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.consistent).toBe(true);
      expect(result.data.completedTaskIds).toContain(taskId);
      expect(result.data.lastProcessedSeq).toBe(2);
      // checkpoint-saved recorded wave 0, so resume = wave 1
      expect(result.data.resumeFromWave).toBe(1);
    }
  });

  it("AC5 — checkpoint claims task completed but journal has no matching entry → JournalReplayError", async () => {
    const { repo, useCase } = setup();
    const sliceId = crypto.randomUUID();
    const taskId = crypto.randomUUID();
    const missingTaskId = crypto.randomUUID();
    const builder = new JournalEntryBuilder().withSliceId(sliceId);

    // Journal has task-completed for taskId but NOT missingTaskId
    const entry0 = JournalEntrySchema.parse({
      ...builder.buildTaskStarted({ taskId, waveIndex: 0 }),
      seq: 0,
    });
    const entry1 = JournalEntrySchema.parse({
      ...builder.buildTaskCompleted({ taskId, waveIndex: 0 }),
      seq: 1,
    });
    repo.seed(sliceId, [entry0, entry1]);

    // Checkpoint claims both tasks are done
    const result = await useCase.execute({
      sliceId,
      checkpoint: {
        completedTasks: [taskId, missingTaskId],
        currentWaveIndex: 1,
      },
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(JournalReplayError);
      expect(result.error.code).toBe("JOURNAL.REPLAY_FAILURE");
    }
  });

  it("empty journal + empty checkpoint → ok with fresh-start resume point", async () => {
    const { useCase } = setup();
    const sliceId = crypto.randomUUID();

    const result = await useCase.execute({
      sliceId,
      checkpoint: {
        completedTasks: [],
        currentWaveIndex: 0,
      },
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.resumeFromWave).toBe(0);
      expect(result.data.completedTaskIds).toEqual([]);
      expect(result.data.lastProcessedSeq).toBe(-1);
      expect(result.data.consistent).toBe(true);
    }
  });

  it("empty journal + non-empty checkpoint → JournalReplayError", async () => {
    const { useCase } = setup();
    const sliceId = crypto.randomUUID();
    const taskId = crypto.randomUUID();

    const result = await useCase.execute({
      sliceId,
      checkpoint: {
        completedTasks: [taskId],
        currentWaveIndex: 1,
      },
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(JournalReplayError);
      expect(result.error.code).toBe("JOURNAL.REPLAY_FAILURE");
    }
  });
});
