import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";

export class BackupService {
  createBackup(tffDir: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${tffDir}.backup.${timestamp}`;

    cpSync(tffDir, backupPath, {
      recursive: true,
      filter: (src) => {
        const rel = src.slice(tffDir.length);
        if (rel.startsWith("/worktrees") || rel.startsWith("\\worktrees")) return false;
        if (basename(src) === ".lock") return false;
        return true;
      },
    });

    return backupPath;
  }

  cleanOldBackups(projectRoot: string, keep: number = 3): number {
    const entries = readdirSync(projectRoot)
      .filter((e) => e.startsWith(".tff.backup."))
      .map((e) => ({ name: e, path: join(projectRoot, e) }))
      .sort((a, b) => b.name.localeCompare(a.name)); // newest first

    let cleaned = 0;
    for (const entry of entries.slice(keep)) {
      rmSync(entry.path, { recursive: true, force: true });
      cleaned++;
    }
    return cleaned;
  }

  clearTffDir(tffDir: string): void {
    if (!existsSync(tffDir)) return;
    const entries = readdirSync(tffDir);
    for (const entry of entries) {
      if (entry === "worktrees" || entry === ".lock") continue;
      rmSync(join(tffDir, entry), { recursive: true, force: true });
    }
  }

  restoreFromBackup(backupPath: string, tffDir: string): void {
    this.clearTffDir(tffDir);
    cpSync(backupPath, tffDir, { recursive: true });
  }
}
