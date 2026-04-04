import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GitError } from "@kernel/errors/git.error";
import { HookError } from "@kernel/ports/git-hook.port";
import type { GitHookPort } from "@kernel/ports/git-hook.port";
import type { StateBranchOpsPort } from "@kernel/ports/state-branch-ops.port";
import type { GitPort } from "@kernel/ports/git.port";
import { ok, err, type Result } from "@kernel/result";
import { BackupService } from "./backup-service";
import { DoctorService } from "./doctor-service";
import { InMemoryGitAdapter } from "@kernel/infrastructure/in-memory-git.adapter";

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

  readAllFromStateBranch(
    _stateBranch: string,
  ): Promise<Result<Map<string, string>, GitError>> {
    return Promise.resolve(ok(new Map()));
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "tff-doctor-test-"));
}

function buildTffDir(projectRoot: string): string {
  const tffDir = join(projectRoot, ".tff");
  mkdirSync(tffDir, { recursive: true });
  return tffDir;
}

function writeBranchMeta(tffDir: string): void {
  writeFileSync(join(tffDir, "branch-meta.json"), JSON.stringify({ branch: "main" }));
}

function writeBackup(projectRoot: string, name: string): string {
  const backupPath = join(projectRoot, name);
  mkdirSync(backupPath, { recursive: true });
  writeFileSync(join(backupPath, "branch-meta.json"), JSON.stringify({ branch: "main" }));
  return backupPath;
}

