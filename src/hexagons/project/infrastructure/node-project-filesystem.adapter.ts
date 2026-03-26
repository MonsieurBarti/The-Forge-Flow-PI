import { access, mkdir, writeFile } from "node:fs/promises";
import { err, ok, PersistenceError, type Result } from "@kernel";
import { ProjectFileSystemPort } from "../domain/ports/project-filesystem.port";

export class NodeProjectFileSystemAdapter extends ProjectFileSystemPort {
  async exists(path: string): Promise<Result<boolean, PersistenceError>> {
    try {
      await access(path);
      return ok(true);
    } catch {
      return ok(false);
    }
  }

  async createDirectory(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<Result<void, PersistenceError>> {
    try {
      await mkdir(path, { recursive: options?.recursive ?? false });
      return ok(undefined);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new PersistenceError(`Failed to create directory: ${path}: ${message}`));
    }
  }

  async writeFile(
    path: string,
    content: string,
  ): Promise<Result<void, PersistenceError>> {
    try {
      await writeFile(path, content, "utf-8");
      return ok(undefined);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(new PersistenceError(`Failed to write file: ${path}: ${message}`));
    }
  }
}
