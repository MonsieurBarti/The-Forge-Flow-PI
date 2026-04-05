import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createZodTool, textResult } from "@infrastructure/pi";
import { parse, stringify } from "yaml";
import { z } from "zod";

export interface UpdateSettingToolDeps {
  projectRoot: string;
}

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function deepSet(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  for (const part of parts) {
    if (FORBIDDEN_KEYS.has(part)) return;
  }
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!current[key] || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

export function createUpdateSettingTool(deps: UpdateSettingToolDeps) {
  return createZodTool({
    name: "tff_update_setting",
    label: "TFF Update Setting",
    description: "Update a single project setting by dot-path key",
    schema: z.object({
      key: z.string().describe("Dot-path key (e.g., autonomy.mode)"),
      value: z.unknown().describe("New value"),
    }),
    execute: async (params) => {
      const settingsPath = join(deps.projectRoot, ".tff", "settings.yaml");
      let existing: Record<string, unknown> = {};
      try {
        existing = (parse(readFileSync(settingsPath, "utf-8")) as Record<string, unknown>) ?? {};
      } catch {
        /* file may not exist */
      }

      deepSet(existing, params.key, params.value);
      writeFileSync(settingsPath, stringify(existing), "utf-8");
      return textResult(JSON.stringify({ updated: params.key, value: params.value }));
    },
  });
}
