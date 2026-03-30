import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { GitError, Result } from "@kernel";
import { AgentResultBuilder } from "@kernel/agents";
import { GitPort } from "@kernel/ports/git.port";
import type { GitLogEntry, GitStatus, GitWorktreeEntry } from "@kernel/ports/git.schemas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GuardrailContext, GuardrailSeverity } from "../domain/guardrail.schemas";
import { ComposableGuardrailAdapter } from "./composable-guardrail.adapter";
import { DangerousCommandRule } from "./rules/dangerous-command.rule";
import { FileScopeRule } from "./rules/file-scope.rule";

// ── MockGitPort ────────────────────────────────────────────────────────────────

class MockGitPort extends GitPort {
  private _diffFiles: string[] = [];
  private _diffContent = "";

  givenDiffFiles(files: string[]): void {
    this._diffFiles = files;
  }

  givenDiffContent(content: string): void {
    this._diffContent = content;
  }

  override diffNameOnly(_cwd: string): Promise<Result<string[], GitError>> {
    return Promise.resolve({ ok: true, data: this._diffFiles });
  }

  override diff(_cwd: string): Promise<Result<string, GitError>> {
    return Promise.resolve({ ok: true, data: this._diffContent });
  }

  override restoreWorktree(_cwd: string): Promise<Result<void, GitError>> {
    return Promise.resolve({ ok: true, data: undefined });
  }

  override listBranches(_pattern: string): Promise<Result<string[], GitError>> {
    return Promise.resolve({ ok: true, data: [] });
  }

  override createBranch(_name: string, _base: string): Promise<Result<void, GitError>> {
    return Promise.resolve({ ok: true, data: undefined });
  }

  override showFile(_branch: string, _path: string): Promise<Result<string | null, GitError>> {
    return Promise.resolve({ ok: true, data: null });
  }

  override log(_branch: string, _limit?: number): Promise<Result<GitLogEntry[], GitError>> {
    return Promise.resolve({ ok: true, data: [] });
  }

  override status(): Promise<Result<GitStatus, GitError>> {
    return Promise.resolve({
      ok: true,
      data: { branch: "main", clean: true, entries: [] },
    });
  }

  override commit(_message: string, _paths: string[]): Promise<Result<string, GitError>> {
    return Promise.resolve({ ok: true, data: "abc123" });
  }

  override revert(_commitHash: string): Promise<Result<void, GitError>> {
    return Promise.resolve({ ok: true, data: undefined });
  }

  override isAncestor(_ancestor: string, _descendant: string): Promise<Result<boolean, GitError>> {
    return Promise.resolve({ ok: true, data: false });
  }

  override worktreeAdd(
    _path: string,
    _branch: string,
    _baseBranch: string,
  ): Promise<Result<void, GitError>> {
    return Promise.resolve({ ok: true, data: undefined });
  }

  override worktreeRemove(_path: string): Promise<Result<void, GitError>> {
    return Promise.resolve({ ok: true, data: undefined });
  }

  override worktreeList(): Promise<Result<GitWorktreeEntry[], GitError>> {
    return Promise.resolve({ ok: true, data: [] });
  }

  override deleteBranch(_name: string, _force?: boolean): Promise<Result<void, GitError>> {
    return Promise.resolve({ ok: true, data: undefined });
  }

  override statusAt(_cwd: string): Promise<Result<GitStatus, GitError>> {
    return Promise.resolve({
      ok: true,
      data: { branch: "main", clean: true, entries: [] },
    });
  }
}

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
  let gitPort: MockGitPort;

  beforeEach(() => {
    gitPort = new MockGitPort();
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
