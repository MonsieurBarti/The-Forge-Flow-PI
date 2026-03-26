import { ok, type PersistenceError, type Result } from "@kernel";
import { ProjectFileSystemPort } from "../domain/ports/project-filesystem.port";

export class InMemoryProjectFileSystemAdapter extends ProjectFileSystemPort {
  private entries = new Map<string, string | null>();

  async exists(path: string): Promise<Result<boolean, PersistenceError>> {
    return ok(this.entries.has(path));
  }

  async createDirectory(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<Result<void, PersistenceError>> {
    if (options?.recursive) {
      const parts = path.split("/").filter(Boolean);
      let current = "";
      for (const part of parts) {
        current = `${current}/${part}`;
        this.entries.set(current, null);
      }
    } else {
      this.entries.set(path, null);
    }
    return ok(undefined);
  }

  async writeFile(
    path: string,
    content: string,
  ): Promise<Result<void, PersistenceError>> {
    this.entries.set(path, content);
    return ok(undefined);
  }

  getContent(path: string): string | undefined {
    const value = this.entries.get(path);
    return value === null ? undefined : value;
  }

  reset(): void {
    this.entries.clear();
  }
}
