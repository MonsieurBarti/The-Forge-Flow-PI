import { join } from "node:path";
import { ok, type Result } from "@kernel";
import { parse as parseYaml } from "yaml";
import type { SettingsFileError } from "../domain/errors/settings-file.error";
import type { EnvVarPort } from "../domain/ports/env-var.port";
import type { SettingsFilePort } from "../domain/ports/settings-file.port";
import { ENV_VAR_MAP, type RawSettingsSources } from "../domain/project-settings.schemas";

export type { RawSettingsSources };

// Numeric env vars that need Number() parsing
const NUMERIC_ENV_VARS = new Set(["TFF_AUTONOMY_MAX_RETRIES", "TFF_BEADS_TIMEOUT"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function kebabToCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function normalizeKeys(obj: unknown): unknown {
  if (!isPlainObject(obj)) return obj;
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [kebabToCamelCase(k), normalizeKeys(v)]),
  );
}

function reshapeToSchema(normalized: Record<string, unknown>): Record<string, unknown> {
  const { modelProfiles, ...rest } = normalized;
  if (modelProfiles === undefined) return normalized;
  return {
    ...rest,
    modelRouting: { profiles: modelProfiles },
  };
}

function setNestedValue(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (!isPlainObject(current[key])) {
      current[key] = {};
    }
    const next = current[key];
    if (isPlainObject(next)) {
      current = next;
    }
  }
  current[path[path.length - 1]] = value;
}

export class LoadSettingsUseCase {
  constructor(
    private readonly filePort: SettingsFilePort,
    private readonly envPort: EnvVarPort,
  ) {}

  async execute(projectRoot: string): Promise<Result<RawSettingsSources, SettingsFileError>> {
    const teamPath = join(projectRoot, ".tff", "settings.yaml");
    const localPath = join(projectRoot, ".tff", "settings.local.yaml");

    const [teamResult, localResult] = await Promise.all([
      this.filePort.readFile(teamPath),
      this.filePort.readFile(localPath),
    ]);

    if (!teamResult.ok) return teamResult;
    if (!localResult.ok) return localResult;

    const team = this.parseAndNormalize(teamResult.data);
    const local = this.parseAndNormalize(localResult.data);
    const env = this.buildEnvObject();

    return ok({ team, local, env });
  }

  private parseAndNormalize(content: string | null): Record<string, unknown> | null {
    if (content === null) return null;
    try {
      const parsed: unknown = parseYaml(content);
      if (!isPlainObject(parsed)) return null;
      const normalized = normalizeKeys(parsed);
      if (!isPlainObject(normalized)) return null;
      return reshapeToSchema(normalized);
    } catch {
      return null;
    }
  }

  private buildEnvObject(): Record<string, unknown> {
    const env: Record<string, unknown> = {};
    for (const [envKey, path] of Object.entries(ENV_VAR_MAP)) {
      const raw = this.envPort.get(envKey);
      if (raw === undefined) continue;
      const value: unknown = NUMERIC_ENV_VARS.has(envKey) ? Number(raw) : raw;
      setNestedValue(env, path, value);
    }
    return env;
  }
}
