import { createHash } from "node:crypto";

function sortKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  return Object.keys(obj as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((sorted, key) => {
      sorted[key] = sortKeys((obj as Record<string, unknown>)[key]);
      return sorted;
    }, {});
}

export function computeStateHash(snapshot: unknown): string {
  const canonical = JSON.stringify(sortKeys(snapshot));
  return createHash("sha256").update(canonical).digest("hex");
}
