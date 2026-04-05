import { BaseDomainError } from "@kernel";

export class SettingsFileError extends BaseDomainError {
  readonly code: string;

  constructor(path: string, cause?: Error, operation: "read" | "write" = "read") {
    super(`Failed to ${operation} settings file: ${path}`, { path, cause: cause?.message });
    this.code = operation === "write" ? "SETTINGS.FILE_WRITE_ERROR" : "SETTINGS.FILE_READ_ERROR";
  }
}
