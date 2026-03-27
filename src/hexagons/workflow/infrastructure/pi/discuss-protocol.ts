import { readFileSync } from "node:fs";

export interface DiscussProtocolParams {
  sliceId: string;
  sliceLabel: string;
  sliceTitle: string;
  sliceDescription: string;
  milestoneLabel: string;
  milestoneId: string;
  autonomyMode: string;
}

const template = readFileSync(new URL("./discuss-protocol.template.md", import.meta.url), "utf-8");

function render(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

export function buildDiscussProtocolMessage(params: DiscussProtocolParams): string {
  const autonomyInstruction =
    params.autonomyMode === "plan-to-pr"
      ? "Invoke the next phase command automatically."
      : "Suggest the next step: `/tff:research` (if F-lite/F-full) or `/tff:plan` (if S-tier or research skipped).";

  return render(template, {
    ...params,
    autonomyInstruction,
  });
}
