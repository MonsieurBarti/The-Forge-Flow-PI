import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GitStateBranchOpsAdapter } from "./git-state-branch-ops.adapter";
import { isOk } from "@kernel/result";

let tmpDir: string;
let adapter: GitStateBranchOpsAdapter;

function git(args: string[], cwd: string = tmpDir): string {
  return execFileSync("git", ["--no-pager", "-c", "color.ui=never", ...args], {
    cwd,
    encoding: "utf-8",
    env: { ...process.env },
  }).trim();
}

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "tff-int-test-"));
  git(["init", "-b", "main"]);
  git(["config", "user.email", "test@test.com"]);
  git(["config", "user.name", "Test"]);
  // Write a real file so the index is non-empty; createOrphan uses git rm --cached
  // which fails on an empty-commit repo (nothing to unstage).
  await writeFile(path.join(tmpDir, "README"), "repo root");
  git(["add", "README"]);
  git(["commit", "-m", "init"]);
  adapter = new GitStateBranchOpsAdapter(tmpDir);
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("GitStateBranchOpsAdapter integration", () => {
  it(
    "createOrphan — new branch has no common ancestor with main",
    async () => {
      const result = await adapter.createOrphan("tff-state/test");
      expect(isOk(result)).toBe(true);

      // branchExists should confirm it
      const exists = await adapter.branchExists("tff-state/test");
      expect(isOk(exists) && exists.data).toBe(true);

      // merge-base should fail (no common ancestor)
      expect(() => git(["merge-base", "main", "tff-state/test"])).toThrow();
    },
    { timeout: 30_000 },
  );

  it(
    "syncToStateBranch + readFromStateBranch — round-trip bytes are identical",
    async () => {
      await adapter.createOrphan("tff-state/data");

      const content = Buffer.from("test content");
      const files = new Map<string, Buffer>([["state.json", content]]);

      const syncResult = await adapter.syncToStateBranch("tff-state/data", files);
      expect(isOk(syncResult)).toBe(true);

      const readResult = await adapter.readFromStateBranch("tff-state/data", "state.json");
      expect(isOk(readResult)).toBe(true);
      if (isOk(readResult)) {
        expect(readResult.data).not.toBeNull();
        expect(readResult.data).toEqual(content);
      }
    },
    { timeout: 30_000 },
  );

  it(
    "readAllFromStateBranch — map contains all written files with correct content",
    async () => {
      await adapter.createOrphan("tff-state/all");

      const files = new Map<string, Buffer>([
        ["a.json", Buffer.from("aaa")],
        ["b.json", Buffer.from("bbb")],
        ["nested/c.json", Buffer.from("ccc")],
      ]);

      await adapter.syncToStateBranch("tff-state/all", files);

      const allResult = await adapter.readAllFromStateBranch("tff-state/all");
      expect(isOk(allResult)).toBe(true);
      if (isOk(allResult)) {
        const map = allResult.data;
        expect(map.size).toBe(3);
        expect(map.get("a.json")).toEqual(Buffer.from("aaa"));
        expect(map.get("b.json")).toEqual(Buffer.from("bbb"));
        expect(map.get("nested/c.json")).toEqual(Buffer.from("ccc"));
      }
    },
    { timeout: 30_000 },
  );

  it(
    "forkBranch — modifying fork does not affect source",
    async () => {
      await adapter.createOrphan("tff-state/parent");
      const original = Buffer.from("original content");
      await adapter.syncToStateBranch("tff-state/parent", new Map([["data.txt", original]]));

      const forkResult = await adapter.forkBranch("tff-state/parent", "tff-state/child");
      expect(isOk(forkResult)).toBe(true);

      // Modify child
      const modified = Buffer.from("modified content");
      await adapter.syncToStateBranch("tff-state/child", new Map([["data.txt", modified]]));

      // Parent should still have original
      const parentRead = await adapter.readFromStateBranch("tff-state/parent", "data.txt");
      expect(isOk(parentRead)).toBe(true);
      if (isOk(parentRead)) {
        expect(parentRead.data).toEqual(original);
      }
    },
    { timeout: 30_000 },
  );

  it(
    "branchExists — true for existing branch, false for non-existing",
    async () => {
      const existsMain = await adapter.branchExists("main");
      expect(isOk(existsMain) && existsMain.data).toBe(true);

      const existsGhost = await adapter.branchExists("does-not-exist");
      expect(isOk(existsGhost)).toBe(true);
      if (isOk(existsGhost)) {
        expect(existsGhost.data).toBe(false);
      }
    },
    { timeout: 30_000 },
  );

  it(
    "renameBranch — old name gone, new name exists with same content",
    async () => {
      await adapter.createOrphan("tff-state/old");
      const content = Buffer.from("rename me");
      await adapter.syncToStateBranch("tff-state/old", new Map([["f.txt", content]]));

      const renameResult = await adapter.renameBranch("tff-state/old", "tff-state/new");
      expect(isOk(renameResult)).toBe(true);

      const oldGone = await adapter.branchExists("tff-state/old");
      expect(isOk(oldGone) && oldGone.data).toBe(false);

      const newExists = await adapter.branchExists("tff-state/new");
      expect(isOk(newExists) && newExists.data).toBe(true);

      const readResult = await adapter.readFromStateBranch("tff-state/new", "f.txt");
      expect(isOk(readResult)).toBe(true);
      if (isOk(readResult)) {
        expect(readResult.data).toEqual(content);
      }
    },
    { timeout: 30_000 },
  );

  it(
    "deleteBranch — branchExists returns false after deletion",
    async () => {
      await adapter.createOrphan("tff-state/to-delete");

      const deleteResult = await adapter.deleteBranch("tff-state/to-delete");
      expect(isOk(deleteResult)).toBe(true);

      const exists = await adapter.branchExists("tff-state/to-delete");
      expect(isOk(exists) && exists.data).toBe(false);
    },
    { timeout: 30_000 },
  );

  it(
    "readFromStateBranch with non-existing path — returns ok(null)",
    async () => {
      await adapter.createOrphan("tff-state/empty");
      await adapter.syncToStateBranch("tff-state/empty", new Map([["placeholder.txt", Buffer.from("x")]]));

      const result = await adapter.readFromStateBranch("tff-state/empty", "does-not-exist.json");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toBeNull();
      }
    },
    { timeout: 30_000 },
  );

  it(
    "binary safety — buffer with binary bytes round-trips exactly",
    async () => {
      await adapter.createOrphan("tff-state/binary");

      const binary = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x80, 0x00, 0xff]);
      await adapter.syncToStateBranch("tff-state/binary", new Map([["bin.dat", binary]]));

      const result = await adapter.readFromStateBranch("tff-state/binary", "bin.dat");
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).not.toBeNull();
        expect(result.data).toEqual(binary);
      }
    },
    { timeout: 30_000 },
  );
});
