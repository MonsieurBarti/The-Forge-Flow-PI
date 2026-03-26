import { BaseDomainError } from "@kernel";

export class SettingsFileError extends BaseDomainError {
  readonly code = "SETTINGS.FILE_READ_ERROR";

  constructor(path: string, cause?: Error) {
    super(`Failed to read settings file: ${path}`, { path, cause: cause?.message });
  }
}
