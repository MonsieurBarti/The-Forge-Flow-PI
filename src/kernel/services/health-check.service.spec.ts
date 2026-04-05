import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitError } from "@kernel/errors/git.error";
import { InMemoryGitAdapter } from "@kernel/infrastructure/in-memory-git.adapter";
import type { GitHookPort, HookError } from "@kernel/ports/git-hook.port";
import type { StateBranchOpsPort } from "@kernel/ports/state-branch-ops.port";
import { ok, type Result } from "@kernel/result";
import { afterEach, describe, expect, it } from "vitest";
import { HealthCheckService } from "./health-check.service";

// ── Stubs ──────────────────────────────────────────────────────────────────

class StubGitHookPort implements GitHookPort {
  isInstalledResult: Result<boolean, HookError> = ok(true);
  installResult: Result<void, HookError> = ok(undefined);
  uninstallResult: Result<void, HookError> = ok(undefined);

  installCalls = 0;
  isInstalledCalls = 0;

  isPostCheckoutHookInstalled(): Promise<Result<boolean, HookError>> {
    this.isInstalledCalls++;
    return Promise.resolve(this.isInstalledResult);
  }

  installPostCheckoutHook(_scriptContent: string): Promise<Result<void, HookError>> {
    this.installCalls++;
    return Promise.resolve(this.installResult);
  }

  uninstallPostCheckoutHook(): Promise<Result<void, HookError>> {
    return Promise.resolve(this.uninstallResult);
  }
}

class StubStateBranchOpsPort implements StateBranchOpsPort {
  branchExistsResult: Result<boolean, GitError> = ok(false);

  createOrphan(_branchName: string): Promise<Result<void, GitError>> {
    return Promise.resolve(ok(undefined));
  }

  forkBranch(_source: string, _target: string): Promise<Result<void, GitError>> {
    return Promise.resolve(ok(undefined));
  }

  deleteBranch(_branchName: string): Promise<Result<void, GitError>> {
    return Promise.resolve(ok(undefined));
  }

  branchExists(_branchName: string): Promise<Result<boolean, GitError>> {
    return Promise.resolve(this.branchExistsResult);
  }

  renameBranch(_oldName: string, _newName: string): Promise<Result<void, GitError>> {
    return Promise.resolve(ok(undefined));
  }

  syncToStateBranch(
    _stateBranch: string,
    _files: Map<string, string>,
  ): Promise<Result<string, GitError>> {
    return Promise.resolve(ok("abc123"));
  }

  readFromStateBranch(
    _stateBranch: string,
    _path: string,
  ): Promise<Result<string | null, GitError>> {
    return Promise.resolve(ok(null));
  }

  readAllFromStateBranch(_stateBranch: string): Promise<Result<Map<string, string>, GitError>> {
    return Promise.resolve(ok(new Map()));
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "tff-health-check-test-"));
}

function buildTffDir(projectRoot: string): string {
  const tffDir = join(projectRoot, ".tff");
  mkdirSync(tffDir, { recursive: true });
  return tffDir;
}

