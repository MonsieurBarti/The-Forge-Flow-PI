import { BaseDomainError } from "@kernel";
import { describe, expect, it } from "vitest";
import { ProjectAlreadyExistsError } from "./project-already-exists.error";

describe("ProjectAlreadyExistsError", () => {
  it("extends BaseDomainError", () => {
    const error = new ProjectAlreadyExistsError("/workspace");
    expect(error).toBeInstanceOf(BaseDomainError);
  });

  it("has correct error code", () => {
    const error = new ProjectAlreadyExistsError("/workspace");
    expect(error.code).toBe("PROJECT.ALREADY_EXISTS");
  });

  it("includes project root in message", () => {
    const error = new ProjectAlreadyExistsError("/workspace");
    expect(error.message).toContain("/workspace/.tff/");
  });
});
