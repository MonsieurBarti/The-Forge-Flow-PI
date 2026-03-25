import { describe, expect, it } from "vitest";
import { err, isErr, isOk, match, ok } from "./result";

describe("Result", () => {
  it("ok() creates success result", () => {
    const result = ok(42);
    expect(result).toEqual({ ok: true, data: 42 });
  });

  it("err() creates failure result", () => {
    const result = err("something went wrong");
    expect(result).toEqual({ ok: false, error: "something went wrong" });
  });

  it("isOk() narrows to success", () => {
    const success = ok("hello");
    const failure = err("oops");
    expect(isOk(success)).toBe(true);
    expect(isOk(failure)).toBe(false);
  });

  it("isErr() narrows to failure", () => {
    const success = ok("hello");
    const failure = err("oops");
    expect(isErr(failure)).toBe(true);
    expect(isErr(success)).toBe(false);
  });

  it("match() calls ok handler on success", () => {
    const result = ok(10);
    const output = match(result, {
      ok: (data: number) => `success: ${data}`,
      err: (error: string) => `failure: ${error}`,
    });
    expect(output).toBe("success: 10");
  });

  it("match() calls err handler on failure", () => {
    const result = err("broken");
    const output = match(result, {
      ok: (data: string) => `success: ${data}`,
      err: (error: string) => `failure: ${error}`,
    });
    expect(output).toBe("failure: broken");
  });
});