function makeService(
  overrides: Partial<{
    gitHookPort: StubGitHookPort;
    stateBranchOps: StubStateBranchOpsPort;
    gitPort: InMemoryGitAdapter;
    backupService: BackupService;
    projectRoot: string;
  }> = {},
  projectRoot: string,
) {
  return new DoctorService({
    gitHookPort: overrides.gitHookPort ?? new StubGitHookPort(),
    stateBranchOps: overrides.stateBranchOps ?? new StubStateBranchOpsPort(),
    gitPort: overrides.gitPort ?? new InMemoryGitAdapter(),
    backupService: overrides.backupService ?? new BackupService(),
    hookScriptContent: "#!/bin/sh\necho hook",
    projectRoot: overrides.projectRoot ?? projectRoot,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("DoctorService", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const r of roots.splice(0)) {
      rmSync(r, { recursive: true, force: true });
    }
  });

  describe("crash recovery", () => {
    it("restores from backup when backup exists and branch-meta missing", async () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffDir(root);
      writeBackup(root, ".tff.backup.2024-01-01T00-00-00-000Z");

      const service = makeService({}, root);
      const report = await service.diagnoseAndFix(tffDir);

      expect(report.fixed.some((m) => m.includes("Crash recovery"))).toBe(true);
    });

    it("skips recovery when branch-meta already exists", async () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffDir(root);
      writeBranchMeta(tffDir);
      writeBackup(root, ".tff.backup.2024-01-01T00-00-00-000Z");

      const service = makeService({}, root);
      const report = await service.diagnoseAndFix(tffDir);

      expect(report.fixed.some((m) => m.includes("Crash recovery"))).toBe(false);
    });
  });

  describe("hook check", () => {
    it("installs hook when missing", async () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffDir(root);
      writeBranchMeta(tffDir);

      const hookPort = new StubGitHookPort();
      hookPort.isInstalledResult = ok(false);

      const service = makeService({ gitHookPort: hookPort }, root);
      const report = await service.diagnoseAndFix(tffDir);

      expect(hookPort.installCalls).toBe(1);
      expect(report.fixed).toContain("Post-checkout hook installed");
    });

    it("does not install hook when already present", async () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffDir(root);
      writeBranchMeta(tffDir);

      const hookPort = new StubGitHookPort();
      hookPort.isInstalledResult = ok(true);

      const service = makeService({ gitHookPort: hookPort }, root);
      await service.diagnoseAndFix(tffDir);

      expect(hookPort.installCalls).toBe(0);
    });
  });

  describe("orphaned state check", () => {
    it("emits warning when state branch exists but branch-meta missing", async () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffDir(root);
      // No branch-meta.json

      const stateBranchOps = new StubStateBranchOpsPort();
      stateBranchOps.branchExistsResult = ok(true);

      const gitPort = new InMemoryGitAdapter();
      gitPort.setCurrentBranch("feature/foo");

      const service = makeService({ stateBranchOps, gitPort }, root);
      const report = await service.diagnoseAndFix(tffDir);

      expect(report.warnings.some((w) => w.includes("tff-state/feature/foo"))).toBe(true);
    });

    it("emits no warning when no state branch exists", async () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffDir(root);
      // No branch-meta.json

      const stateBranchOps = new StubStateBranchOpsPort();
      stateBranchOps.branchExistsResult = ok(false);

      const service = makeService({ stateBranchOps }, root);
      const report = await service.diagnoseAndFix(tffDir);

      expect(report.warnings.some((w) => w.includes("restore needed"))).toBe(false);
    });
  });

  describe(".gitignore check", () => {
    it("appends missing entries to .gitignore", async () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffDir(root);
      writeBranchMeta(tffDir);
      writeFileSync(join(root, ".gitignore"), "node_modules/\n");

      const service = makeService({}, root);
      const report = await service.diagnoseAndFix(tffDir);

      expect(report.fixed.some((m) => m.includes(".gitignore"))).toBe(true);
      const content = readFileSync(join(root, ".gitignore"), "utf-8");
      expect(content).toContain(".tff/");
      expect(content).toContain(".tff.backup.*");
    });

    it("does not modify .gitignore when both entries already present", async () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffDir(root);
      writeBranchMeta(tffDir);
      writeFileSync(join(root, ".gitignore"), ".tff/\n.tff.backup.*\n");

      const service = makeService({}, root);
      const report = await service.diagnoseAndFix(tffDir);

      expect(report.fixed.some((m) => m.includes(".gitignore"))).toBe(false);
    });
  });

  describe("stale lock check", () => {
    it("removes lock with dead PID", async () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffDir(root);
      writeBranchMeta(tffDir);

      const lockPath = join(tffDir, ".lock");
      writeFileSync(
        lockPath,
        JSON.stringify({ pid: 999999999, acquiredAt: new Date().toISOString() }),
      );

      const service = makeService({}, root);
      const report = await service.diagnoseAndFix(tffDir);

      expect(report.fixed.some((m) => m.includes("dead PID 999999999"))).toBe(true);
    });

    it("leaves fresh lock with live PID alone", async () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffDir(root);
      writeBranchMeta(tffDir);

      const lockPath = join(tffDir, ".lock");
      writeFileSync(
        lockPath,
        JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }),
      );

      const service = makeService({}, root);
      const report = await service.diagnoseAndFix(tffDir);

      expect(report.fixed.some((m) => m.includes("Stale lock"))).toBe(false);
    });

    it("removes malformed lock file", async () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffDir(root);
      writeBranchMeta(tffDir);

      const lockPath = join(tffDir, ".lock");
      writeFileSync(lockPath, "not-valid-json{{{{");

      const service = makeService({}, root);
      const report = await service.diagnoseAndFix(tffDir);

      expect(report.fixed.some((m) => m.includes("malformed"))).toBe(true);
    });
  });

  describe("non-throwing", () => {
    it("completes all checks even when hook check returns error", async () => {
      const root = makeTmpDir();
      roots.push(root);
      const tffDir = buildTffDir(root);
      writeBranchMeta(tffDir);

      const hookPort = new StubGitHookPort();
      hookPort.isInstalledResult = err(new HookError("HOOK_DIR_NOT_FOUND", "no hooks dir"));

      const service = makeService({ gitHookPort: hookPort }, root);

      await expect(service.diagnoseAndFix(tffDir)).resolves.toBeDefined();
    });
  });
});
