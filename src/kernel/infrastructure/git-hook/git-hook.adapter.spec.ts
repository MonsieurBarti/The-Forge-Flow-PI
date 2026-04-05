import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitHookAdapter } from "./git-hook.adapter";

function makeTmpGitDir(): string {
  const dir = join(
    os.tmpdir(),
    `tff-git-hook-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("GitHookAdapter", () => {
  let tmpDir: string;
  let gitDir: string;
  let adapter: GitHookAdapter;

  beforeEach(() => {
    tmpDir = makeTmpGitDir();
    gitDir = join(tmpDir, ".git");
    mkdirSync(gitDir, { recursive: true });
    adapter = new GitHookAdapter(gitDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("installPostCheckoutHook", () => {
    it("creates hook file with shebang, markers, and script content", async () => {
      const script = 'echo "branch switched"';
      const result = await adapter.installPostCheckoutHook(script);

      expect(result.ok).toBe(true);

      const hookPath = join(gitDir, "hooks", "post-checkout");
      const content = readFileSync(hookPath, "utf-8");

      expect(content).toContain("#!/bin/sh");
      expect(content).toContain("# --- TFF-PI BEGIN (do not edit) ---");
      expect(content).toContain(script);
      expect(content).toContain("# --- TFF-PI END ---");
    });

    it("sets hook file as executable (chmod +x)", async () => {
      await adapter.installPostCheckoutHook("echo test");

      const hookPath = join(gitDir, "hooks", "post-checkout");
      const stats = statSync(hookPath);
      // owner execute bit: 0o100
      expect(stats.mode & 0o111).toBeGreaterThan(0);
    });

    it("preserves existing user content outside markers", async () => {
      const hookPath = join(gitDir, "hooks", "post-checkout");
      mkdirSync(join(gitDir, "hooks"), { recursive: true });
      writeFileSync(hookPath, "#!/bin/sh\n\necho 'user hook'\n");

      await adapter.installPostCheckoutHook("echo tff");

      const content = readFileSync(hookPath, "utf-8");
      expect(content).toContain("echo 'user hook'");
      expect(content).toContain("# --- TFF-PI BEGIN (do not edit) ---");
      expect(content).toContain("echo tff");
      expect(content).toContain("# --- TFF-PI END ---");
    });

    it("is idempotent: second install replaces section, not duplicates", async () => {
      await adapter.installPostCheckoutHook("echo first");
      await adapter.installPostCheckoutHook("echo second");

      const hookPath = join(gitDir, "hooks", "post-checkout");
      const content = readFileSync(hookPath, "utf-8");

      const beginCount = (content.match(/# --- TFF-PI BEGIN/g) ?? []).length;
      expect(beginCount).toBe(1);
      expect(content).not.toContain("echo first");
      expect(content).toContain("echo second");
    });
  });

  describe("isPostCheckoutHookInstalled", () => {
    it("returns false when no hook file exists", async () => {
      const result = await adapter.isPostCheckoutHookInstalled();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toBe(false);
    });

    it("returns true after install", async () => {
      await adapter.installPostCheckoutHook("echo tff");
      const result = await adapter.isPostCheckoutHookInstalled();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toBe(true);
    });
  });

  describe("uninstallPostCheckoutHook", () => {
    it("removes the TFF section and preserves user hooks", async () => {
      const hookPath = join(gitDir, "hooks", "post-checkout");
      mkdirSync(join(gitDir, "hooks"), { recursive: true });
      writeFileSync(hookPath, "#!/bin/sh\n\necho 'user hook'\n");

      await adapter.installPostCheckoutHook("echo tff");
      await adapter.uninstallPostCheckoutHook();

      const content = readFileSync(hookPath, "utf-8");
      expect(content).toContain("echo 'user hook'");
      expect(content).not.toContain("# --- TFF-PI BEGIN (do not edit) ---");
      expect(content).not.toContain("echo tff");
    });

    it("is a no-op when no hook file exists", async () => {
      const result = await adapter.uninstallPostCheckoutHook();
      expect(result.ok).toBe(true);
    });
  });

  describe("error cases", () => {
    it("returns HOOK_DIR_NOT_FOUND when .git dir does not exist", async () => {
      const badAdapter = new GitHookAdapter(join(tmpDir, "nonexistent", ".git"));
      const result = await badAdapter.installPostCheckoutHook("echo x");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("HOOK.HOOK_DIR_NOT_FOUND");
      }
    });
  });
});
