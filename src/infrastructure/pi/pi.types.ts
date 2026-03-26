/**
 * Thin type aliases for PI SDK types.
 *
 * These decouple TFF hexagons from the PI SDK's exact type surface.
 * When the PI SDK is installed, replace placeholders with real imports.
 */

/** Content block in a tool result */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "object"; data: unknown };

/** Result returned by a tool execution */
export interface AgentToolResult<TDetails = unknown> {
  content: ContentBlock[];
  details?: TDetails;
}

/** Context passed to tool execute and command handlers */
export interface ExtensionContext {
  cwd: string;
  isIdle(): boolean;
  abort(): void;
}

/** Command handler context (extends ExtensionContext) */
export interface ExtensionCommandContext extends ExtensionContext {
  sendUserMessage(content: string): void;
}

/** Command registration options */
export interface RegisterCommandOptions {
  description?: string;
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

/** Tool definition compatible with PI SDK's ToolDefinition */
export interface ToolDefinition<TDetails = unknown> {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: Record<string, unknown>;
  execute(
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<TDetails>>;
}

/** Extension API surface — subset we use */
export interface ExtensionAPI {
  registerTool(tool: ToolDefinition): void;
  registerCommand(name: string, options: RegisterCommandOptions): void;
}
