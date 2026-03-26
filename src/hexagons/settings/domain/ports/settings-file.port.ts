import type { Result } from "@kernel";
import type { SettingsFileError } from "../errors/settings-file.error";

export abstract class SettingsFilePort {
  abstract readFile(path: string): Promise<Result<string | null, SettingsFileError>>;
}
