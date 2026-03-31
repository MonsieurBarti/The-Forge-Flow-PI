import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok, type PersistenceError, type Result } from "@kernel";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExecutionSession } from "../domain/execution-session.aggregate";
import { MarkdownExecutionSessionAdapter } from "./markdown-execution-session.adapter";

const SLICE_ID = crypto.randomUUID();
const SLICE_PATH = "milestones/M04/slices/M04-S01";
const NOW = new Date("2026-03-30T12:00:00Z");

let tmpDir: string;
let adapter: MarkdownExecutionSessionAdapter;

function createSession(): ExecutionSession {
  return ExecutionSession.createNew({
    id: crypto.randomUUID(),
    sliceId: SLICE_ID,
    milestoneId: crypto.randomUUID(),
    now: NOW,
  });
}

async function resolvePath(_sliceId: string): Promise<Result<string, PersistenceError>> {
  return ok(SLICE_PATH);
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "tff-session-"));
  const sliceDir = join(tmpDir, SLICE_PATH);
  await mkdir(sliceDir, { recursive: true });
  adapter = new MarkdownExecutionSessionAdapter(tmpDir, resolvePath);
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("MarkdownExecutionSessionAdapter", () => {
  it("save + findBySliceId round-trips session", async () => {
    const session = createSession();
    session.start(NOW);

    await adapter.save(session);
    const result = await adapter.findBySliceId(SLICE_ID);

    expect(result.ok).toBe(true);
    if (result.ok && result.data) {
      expect(result.data.status).toBe("running");
      expect(result.data.sliceId).toBe(SLICE_ID);
    }
  });

  it("returns null when no session exists", async () => {
    const result = await adapter.findBySliceId(crypto.randomUUID());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBeNull();
  });

  it("preserves checkpoint-data block", async () => {
    const cpPath = join(tmpDir, SLICE_PATH, "CHECKPOINT.md");
    const checkpointContent = '# Checkpoint\n\n<!-- CHECKPOINT_JSON\n{"id":"cp-1"}\n-->\n';
    await writeFile(cpPath, checkpointContent, "utf-8");

    const session = createSession();
    session.start(NOW);
    await adapter.save(session);

    const content = await readFile(cpPath, "utf-8");
    expect(content).toContain("<!-- CHECKPOINT_JSON");
    expect(content).toContain("<!-- session-data:");
  });

  it("delete removes session block but preserves checkpoint", async () => {
    const cpPath = join(tmpDir, SLICE_PATH, "CHECKPOINT.md");
    const checkpointContent = '# Checkpoint\n\n<!-- CHECKPOINT_JSON\n{"id":"cp-1"}\n-->\n';
    await writeFile(cpPath, checkpointContent, "utf-8");

    const session = createSession();
    session.start(NOW);
    await adapter.save(session);
    await adapter.delete(SLICE_ID);

    const content = await readFile(cpPath, "utf-8");
    expect(content).toContain("<!-- CHECKPOINT_JSON");
    expect(content).not.toContain("<!-- session-data:");
  });
});
