import { err, ok, type Result } from "@kernel";
import { type AgentStatusReport, AgentStatusReportSchema } from "../schemas/agent-status.schema";
import { AgentStatusParseError } from "../errors/agent-status-parse.error";

const OPEN_MARKER = "<!-- TFF_STATUS_REPORT -->";
const CLOSE_MARKER = "<!-- /TFF_STATUS_REPORT -->";

export function parseAgentStatusReport(
  rawOutput: string,
): Result<AgentStatusReport, AgentStatusParseError> {
  const openIdx = rawOutput.indexOf(OPEN_MARKER);
  const closeIdx = rawOutput.indexOf(CLOSE_MARKER);

  if (openIdx === -1 || closeIdx === -1 || closeIdx <= openIdx) {
    return err(
      new AgentStatusParseError("Status report markers not found in agent output", rawOutput),
    );
  }

  const jsonStr = rawOutput.slice(openIdx + OPEN_MARKER.length, closeIdx).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (cause) {
    return err(new AgentStatusParseError("Failed to parse status report JSON", rawOutput, cause));
  }

  const validated = AgentStatusReportSchema.safeParse(parsed);
  if (!validated.success) {
    return err(
      new AgentStatusParseError(
        `Status report validation failed: ${validated.error.message}`,
        rawOutput,
        validated.error,
      ),
    );
  }

  return ok(validated.data);
}
