import type { PersistenceError, Result } from "@kernel";

export abstract class ProjectFileSystemPort {
  abstract exists(path: string): Promise<Result<boolean, PersistenceError>>;
  abstract createDirectory(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<Result<void, PersistenceError>>;
  abstract writeFile(
    path: string,
    content: string,
  ): Promise<Result<void, PersistenceError>>;
}
