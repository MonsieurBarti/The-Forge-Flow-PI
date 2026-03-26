import { readFile } from "node:fs/promises";
import { err, ok, type Result } from "@kernel";
import { SettingsFileError } from "../domain/errors/settings-file.error";
import { SettingsFilePort } from "../domain/ports/settings-file.port";

export class FsSettingsFileAdapter extends SettingsFilePort {
  async readFile(path: string): Promise<Result<string | null, SettingsFileError>> {
    try {
      const content = await readFile(path, "utf-8");
      return ok(content);
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return ok(null);
      }
      return err(new SettingsFileError(path, error instanceof Error ? error : undefined));
    }
  }
}
