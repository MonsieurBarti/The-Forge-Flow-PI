import type { TSchema } from "@mariozechner/pi-ai";
import type { AgentToolResult, ExtensionContext, ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { z } from "zod";
import { toJSONSchema } from "zod";

export interface ZodToolConfig<T extends z.ZodObject<z.ZodRawShape>> {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  schema: T;
  execute: (
    params: z.infer<T>,
    signal: AbortSignal,
    ctx: ExtensionContext,
  ) => Promise<AgentToolResult<undefined>>;
}

export function createZodTool<T extends z.ZodObject<z.ZodRawShape>>(
  config: ZodToolConfig<T>,
): ToolDefinition {
  const jsonSchema = toJSONSchema(config.schema, {
    target: "draft-07",
    unrepresentable: "any",
  });

  return {
    name: config.name,
    label: config.label,
    description: config.description,
    promptSnippet: config.promptSnippet,
    promptGuidelines: config.promptGuidelines,
    parameters: jsonSchema as unknown as TSchema,
    async execute(_toolCallId, rawParams, signal, _onUpdate, ctx) {
      const parsed = config.schema.safeParse(rawParams);
      if (!parsed.success) {
        return {
          content: [{ type: "text" as const, text: `Validation error: ${parsed.error.message}` }],
          details: undefined,
        };
      }
      return config.execute(parsed.data, signal ?? new AbortController().signal, ctx);
    },
  };
}
