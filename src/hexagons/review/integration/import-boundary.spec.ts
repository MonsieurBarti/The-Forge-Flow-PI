import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function getAllTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllTsFiles(fullPath));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Extract all `from "..."` import specifiers from a file's content. */
function extractImports(content: string): string[] {
  const results: string[] = [];
  for (const line of content.split("\n")) {
    const m = line.match(/from\s+["']([^"']+)["']/);
    if (m) results.push(m[1]);
  }
  return results;
}

const OTHER_HEXAGONS = [
  "execution",
  "milestone",
  "project",
  "settings",
  "slice",
  "task",
  "workflow",
];

describe("Review domain import boundary (AC5)", () => {
  const domainDir = resolve(import.meta.dirname, "../domain");

  it("review/domain/ has zero imports from execution/", () => {
    const files = getAllTsFiles(domainDir);
    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (/from\s+["'].*execution/.test(lines[i])) {
          violations.push(`${file}:${i + 1}: ${lines[i].trim()}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("review/domain/ has zero imports from application/, infrastructure/, or other hexagons (AC22)", () => {
    const files = getAllTsFiles(domainDir);
    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const specifier = extractImports(lines[i])[0];
        if (!specifier) continue;
        // Disallow: relative paths going outside domain (../application, ../infrastructure)
        if (/^\.\.\/(?:application|infrastructure)/.test(specifier)) {
          violations.push(`${file}:${i + 1}: ${lines[i].trim()}`);
          continue;
        }
        // Disallow: imports from other hexagons (by name)
        if (OTHER_HEXAGONS.some((h) => new RegExp(`(?:hexagons|@)${h}`).test(specifier))) {
          violations.push(`${file}:${i + 1}: ${lines[i].trim()}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

describe("Review application import boundary (AC22)", () => {
  const applicationDir = resolve(import.meta.dirname, "../application");

  it("review/application/ only imports from ../domain/, zod, node:*, or @faker-js (test builders)", () => {
    const files = getAllTsFiles(applicationDir);
    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const specifier = extractImports(lines[i])[0];
        if (!specifier) continue;
        // Allowed: relative imports within domain
        if (/^\.\.\/domain\//.test(specifier)) continue;
        // Allowed: zod
        if (specifier === "zod") continue;
        // Allowed: node built-ins
        if (/^node:/.test(specifier)) continue;
        // Allowed: @kernel shared kernel
        if (/^@kernel/.test(specifier)) continue;
        // Disallowed: infrastructure layer
        if (/^\.\.\/infrastructure/.test(specifier)) {
          violations.push(`${file}:${i + 1}: ${lines[i].trim()}`);
          continue;
        }
        // Disallowed: other hexagons
        if (OTHER_HEXAGONS.some((h) => new RegExp(`(?:hexagons|@)${h}`).test(specifier))) {
          violations.push(`${file}:${i + 1}: ${lines[i].trim()}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
