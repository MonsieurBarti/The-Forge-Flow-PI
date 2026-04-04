import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { InMemoryGitAdapter } from "@kernel";
import { AgentResultBuilder } from "@kernel/agents";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GuardrailContext, GuardrailSeverity } from "../../../domain/guardrail.schemas";
import { ComposableGuardrailAdapter } from "./composable-guardrail.adapter";
import { DangerousCommandRule } from "./rules/dangerous-command.rule";
import { FileScopeRule } from "./rules/file-scope.rule";

// ── Helpers ────────────────────────────────────────────────────────────────────

function createFixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "guardrail-fixture-"));
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(dir, relPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, "utf-8");
  }
  return dir;
}

function makeContext(
  overrides: Partial<GuardrailContext> & { workingDirectory: string },
): GuardrailContext {
  return {
    agentResult: new AgentResultBuilder().asDone().build(),
    taskFilePaths: [],
    filesChanged: [],
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("ComposableGuardrailAdapter", () => {
  let gitPort: InMemoryGitAdapter;

  beforeEach(() => {
    gitPort = new InMemoryGitAdapter();
  });

  afterEach(() => {
    // dirs are in /tmp — OS will clean them up
  });

  it("returns a clean report when no violations", async () => {
    const dir = createFixtureDir({
      "src/safe.ts": "export const x = 1;",
    });
    gitPort.givenDiffFiles(["src/safe.ts"]);
    gitPort.givenDiffContent("");

    const adapter = new ComposableGuardrailAdapter(
      [new DangerousCommandRule()],
      new Map(),
      gitPort,
    );

    const result = await adapter.validate(
      makeContext({ workingDirectory: dir, taskFilePaths: ["src/safe.ts"] }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.passed).toBe(true);
      expect(result.data.violations).toHaveLength(0);
      expect(result.data.summary).toBe("0 violations");
    }
  });

  it("collects violations from multiple rules", async () => {
    const dir = createFixtureDir({
      "src/danger.ts": 'exec("rm -rf /tmp")',
      "src/out-of-scope.ts": "export const y = 2;",
    });
    // Both files changed, but task only declares danger.ts
    gitPort.givenDiffFiles(["src/danger.ts", "src/out-of-scope.ts"]);

    const adapter = new ComposableGuardrailAdapter(
      [new DangerousCommandRule(), new FileScopeRule()],
      new Map(),
      gitPort,
    );

    const result = await adapter.validate(
      makeContext({
        workingDirectory: dir,
        taskFilePaths: ["src/danger.ts"],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.passed).toBe(false);
      const ruleIds = result.data.violations.map((v) => v.ruleId);
      expect(ruleIds).toContain("dangerous-commands");
      expect(ruleIds).toContain("file-scope");
    }
  });

  it("applies severity overrides (downgrade dangerous-commands error → warning)", async () => {
    const dir = createFixtureDir({
      "src/script.ts": 'exec("rm -rf /tmp")',
    });
    gitPort.givenDiffFiles(["src/script.ts"]);

    const overrides = new Map<string, GuardrailSeverity>([["dangerous-commands", "warning"]]);

    const adapter = new ComposableGuardrailAdapter(
      [new DangerousCommandRule()],
      overrides,
      gitPort,
    );

    const result = await adapter.validate(
      makeContext({ workingDirectory: dir, taskFilePaths: [] }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      // All violations were downgraded — no errors remain
      expect(result.data.passed).toBe(true);
      for (const v of result.data.violations) {
        expect(v.severity).toBe("warning");
      }
    }
  });

  it("skips files larger than 512KB", async () => {
    const largeContent = "x".repeat(512 * 1024 + 1);
    const dir = createFixtureDir({
      "src/huge.ts": largeContent,
    });
    gitPort.givenDiffFiles(["src/huge.ts"]);

    const adapter = new ComposableGuardrailAdapter(
      [new DangerousCommandRule()],
      new Map(),
      gitPort,
    );

    const result = await adapter.validate(
      makeContext({ workingDirectory: dir, taskFilePaths: [] }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Large file skipped — no violations
      expect(result.data.violations).toHaveLength(0);
      expect(result.data.passed).toBe(true);
    }
  });
});
