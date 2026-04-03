import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createZodTool } from "./create-zod-tool";
import { createMockExtensionContext } from "./testing";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getProps(params: Record<string, unknown>): Record<string, unknown> {
  const props = params.properties;
  if (!isRecord(props)) throw new Error("Expected properties to be an object");
  return props;
}

describe("createZodTool", () => {
  const schema = z.object({
    name: z.string(),
    count: z.number(),
    active: z.boolean(),
    status: z.enum(["open", "closed"]),
    tags: z.array(z.string()),
    desc: z.string().optional(),
    priority: z.number().default(0),
  });

  const makeTool = () =>
    createZodTool({
      name: "test_tool",
      label: "Test Tool",
      description: "A test tool",
      schema,
      execute: async (params) => ({
        content: [{ type: "text", text: JSON.stringify(params) }],
        details: undefined,
      }),
    });

  describe("JSON Schema conversion (AC4)", () => {
    it("produces valid JSON Schema 7 for z.object", () => {
      const tool = makeTool();
      expect(tool.parameters.$schema).toBe("http://json-schema.org/draft-07/schema#");
      expect(tool.parameters.type).toBe("object");
    });

    it("converts z.string to { type: 'string' }", () => {
      const props = getProps(makeTool().parameters);
      expect(props.name).toEqual({ type: "string" });
    });

    it("converts z.number to { type: 'number' }", () => {
      const props = getProps(makeTool().parameters);
      expect(props.count).toEqual({ type: "number" });
    });

    it("converts z.boolean to { type: 'boolean' }", () => {
      const props = getProps(makeTool().parameters);
      expect(props.active).toEqual({ type: "boolean" });
    });

    it("converts z.enum to { type: 'string', enum: [...] }", () => {
      const props = getProps(makeTool().parameters);
      expect(props.status).toEqual({ type: "string", enum: ["open", "closed"] });
    });

    it("converts z.array(z.string()) to { type: 'array', items: { type: 'string' } }", () => {
      const props = getProps(makeTool().parameters);
      expect(props.tags).toEqual({ type: "array", items: { type: "string" } });
    });

    it("z.optional removes field from required", () => {
      const tool = makeTool();
      const required = tool.parameters.required;
      expect(Array.isArray(required) ? required : []).not.toContain("desc");
    });

    it("z.default includes default value in schema", () => {
      const props = getProps(makeTool().parameters);
      const priority = props.priority;
      expect(isRecord(priority) ? priority.default : undefined).toBe(0);
    });
  });

  describe("safeParse validation (AC5)", () => {
    it("passes valid input through to execute", async () => {
      const tool = makeTool();
      const result = await tool.execute(
        "call-1",
        { name: "test", count: 1, active: true, status: "open", tags: ["a"] },
        undefined,
        undefined,
        createMockExtensionContext(),
      );
      const text = result.content[0];
      expect(text.type).toBe("text");
      if (text.type === "text") {
        const parsed = JSON.parse(text.text);
        expect(parsed.name).toBe("test");
        expect(parsed.priority).toBe(0);
      }
    });

    it("returns validation error for invalid input (not exception)", async () => {
      const tool = makeTool();
      const result = await tool.execute(
        "call-2",
        { name: 123, count: "not-a-number" },
        undefined,
        undefined,
        createMockExtensionContext(),
      );
      expect(result.content[0].type).toBe("text");
      if (result.content[0].type === "text") {
        expect(result.content[0].text).toContain("Validation error");
      }
    });
  });
});
