import { readFileSync } from "node:fs";
import { join } from "node:path";

const RESOURCES_DIR = import.meta.dirname;

export function resourcePath(relativePath: string): string {
  return join(RESOURCES_DIR, relativePath);
}

export function loadResource(relativePath: string): string {
  return readFileSync(resourcePath(relativePath), "utf-8");
}
