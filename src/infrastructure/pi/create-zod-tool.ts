import type { z } from "zod";
import { toJSONSchema } from "zod";
import type { AgentToolResult, ExtensionContext, ToolDefinition } from "./pi.types";

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
  ) => Promise<AgentToolResult>;
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
    parameters: Object.assign({}, jsonSchema),
    async execute(_toolCallId, rawParams, signal, _onUpdate, ctx) {
      const parsed = config.schema.safeParse(rawParams);
      if (!parsed.success) {
        return {
          content: [
            {
              type: "text",
              text: `Validation error: ${parsed.error.message}`,
            },
          ],
        };
      }
      return config.execute(parsed.data, signal ?? new AbortController().signal, ctx);
    },
  };
}
