import type { AgentToolResult } from "./pi.types";

export const textResult = (text: string): AgentToolResult => ({
  content: [{ type: "text", text }],
});
