import { ok, type PersistenceError, type Result } from "@kernel";
import { beforeEach, describe, expect, it } from "vitest";
import type { WorkflowJournalEntry } from "../domain/ports/workflow-journal.port";
import { WorkflowJournalPort } from "../domain/ports/workflow-journal.port";
import { InMemoryWorkflowSessionRepository } from "../infrastructure/in-memory-workflow-session.repository";
import { ReplayWorkflowJournalUseCase } from "./replay-workflow-journal.use-case";

class MockWorkflowJournal extends WorkflowJournalPort {
  constructor(private readonly entries: WorkflowJournalEntry[]) {
    super();
  }

  async append(): Promise<Result<void, PersistenceError>> {
    return ok(undefined);
  }

  async readAll(): Promise<Result<WorkflowJournalEntry[], PersistenceError>> {
    return ok(this.entries);
  }
}

const SESS_ID = "a0000000-0000-4000-a000-000000000001";
const MS_ID = "b0000000-0000-4000-a000-000000000001";
const SLICE_ID = "c0000000-0000-4000-a000-000000000001";
const ORPHAN_SESS = "a0000000-0000-4000-a000-000000000099";
const ORPHAN_MS = "b0000000-0000-4000-a000-000000000099";

describe("ReplayWorkflowJournalUseCase", () => {
  let sessionRepo: InMemoryWorkflowSessionRepository;

  beforeEach(() => {
    sessionRepo = new InMemoryWorkflowSessionRepository();
  });

  it("replays session-created + phase-transitions into a session at final phase", async () => {
    const entries: WorkflowJournalEntry[] = [
      {
        type: "session-created",
        sessionId: SESS_ID,
        milestoneId: MS_ID,
        sliceId: SLICE_ID,
        timestamp: new Date("2026-01-01T00:00:00Z"),
      },
      {
        type: "phase-transition",
        sessionId: SESS_ID,
        milestoneId: MS_ID,
        sliceId: SLICE_ID,
        fromPhase: "idle",
        toPhase: "discussing",
        trigger: "start",
        timestamp: new Date("2026-01-01T00:01:00Z"),
      },
      {
        type: "phase-transition",
        sessionId: SESS_ID,
        milestoneId: MS_ID,
        sliceId: SLICE_ID,
        fromPhase: "discussing",
        toPhase: "researching",
        trigger: "next",
        timestamp: new Date("2026-01-01T00:02:00Z"),
      },
    ];

    const journal = new MockWorkflowJournal(entries);
    const useCase = new ReplayWorkflowJournalUseCase(journal, sessionRepo);
    const result = await useCase.execute();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(1);

    const found = await sessionRepo.findById(SESS_ID);
    expect(found.ok).toBe(true);
    if (found.ok && found.data) {
      expect(found.data.currentPhase).toBe("researching");
      expect(found.data.previousPhase).toBe("discussing");
      expect(found.data.milestoneId).toBe(MS_ID);
    }
  });

  it("skips entries without session-created and returns 0", async () => {
    const entries: WorkflowJournalEntry[] = [
      {
        type: "phase-transition",
        sessionId: ORPHAN_SESS,
        milestoneId: ORPHAN_MS,
        fromPhase: "idle",
        toPhase: "discussing",
        trigger: "start",
        timestamp: new Date("2026-01-01T00:00:00Z"),
      },
    ];

    const journal = new MockWorkflowJournal(entries);
    const useCase = new ReplayWorkflowJournalUseCase(journal, sessionRepo);
    const result = await useCase.execute();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(0);
  });
});
