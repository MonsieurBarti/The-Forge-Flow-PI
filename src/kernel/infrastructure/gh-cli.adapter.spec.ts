import { describe, expect, it } from "vitest";
import { mapGhError, transformPrJson } from "./gh-cli.adapter";

describe("transformPrJson", () => {
  it("lowercases state and renames ref fields", () => {
    const raw = {
      number: 42,
      title: "S09: Ship command",
      url: "https://github.com/org/repo/pull/42",
      state: "OPEN",
      headRefName: "slice/M05-S09",
      baseRefName: "milestone/M05",
      createdAt: "2026-04-02T12:00:00Z",
    };
    const result = transformPrJson(raw);
    expect(result.state).toBe("open");
    expect(result.head).toBe("slice/M05-S09");
    expect(result.base).toBe("milestone/M05");
    expect(result.number).toBe(42);
  });
});

describe("mapGhError", () => {
  it("maps auth failure", () => {
    const error = mapGhError(new Error("exit 1"), "no authentication token found");
    expect(error.code).toBe("GITHUB.AUTH_FAILED");
  });
  it("maps already exists", () => {
    const error = mapGhError(new Error("exit 1"), "a pull request already exists");
    expect(error.code).toBe("GITHUB.ALREADY_EXISTS");
  });
  it("maps not found", () => {
    const error = mapGhError(new Error("exit 1"), "Could not resolve to a Repository");
    expect(error.code).toBe("GITHUB.NOT_FOUND");
  });
  it("maps network error", () => {
    const error = mapGhError(new Error("exit 1"), "failed to http request");
    expect(error.code).toBe("GITHUB.NETWORK_ERROR");
  });
  it("maps generic failure", () => {
    const error = mapGhError(new Error("exit 1"), "something unexpected");
    expect(error.code).toBe("GITHUB.COMMAND_FAILED");
  });
});
