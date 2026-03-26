import { ok, type Result } from "@kernel";
import type { SettingsFileError } from "../domain/errors/settings-file.error";
import { SettingsFilePort } from "../domain/ports/settings-file.port";

export class InMemorySettingsFileAdapter extends SettingsFilePort {
  private store = new Map<string, string>();

  async readFile(path: string): Promise<Result<string | null, SettingsFileError>> {
    return ok(this.store.get(path) ?? null);
  }

  seed(path: string, content: string): void {
    this.store.set(path, content);
  }

  reset(): void {
    this.store.clear();
  }
}
