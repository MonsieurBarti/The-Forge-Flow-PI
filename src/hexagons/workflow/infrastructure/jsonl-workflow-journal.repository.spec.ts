import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { WorkflowJournalEntry } from "../domain/ports/workflow-journal.port";
import { JsonlWorkflowJournalRepository } from "./jsonl-workflow-journal.repository";

describe("JsonlWorkflowJournalRepository", () => {
  let dir: string;
  let repo: JsonlWorkflowJournalRepository;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wfj-"));
    repo = new JsonlWorkflowJournalRepository(join(dir, "journal.jsonl"));
  });

  const entry: WorkflowJournalEntry = {
    type: "phase-transition",
    sessionId: "sess-1",
    milestoneId: "ms-1",
    sliceId: "sl-1",
    fromPhase: "discussing",
    toPhase: "researching",
    trigger: "next",
    timestamp: new Date("2026-01-01"),
  };

  it("appends and reads entries in order", async () => {
    const r1 = await repo.append(entry);
    expect(r1.ok).toBe(true);
    const r2 = await repo.append({ ...entry, toPhase: "planning", sessionId: "sess-1" });
    expect(r2.ok).toBe(true);
    const all = await repo.readAll();
    expect(all.ok).toBe(true);
    if (all.ok) {
      expect(all.data).toHaveLength(2);
      expect(all.data[0].toPhase).toBe("researching");
      expect(all.data[1].toPhase).toBe("planning");
    }
  });

  it("returns empty array when file does not exist", async () => {
    const result = await repo.readAll();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual([]);
  });
});
