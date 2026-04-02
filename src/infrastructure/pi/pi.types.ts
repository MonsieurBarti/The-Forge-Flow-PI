/**
 * Re-export barrel for PI SDK types.
 *
 * Downstream consumers import from @infrastructure/pi — this barrel
 * resolves to real SDK types at compilation. No hand-written replicas.
 */

// Extension types from pi-coding-agent (originally from pi-agent-core)
export type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  RegisteredCommand,
  ToolDefinition,
} from "@mariozechner/pi-coding-agent";

// AI types from pi-ai
export type {
  Api,
  KnownProvider,
  Model,
  Provider,
  Usage,
} from "@mariozechner/pi-ai";

// Convenience alias — pi-coding-agent's registerCommand accepts this shape
export type RegisterCommandOptions = Omit<
  import("@mariozechner/pi-coding-agent").RegisteredCommand,
  "name" | "sourceInfo"
>;