function makeService(
  overrides: Partial<{
    gitHookPort: StubGitHookPort;
    stateBranchOps: StubStateBranchOpsPort;
    gitPort: InMemoryGitAdapter;
    projectRoot: string;
  }> = {},
  projectRoot: string,
) {
  return new HealthCheckService({
    gitHookPort: overrides.gitHookPort ?? new StubGitHookPort(),
    stateBranchOps: overrides.stateBranchOps ?? new StubStateBranchOpsPort(),
    gitPort: overrides.gitPort ?? new InMemoryGitAdapter(),
    hookScriptContent: "#!/bin/sh\necho hook",
    projectRoot: overrides.projectRoot ?? projectRoot,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("HealthCheckService", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const r of roots.splice(0)) {
      rmSync(r, { recursive: true, force: true });
    }
  });

  describe("hook check", () => {
    it("installs hook when missing", async () => {
      const root = makeTmpDir();
      roots.push(root);

      const hookPort = new StubGitHookPort();
      hookPort.isInstalledResult = ok(false);

      const service = makeService({ gitHookPort: hookPort }, root);
      const result = await service.ensurePostCheckoutHook();

      expect(hookPort.installCalls).toBe(1);
      expect(result.ok).toBe(true);
      expect(result.ok && result.data).toBe("Post-checkout hook installed");
    });

    it("skips installation when hook already installed", async () => {
      const root = makeTmpDir();
      roots.push(root);

      const hookPort = new StubGitHookPort();
      hookPort.isInstalledResult = ok(true);

      const service = makeService({ gitHookPort: hookPort }, root);
      const result = await service.ensurePostCheckoutHook();

      expect(hookPort.installCalls).toBe(0);
      expect(result.ok).toBe(true);
      expect(result.ok && result.data).toBeNull();
    });
  });

  describe("orphaned state check", () => {
    it("returns warning when state branch exists but branch-meta missing", async () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffDir(root);
      // No branch-meta.json

      const stateBranchOps = new StubStateBranchOpsPort();
      stateBranchOps.branchExistsResult = ok(true);

      const gitPort = new InMemoryGitAdapter();
      gitPort.setCurrentBranch("feature/foo");

      const service = makeService({ stateBranchOps, gitPort }, root);
      const result = await service.checkOrphanedState(tffDir);

      expect(result.ok).toBe(true);
      expect(result.ok && result.data.some((w) => w.includes("tff-state/feature/foo"))).toBe(true);
    });

    it("returns no warnings when no orphaned state exists", async () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffDir(root);
      // No branch-meta.json

      const stateBranchOps = new StubStateBranchOpsPort();
      stateBranchOps.branchExistsResult = ok(false);

      const service = makeService({ stateBranchOps }, root);
      const result = await service.checkOrphanedState(tffDir);

      expect(result.ok).toBe(true);
      expect(result.ok && result.data).toHaveLength(0);
    });
  });

  describe(".gitignore check", () => {
    it("appends missing entries to .gitignore", async () => {
      const root = makeTmpDir();
      roots.push(root);
      writeFileSync(join(root, ".gitignore"), "node_modules/\n");

      const service = makeService({}, root);
      const result = await service.ensureGitignore();

      expect(result.ok).toBe(true);
      expect(result.ok && result.data).toContain(".gitignore");
      const content = readFileSync(join(root, ".gitignore"), "utf-8");
      expect(content).toContain(".tff/");
      expect(content).toContain(".tff.backup.*");
    });

    it("skips .gitignore when both entries already present", async () => {
      const root = makeTmpDir();
      roots.push(root);
      writeFileSync(join(root, ".gitignore"), ".tff/\n.tff.backup.*\n");

      const service = makeService({}, root);
      const result = await service.ensureGitignore();

      expect(result.ok).toBe(true);
      expect(result.ok && result.data).toBeNull();
    });
  });

  describe("stale lock check", () => {
    it("removes lock with dead PID", () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffDir(root);

      const lockPath = join(tffDir, ".lock");
      writeFileSync(
        lockPath,
        JSON.stringify({ pid: 999999999, acquiredAt: new Date().toISOString() }),
      );

      const service = makeService({}, root);
      const result = service.cleanStaleLocks(tffDir);

      expect(result.ok).toBe(true);
      expect(result.ok && result.data).toContain("dead PID 999999999");
    });

    it("leaves fresh lock with live PID alone", () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffDir(root);

      const lockPath = join(tffDir, ".lock");
      writeFileSync(
        lockPath,
        JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }),
      );

      const service = makeService({}, root);
      const result = service.cleanStaleLocks(tffDir);

      expect(result.ok).toBe(true);
      expect(result.ok && result.data).toBeNull();
    });

    it("removes malformed lock file", () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffDir(root);

      const lockPath = join(tffDir, ".lock");
      writeFileSync(lockPath, "not-valid-json{{{{");

      const service = makeService({}, root);
      const result = service.cleanStaleLocks(tffDir);

      expect(result.ok).toBe(true);
      expect(result.ok && result.data).toContain("malformed");
    });
  });

  describe("runAll", () => {
    it("aggregates results from all checks", async () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffDir(root);

      // Hook missing → will be fixed
      const hookPort = new StubGitHookPort();
      hookPort.isInstalledResult = ok(false);

      // Gitignore missing entries → will be fixed
      writeFileSync(join(root, ".gitignore"), "node_modules/\n");

      // Stale lock with dead PID → will be fixed
      const lockPath = join(tffDir, ".lock");
      writeFileSync(
        lockPath,
        JSON.stringify({ pid: 999999999, acquiredAt: new Date().toISOString() }),
      );

      // Orphaned state → warning
      const stateBranchOps = new StubStateBranchOpsPort();
      stateBranchOps.branchExistsResult = ok(true);
      const gitPort = new InMemoryGitAdapter();
      gitPort.setCurrentBranch("feature/bar");

      const service = makeService({ gitHookPort: hookPort, stateBranchOps, gitPort }, root);
      const result = await service.runAll(tffDir);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.fixed.some((m) => m.includes("Post-checkout hook"))).toBe(true);
      expect(result.data.fixed.some((m) => m.includes(".gitignore"))).toBe(true);
      expect(result.data.fixed.some((m) => m.includes("dead PID"))).toBe(true);
      expect(result.data.warnings.some((w) => w.includes("tff-state/feature/bar"))).toBe(true);
    });
  });
});
