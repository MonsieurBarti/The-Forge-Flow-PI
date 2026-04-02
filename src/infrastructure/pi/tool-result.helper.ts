import type { AgentToolResult } from "@mariozechner/pi-coding-agent";

export const textResult = (text: string): AgentToolResult<undefined> => ({
  content: [{ type: "text", text }],
  details: undefined,
});
