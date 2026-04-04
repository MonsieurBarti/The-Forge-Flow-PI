import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isOk } from "@kernel/result";
import type { BranchMeta } from "@kernel/infrastructure/state-branch/state-snapshot.schemas";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { WorktreePort } from "@kernel/ports/worktree.port";

export function runWorktreeContractTests(
  name: string,
  factory: () => WorktreePort & { reset(): void | Promise<void> },
) {
  describe(`${name} contract`, () => {
    let adapter: WorktreePort & { reset(): void | Promise<void> };

    beforeEach(async () => {
      adapter = factory();
      await adapter.reset();
    });

    it("create + exists roundtrip (AC1)", async () => {
      const result = await adapter.create("M04-S04", "milestone/M04");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data.sliceId).toBe("M04-S04");
        expect(result.data.branch).toBe("slice/M04-S04");
      }
      const exists = await adapter.exists("M04-S04");
      expect(exists).toBe(true);
    });

    it("exists returns false for non-existent (AC6)", async () => {
      const exists = await adapter.exists("M04-S99");
      expect(exists).toBe(false);
    });

    it("create + delete + exists returns false (AC2, AC3)", async () => {
      await adapter.create("M04-S04", "milestone/M04");
      const delResult = await adapter.delete("M04-S04");
      expect(isOk(delResult)).toBe(true);
      const exists = await adapter.exists("M04-S04");
      expect(exists).toBe(false);
    });

    it("list returns created worktrees", async () => {
      await adapter.create("M04-S04", "milestone/M04");
      await adapter.create("M04-S05", "milestone/M04");
      const result = await adapter.list();
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        const ids = result.data.map((w) => w.sliceId);
        expect(ids).toContain("M04-S04");
        expect(ids).toContain("M04-S05");
      }
    });

    it("duplicate create returns alreadyExists error (AC7)", async () => {
      await adapter.create("M04-S04", "milestone/M04");
      const result = await adapter.create("M04-S04", "milestone/M04");
      expect(isOk(result)).toBe(false);
      if (!isOk(result)) {
        expect(result.error.code).toBe("WORKTREE.ALREADY_EXISTS");
      }
    });

    it("delete non-existent returns notFound error (AC6)", async () => {
      const result = await adapter.delete("M04-S99");
      expect(isOk(result)).toBe(false);
      if (!isOk(result)) {
        expect(result.error.code).toBe("WORKTREE.NOT_FOUND");
      }
    });

    it("validate returns health for existing worktree (AC4)", async () => {
      await adapter.create("M04-S04", "milestone/M04");
      const result = await adapter.validate("M04-S04");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data.sliceId).toBe("M04-S04");
        expect(result.data.exists).toBe(true);
        expect(result.data.branchValid).toBe(true);
      }
    });

    it("validate non-existent returns notFound (AC6)", async () => {
      const result = await adapter.validate("M04-S99");
      expect(isOk(result)).toBe(false);
      if (!isOk(result)) {
        expect(result.error.code).toBe("WORKTREE.NOT_FOUND");
      }
    });

    it("resolveTffDir returns worktree .tff path", () => {
      const path = adapter.resolveTffDir("M04-S04");
      expect(path).toContain("M04-S04");
      expect(path).toContain(".tff");
    });

    it("initializeWorkspace stores branch meta", async () => {
      await adapter.create("M04-S04", "milestone/M04");
      // Create a real source dir with a settings.yaml for the copy
      const sourceDir = mkdtempSync(join(tmpdir(), "tff-init-ws-"));
      writeFileSync(join(sourceDir, "settings.yaml"), "model-profiles:\n  quality:\n    model: opus\n");
      mkdirSync(join(sourceDir, "milestones"), { recursive: true });

      const meta: BranchMeta = {
        version: 1,
        stateId: "test-id",
        codeBranch: "slice/M04-S04",
        stateBranch: "tff-state/slice/M04-S04",
        parentStateBranch: "tff-state/milestone/M04",
        lastSyncedAt: null,
        lastJournalOffset: 0,
        dirty: false,
        lastSyncedHash: null,
      };
      const result = await adapter.initializeWorkspace("M04-S04", sourceDir, meta);
      expect(isOk(result)).toBe(true);
      rmSync(sourceDir, { recursive: true, force: true });
    });
  });
}
