import type { ExecFileException } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return {
    ...original,
    execFile: vi.fn(),
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  };
});

vi.mock("node:crypto", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:crypto")>();
  return {
    ...original,
    randomUUID: vi.fn(() => "12345678-abcd-0000-0000-000000000000"),
  };
});

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { GitStateBranchOpsAdapter } from "./git-state-branch-ops.adapter";

const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;
const mockWriteFile = writeFile as unknown as ReturnType<typeof vi.fn>;
const mockMkdir = mkdir as unknown as ReturnType<typeof vi.fn>;

function mockSuccess(stdout = ""): void {
  mockExecFile.mockImplementationOnce(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: null, stdout: string, stderr: string) => void,
    ) => {
      cb(null, stdout, "");
    },
  );
}

function mockFailure(stderr: string, code = 1): void {
  const error = new Error("Command failed") as ExecFileException;
  error.code = code as unknown as string;
  mockExecFile.mockImplementationOnce(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: ExecFileException, stdout: string, stderr: string) => void,
    ) => {
      cb(error, "", stderr);
    },
  );
}

describe("GitStateBranchOpsAdapter", () => {
  let adapter: GitStateBranchOpsAdapter;
  const cwd = "/repo";

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GitStateBranchOpsAdapter(cwd);
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
  });

  describe("branchExists", () => {
    it("returns ok(true) when branch exists", async () => {
      mockSuccess("refs/heads/my-branch");
      const result = await adapter.branchExists("my-branch");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toBe(true);
      const call = mockExecFile.mock.calls[0];
      expect(call[1]).toContain("rev-parse");
      expect(call[1]).toContain("--verify");
      expect(call[1]).toContain("refs/heads/my-branch");
    });

    it("returns ok(false) when branch does not exist", async () => {
      mockFailure("fatal: not a valid object name refs/heads/missing");
      const result = await adapter.branchExists("missing");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toBe(false);
    });

    it("returns err on unexpected git failure", async () => {
      mockFailure("fatal: not a git repository");
      const result = await adapter.branchExists("any");
      expect(result.ok).toBe(false);
    });
  });

  describe("deleteBranch", () => {
    it("calls git branch -D with the branch name", async () => {
      mockSuccess();
      const result = await adapter.deleteBranch("old-branch");
      expect(result.ok).toBe(true);
      const call = mockExecFile.mock.calls[0];
      expect(call[1]).toContain("branch");
      expect(call[1]).toContain("-D");
      expect(call[1]).toContain("old-branch");
    });

    it("returns err on failure", async () => {
      mockFailure("error: branch 'old-branch' not found");
      const result = await adapter.deleteBranch("old-branch");
      expect(result.ok).toBe(false);
    });
  });

  describe("forkBranch", () => {
    it("calls git branch target source", async () => {
      mockSuccess();
      const result = await adapter.forkBranch("source-branch", "target-branch");
      expect(result.ok).toBe(true);
      const call = mockExecFile.mock.calls[0];
      expect(call[1]).toContain("branch");
      expect(call[1]).toContain("target-branch");
      expect(call[1]).toContain("source-branch");
    });

    it("returns err on failure", async () => {
      mockFailure("fatal: A branch named 'target-branch' already exists");
      const result = await adapter.forkBranch("source", "target-branch");
      expect(result.ok).toBe(false);
    });
  });

  describe("renameBranch", () => {
    it("calls git branch -m old new", async () => {
      mockSuccess();
      const result = await adapter.renameBranch("old-name", "new-name");
      expect(result.ok).toBe(true);
      const call = mockExecFile.mock.calls[0];
      expect(call[1]).toContain("branch");
      expect(call[1]).toContain("-m");
      expect(call[1]).toContain("old-name");
      expect(call[1]).toContain("new-name");
    });

    it("returns err on failure", async () => {
      mockFailure("error: refname refs/heads/old-name not found");
      const result = await adapter.renameBranch("old-name", "new-name");
      expect(result.ok).toBe(false);
    });
  });

  describe("createOrphan", () => {
    it("creates temp worktree, checks out orphan, empties index, commits, removes worktree", async () => {
      mockSuccess(); // worktree add --detach
      mockSuccess(); // checkout --orphan
      mockSuccess(); // rm -rf --cached
      mockSuccess(); // commit --allow-empty
      mockSuccess(); // worktree remove

      const result = await adapter.createOrphan("tff-state/new-branch");
      expect(result.ok).toBe(true);

      const calls = mockExecFile.mock.calls;
      expect(calls[0][1]).toContain("worktree");
      expect(calls[0][1]).toContain("add");
      expect(calls[0][1]).toContain("--detach");
      expect(calls[1][1]).toContain("checkout");
      expect(calls[1][1]).toContain("--orphan");
      expect(calls[1][1]).toContain("tff-state/new-branch");
      expect(calls[2][1]).toContain("rm");
      expect(calls[2][1]).toContain("--cached");
      expect(calls[3][1]).toContain("commit");
      expect(calls[3][1]).toContain("--allow-empty");
      expect(calls[4][1]).toContain("worktree");
      expect(calls[4][1]).toContain("remove");
    });

    it("cleans up worktree even if commit fails", async () => {
      mockSuccess(); // worktree add
      mockSuccess(); // checkout --orphan
      mockSuccess(); // rm -rf --cached
      mockFailure("fatal: commit failed"); // commit fails
      mockSuccess(); // worktree remove (cleanup)

      const result = await adapter.createOrphan("bad-branch");
      expect(result.ok).toBe(false);

      const calls = mockExecFile.mock.calls;
      const removeCalls = calls.filter(
        (c: unknown[]) => Array.isArray(c[1]) && (c[1] as string[]).includes("remove"),
      );
      expect(removeCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("syncToStateBranch", () => {
    it("creates temp worktree, writes files, commits, and returns SHA", async () => {
      const files = new Map<string, string>([
        ["state.json", '{"key":"value"}'],
        ["sub/dir/file.txt", "content"],
      ]);

      mockSuccess(); // worktree add
      mockSuccess(); // git add -A
      mockSuccess("[state-branch abc1234] sync: state update\n1 file changed"); // commit
      mockSuccess(); // worktree remove

      const result = await adapter.syncToStateBranch("tff-state/main", files);
      expect(result.ok).toBe(true);
      if (result.ok) expect(typeof result.data).toBe("string");

      const calls = mockExecFile.mock.calls;
      expect(calls[0][1]).toContain("worktree");
      expect(calls[0][1]).toContain("add");

      const addCall = calls.find(
        (c: unknown[]) =>
          Array.isArray(c[1]) &&
          (c[1] as string[]).includes("add") &&
          (c[1] as string[]).includes("-A"),
      );
      expect(addCall).toBeDefined();

      const commitCall = calls.find(
        (c: unknown[]) => Array.isArray(c[1]) && (c[1] as string[]).includes("commit"),
      );
      expect(commitCall).toBeDefined();

      expect(mockWriteFile).toHaveBeenCalledTimes(2);
    });

    it("cleans up worktree even if commit fails", async () => {
      const files = new Map<string, string>([["a.json", "{}"]]);

      mockSuccess(); // worktree add
      mockSuccess(); // git add -A
      mockFailure("nothing to commit"); // commit fails
      mockSuccess(); // worktree remove (cleanup)

      const result = await adapter.syncToStateBranch("tff-state/main", files);
      expect(result.ok).toBe(false);

      const calls = mockExecFile.mock.calls;
      const removeCalls = calls.filter(
        (c: unknown[]) => Array.isArray(c[1]) && (c[1] as string[]).includes("remove"),
      );
      expect(removeCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("readFromStateBranch", () => {
    it("calls git show branch:path", async () => {
      mockSuccess('{"key":"value"}');

      const result = await adapter.readFromStateBranch("tff-state/main", "state.json");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBe('{"key":"value"}');
      }

      const call = mockExecFile.mock.calls[0];
      expect(call[1]).toContain("show");
      expect(call[1]).toContain("tff-state/main:state.json");
    });

    it("returns ok(null) when path does not exist", async () => {
      mockFailure("fatal: path 'missing.json' does not exist in 'tff-state/main'");
      const result = await adapter.readFromStateBranch("tff-state/main", "missing.json");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toBeNull();
    });

    it("returns err on unexpected git failure", async () => {
      mockFailure("fatal: not a git repository");
      const result = await adapter.readFromStateBranch("tff-state/main", "state.json");
      expect(result.ok).toBe(false);
    });
  });

  describe("readAllFromStateBranch", () => {
    it("calls git ls-tree then reads each file", async () => {
      mockSuccess("file.json\nsub/other.json\n"); // ls-tree
      mockSuccess('{"a":1}'); // read file.json
      mockSuccess('{"b":2}'); // read sub/other.json

      const result = await adapter.readAllFromStateBranch("tff-state/main");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.size).toBe(2);
        expect(result.data.has("file.json")).toBe(true);
        expect(result.data.has("sub/other.json")).toBe(true);
      }

      const lsCall = mockExecFile.mock.calls[0];
      expect(lsCall[1]).toContain("ls-tree");
      expect(lsCall[1]).toContain("-r");
      expect(lsCall[1]).toContain("--name-only");
      expect(lsCall[1]).toContain("tff-state/main");
    });

    it("rejects paths with path traversal sequences", async () => {
      mockSuccess("normal.json\n../evil.json\n");

      const result = await adapter.readAllFromStateBranch("tff-state/main");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("..");
      }
    });

    it("returns empty map when branch has no files", async () => {
      mockSuccess("");
      const result = await adapter.readAllFromStateBranch("tff-state/empty");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.size).toBe(0);
    });
  });
});
