import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BackupService } from "./backup-service";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "tff-backup-test-"));
}

function buildTffStructure(base: string): string {
  const tffDir = join(base, ".tff");
  mkdirSync(tffDir);

  writeFileSync(join(tffDir, "PROJECT.md"), "# Project");
  writeFileSync(join(tffDir, "settings.yaml"), "key: value");
  writeFileSync(join(tffDir, "state.db"), "db-content");
  writeFileSync(join(tffDir, ".lock"), "locked");

  const worktrees = join(tffDir, "worktrees");
  mkdirSync(worktrees);
  mkdirSync(join(worktrees, "some-worktree"));
  writeFileSync(join(worktrees, "some-worktree", "data.txt"), "worktree data");

  return tffDir;
}

describe("BackupService", () => {
  const roots: string[] = [];
  const service = new BackupService();

  afterEach(() => {
    const { rmSync } = require("node:fs");
    for (const r of roots.splice(0)) {
      rmSync(r, { recursive: true, force: true });
    }
  });

  describe("createBackup", () => {
    it("copies .tff/ to a .tff.backup.<ts> directory", () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffStructure(root);

      const backupPath = service.createBackup(tffDir);

      expect(backupPath).toMatch(/\.tff\.backup\./);
      const stat = statSync(backupPath);
      expect(stat.isDirectory()).toBe(true);
    });

    it("copies regular files into the backup", () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffStructure(root);

      const backupPath = service.createBackup(tffDir);

      expect(readFileSync(join(backupPath, "PROJECT.md"), "utf8")).toBe("# Project");
      expect(readFileSync(join(backupPath, "settings.yaml"), "utf8")).toBe("key: value");
      expect(readFileSync(join(backupPath, "state.db"), "utf8")).toBe("db-content");
    });

    it("excludes the worktrees/ directory from backup", () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffStructure(root);

      const backupPath = service.createBackup(tffDir);

      const entries = readdirSync(backupPath);
      expect(entries).not.toContain("worktrees");
    });

    it("excludes the .lock file from backup", () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffStructure(root);

      const backupPath = service.createBackup(tffDir);

      const entries = readdirSync(backupPath);
      expect(entries).not.toContain(".lock");
    });
  });

  describe("cleanOldBackups", () => {
    function createFakeBackups(root: string, names: string[]): void {
      for (const name of names) {
        mkdirSync(join(root, name));
      }
    }

    it("removes oldest backups beyond keep limit", () => {
      const root = makeTmpDir();
      roots.push(root);

      const names = [
        ".tff.backup.2024-01-01T00-00-00-000Z",
        ".tff.backup.2024-01-02T00-00-00-000Z",
        ".tff.backup.2024-01-03T00-00-00-000Z",
        ".tff.backup.2024-01-04T00-00-00-000Z",
        ".tff.backup.2024-01-05T00-00-00-000Z",
      ];
      createFakeBackups(root, names);

      const cleaned = service.cleanOldBackups(root, 3);

      expect(cleaned).toBe(2);
      const remaining = readdirSync(root).filter((e) => e.startsWith(".tff.backup."));
      expect(remaining).toHaveLength(3);
      // newest 3 remain
      expect(remaining).toContain(".tff.backup.2024-01-05T00-00-00-000Z");
      expect(remaining).toContain(".tff.backup.2024-01-04T00-00-00-000Z");
      expect(remaining).toContain(".tff.backup.2024-01-03T00-00-00-000Z");
    });

    it("removes nothing when backup count is within keep limit", () => {
      const root = makeTmpDir();
      roots.push(root);

      const names = [
        ".tff.backup.2024-01-01T00-00-00-000Z",
        ".tff.backup.2024-01-02T00-00-00-000Z",
      ];
      createFakeBackups(root, names);

      const cleaned = service.cleanOldBackups(root, 3);

      expect(cleaned).toBe(0);
      const remaining = readdirSync(root).filter((e) => e.startsWith(".tff.backup."));
      expect(remaining).toHaveLength(2);
    });

    it("removes nothing when there are exactly keep backups", () => {
      const root = makeTmpDir();
      roots.push(root);

      const names = [
        ".tff.backup.2024-01-01T00-00-00-000Z",
        ".tff.backup.2024-01-02T00-00-00-000Z",
        ".tff.backup.2024-01-03T00-00-00-000Z",
      ];
      createFakeBackups(root, names);

      const cleaned = service.cleanOldBackups(root, 3);

      expect(cleaned).toBe(0);
    });
  });

  describe("clearTffDir", () => {
    it("removes regular contents from tffDir", () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffStructure(root);

      service.clearTffDir(tffDir);

      const entries = readdirSync(tffDir);
      expect(entries).not.toContain("PROJECT.md");
      expect(entries).not.toContain("settings.yaml");
      expect(entries).not.toContain("state.db");
    });

    it("preserves worktrees/ directory", () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffStructure(root);

      service.clearTffDir(tffDir);

      const entries = readdirSync(tffDir);
      expect(entries).toContain("worktrees");
    });

    it("preserves .lock file", () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffStructure(root);

      service.clearTffDir(tffDir);

      const entries = readdirSync(tffDir);
      expect(entries).toContain(".lock");
    });

    it("does nothing when tffDir does not exist", () => {
      const root = makeTmpDir();
      roots.push(root);
      const nonExistent = join(root, "nonexistent");

      // Should not throw
      expect(() => service.clearTffDir(nonExistent)).not.toThrow();
    });
  });

  describe("restoreFromBackup", () => {
    it("clears tffDir then copies backup contents in", () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffStructure(root);

      // Create a backup first
      const backupPath = service.createBackup(tffDir);

      // Mutate tffDir to simulate drift
      writeFileSync(join(tffDir, "new-file.txt"), "new content");

      // Restore
      service.restoreFromBackup(backupPath, tffDir);

      const entries = readdirSync(tffDir);
      // Backup contents should be present
      expect(entries).toContain("PROJECT.md");
      expect(entries).toContain("settings.yaml");
      expect(entries).toContain("state.db");
      // Drift file should be gone (tffDir was cleared first)
      expect(entries).not.toContain("new-file.txt");
    });

    it("preserves worktrees/ and .lock during restore (clearTffDir skips them)", () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffStructure(root);

      const backupPath = service.createBackup(tffDir);

      service.restoreFromBackup(backupPath, tffDir);

      // worktrees/ and .lock survive the clear phase
      const entries = readdirSync(tffDir);
      expect(entries).toContain("worktrees");
      expect(entries).toContain(".lock");
    });

    it("restores file contents correctly", () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffStructure(root);

      const backupPath = service.createBackup(tffDir);

      // Overwrite a file
      writeFileSync(join(tffDir, "PROJECT.md"), "corrupted");

      service.restoreFromBackup(backupPath, tffDir);

      expect(readFileSync(join(tffDir, "PROJECT.md"), "utf8")).toBe("# Project");
    });
  });
});
