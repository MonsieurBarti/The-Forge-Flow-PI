import { ok, type Result } from "@kernel";
import type { RawSettingsSources } from "../domain/project-settings.schemas";
import { ProjectSettings } from "../domain/project-settings.value-object";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(target: unknown, source: unknown): unknown {
  if (!isPlainObject(target) || !isPlainObject(source)) return source;
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    result[key] = Array.isArray(source[key]) ? source[key] : deepMerge(result[key], source[key]);
  }
  return result;
}

export class MergeSettingsUseCase {
  execute(sources: RawSettingsSources): Result<ProjectSettings, never> {
    let merged: unknown = {};
    if (sources.team !== null) {
      merged = deepMerge(merged, sources.team);
    }
    if (sources.local !== null) {
      merged = deepMerge(merged, sources.local);
    }
    merged = deepMerge(merged, sources.env);
    return ok(ProjectSettings.create(merged));
  }
}
