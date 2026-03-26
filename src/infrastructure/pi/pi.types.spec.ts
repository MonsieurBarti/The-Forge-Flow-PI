import { describe, expect, it } from "vitest";
import type {
  AgentToolResult,
  ContentBlock,
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "./pi.types";

describe("PI SDK type aliases", () => {
  it("ContentBlock text variant is structurally valid", () => {
    const block: ContentBlock = { type: "text", text: "hello" };
    expect(block.type).toBe("text");
  });

  it("AgentToolResult is structurally valid", () => {
    const result: AgentToolResult = {
      content: [{ type: "text", text: "ok" }],
    };
    expect(result.content).toHaveLength(1);
  });
});
