import { ok, type PersistenceError, type Result } from "@kernel";
import type {
  WorkflowJournalEntry,
  WorkflowJournalPort,
} from "../domain/ports/workflow-journal.port";
import type { WorkflowSessionRepositoryPort } from "../domain/ports/workflow-session.repository.port";
import { WorkflowSession } from "../domain/workflow-session.aggregate";
import type { WorkflowPhase } from "../domain/workflow-session.schemas";

export class ReplayWorkflowJournalUseCase {
  constructor(
    private readonly journal: WorkflowJournalPort,
    private readonly sessionRepo: WorkflowSessionRepositoryPort,
  ) {}

  async execute(): Promise<Result<number, PersistenceError>> {
    const entries = await this.journal.readAll();
    if (!entries.ok) return entries;

    const sessionMap = new Map<string, WorkflowJournalEntry[]>();
    for (const entry of entries.data) {
      const list = sessionMap.get(entry.sessionId) ?? [];
      list.push(entry);
      sessionMap.set(entry.sessionId, list);
    }

    let reconstructed = 0;
    for (const [, sessionEntries] of sessionMap) {
      const created = sessionEntries.find((e) => e.type === "session-created");
      if (!created) continue;

      let currentPhase: WorkflowPhase = "idle";
      let previousPhase: WorkflowPhase | undefined;
      for (const entry of sessionEntries) {
        if (entry.type === "phase-transition" && entry.toPhase) {
          previousPhase = entry.fromPhase as WorkflowPhase | undefined;
          currentPhase = entry.toPhase as WorkflowPhase;
        }
      }

      const session = WorkflowSession.reconstitute({
        id: created.sessionId,
        milestoneId: created.milestoneId,
        sliceId: created.sliceId,
        currentPhase,
        previousPhase,
        retryCount: 0,
        autonomyMode: "plan-to-pr",
        createdAt: new Date(created.timestamp),
        updatedAt: new Date(),
        lastEscalation: null,
      });

      const saveResult = await this.sessionRepo.save(session);
      if (!saveResult.ok) return saveResult;
      reconstructed++;
    }
    return ok(reconstructed);
  }
}
