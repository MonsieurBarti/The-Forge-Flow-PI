import { readFileSync } from "node:fs";

export interface ResearchProtocolParams {
  sliceId: string;
  sliceLabel: string;
  sliceTitle: string;
  sliceDescription: string;
  milestoneLabel: string;
  milestoneId: string;
  specContent: string;
  autonomyMode: string;
}

const template = readFileSync(new URL("./research-protocol.template.md", import.meta.url), "utf-8");

function render(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

export function buildResearchProtocolMessage(params: ResearchProtocolParams): string {
  const autonomyInstruction =
    params.autonomyMode === "plan-to-pr"
      ? `Invoke the next phase command automatically: \`/tff:plan ${params.sliceLabel}\`.`
      : `Suggest the next step to the user: "Next: \`/tff:plan ${params.sliceLabel}\`."`;

  return render(template, {
    ...params,
    autonomyInstruction,
  });
}
