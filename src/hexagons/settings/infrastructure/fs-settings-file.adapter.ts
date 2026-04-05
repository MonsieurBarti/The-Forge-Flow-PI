import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
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

  async writeFile(path: string, content: string): Promise<Result<void, SettingsFileError>> {
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf-8");
      return ok(undefined);
    } catch (error: unknown) {
      return err(new SettingsFileError(path, error instanceof Error ? error : undefined, "write"));
    }
  }
}
