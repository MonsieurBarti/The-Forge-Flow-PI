import { describe, expect, it } from "vitest";
import { BaseDomainError } from "./base-domain.error";
import { GitError } from "./git.error";
import { GitHubError } from "./github.error";
import { PersistenceError } from "./persistence.error";
import { SyncError } from "./sync.error";

describe("BaseDomainError hierarchy", () => {
  describe("PersistenceError", () => {
    it("extends BaseDomainError and Error", () => {
      const error = new PersistenceError("db failed");
      expect(error).toBeInstanceOf(BaseDomainError);
      expect(error).toBeInstanceOf(Error);
    });

    it('has code "PERSISTENCE.FAILURE"', () => {
      const error = new PersistenceError("db failed");
      expect(error.code).toBe("PERSISTENCE.FAILURE");
    });

    it('has name "PersistenceError"', () => {
      const error = new PersistenceError("db failed");
      expect(error.name).toBe("PersistenceError");
    });

    it("has undefined metadata when not provided", () => {
      const error = new PersistenceError("db failed");
      expect(error.metadata).toBeUndefined();
    });

    it("has metadata when provided", () => {
      const meta = { table: "issues", operation: "insert" };
      const error = new PersistenceError("db failed", meta);
      expect(error.metadata).toEqual(meta);
    });
  });

  describe("GitError", () => {
    it('prepends "GIT." to the given code', () => {
      const error = new GitError("BRANCH_NOT_FOUND", "branch missing");
      expect(error.code).toBe("GIT.BRANCH_NOT_FOUND");
    });

    it("is instanceof BaseDomainError and Error", () => {
      const error = new GitError("CLONE_FAILED", "clone failed");
      expect(error).toBeInstanceOf(BaseDomainError);
      expect(error).toBeInstanceOf(Error);
    });

    it("has accessible message", () => {
      const error = new GitError("PUSH_FAILED", "push rejected");
      expect(error.message).toBe("push rejected");
    });
  });

  describe("GitHubError", () => {
    it('prepends "GITHUB." to the given code', () => {
      const error = new GitHubError("RATE_LIMITED", "too many requests");
      expect(error.code).toBe("GITHUB.RATE_LIMITED");
    });

    it("is instanceof BaseDomainError and Error", () => {
      const error = new GitHubError("NOT_FOUND", "repo not found");
      expect(error).toBeInstanceOf(BaseDomainError);
      expect(error).toBeInstanceOf(Error);
    });

    it("has accessible message", () => {
      const error = new GitHubError("AUTH_FAILED", "bad token");
      expect(error.message).toBe("bad token");
    });
  });

  describe("SyncError", () => {
    it('prepends "SYNC." to the given code', () => {
      const error = new SyncError("CONFLICT", "merge conflict");
      expect(error.code).toBe("SYNC.CONFLICT");
    });

    it("is instanceof BaseDomainError and Error", () => {
      const error = new SyncError("TIMEOUT", "sync timed out");
      expect(error).toBeInstanceOf(BaseDomainError);
      expect(error).toBeInstanceOf(Error);
    });

    it("has accessible message", () => {
      const error = new SyncError("STALE", "stale data");
      expect(error.message).toBe("stale data");
    });
  });
});
