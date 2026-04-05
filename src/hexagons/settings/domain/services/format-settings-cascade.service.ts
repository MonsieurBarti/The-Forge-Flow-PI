import type { RawSettingsSources } from "../../use-cases/load-settings.use-case";
import type { ProjectSettings } from "../project-settings.value-object";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getNestedValue(obj: Record<string, unknown> | null | undefined, path: string): unknown {
  if (!obj) return undefined;
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (!isPlainObject(current)) return undefined;
    current = current[part];
  }
  return current;
}

export class FormatSettingsCascadeService {
  format(settings: ProjectSettings, sources: RawSettingsSources): string {
    const json = settings.toJSON();
    let md = "# Settings — Active Configuration\n\n";

    for (const [section, values] of Object.entries(json)) {
      md += `## ${section}\n`;
      md += "| Setting | Value | Source |\n";
      md += "|---|---|---|\n";

      this.walkLeaves(values, section, sources, (path, value, source) => {
        md += `| ${path} | ${JSON.stringify(value)} | [${source}] |\n`;
      });

      md += "\n";
    }

    return md;
  }

  private walkLeaves(
    obj: unknown,
    prefix: string,
    sources: RawSettingsSources,
    callback: (path: string, value: unknown, source: string) => void,
  ): void {
    if (!isPlainObject(obj)) {
      const source = this.attributeSource(prefix, sources);
      callback(prefix, obj, source);
      return;
    }

    for (const [key, value] of Object.entries(obj)) {
      const path = `${prefix}.${key}`;
      if (isPlainObject(value)) {
        this.walkLeaves(value, path, sources, callback);
      } else {
        const source = this.attributeSource(path, sources);
        callback(path, value, source);
      }
    }
  }

  private attributeSource(path: string, sources: RawSettingsSources): string {
    // Strip the top-level section prefix from the path for source lookup
    // path is like "autonomy.mode" — already usable directly
    if (getNestedValue(sources.env, path) !== undefined) return "env";
    if (getNestedValue(sources.local ?? undefined, path) !== undefined) return "local";
    if (getNestedValue(sources.team ?? undefined, path) !== undefined) return "team";
    return "default";
  }
}
