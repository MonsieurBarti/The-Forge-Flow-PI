import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

/**
 * Lazy database that defers creation until `.tff/` exists.
 *
 * Repository constructors call `exec(CREATE TABLE ...)` eagerly.
 * This proxy buffers those DDL statements and replays them when
 * the database is first opened — either because `.tff/` already
 * exists (returning user) or because `ensureReady()` was called
 * (init flow creates the directory first).
 *
 * Non-DDL operations on an uninitialized database throw a clear
 * "No TFF project found" error.
 */
export function createLazyDatabase(dbPath: string): Database.Database & { ensureReady(): void } {
  let db: Database.Database | null = null;
  const pendingDDL: string[] = [];

  function openDb(): Database.Database {
    if (db) return db;
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    db = new Database(dbPath);
    // Replay buffered DDL
    for (const sql of pendingDDL) {
      db.exec(sql);
    }
    pendingDDL.length = 0;
    return db;
  }

  function getDbOrThrow(): Database.Database {
    if (db) return db;
    // Auto-open if .tff/ exists (returning user)
    if (existsSync(dirname(dbPath))) {
      return openDb();
    }
    throw new Error("No TFF project found. Run /tff:new to initialize.");
  }

  return new Proxy({} as Database.Database & { ensureReady(): void }, {
    get(_target, prop) {
      // Explicit activation (called by init after creating .tff/)
      if (prop === "ensureReady") {
        return () => openDb();
      }

      // Buffer DDL calls when DB isn't open yet
      if (prop === "exec") {
        if (!db && !existsSync(dirname(dbPath))) {
          return (sql: string) => {
            pendingDDL.push(sql);
          };
        }
        const real = getDbOrThrow();
        return real.exec.bind(real);
      }

      // All other access requires a live database
      const real = getDbOrThrow();
      const value = (real as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof value === "function") {
        return value.bind(real);
      }
      return value;
    },
  });
}
