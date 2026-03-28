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
  nextStep: string;
}

const template = readFileSync(
  new URL("./templates/protocols/research.md", import.meta.url),
  "utf-8",
);

function render(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

export function buildResearchProtocolMessage(params: ResearchProtocolParams): string {
  return render(template, {
    ...params,
    nextStep: params.nextStep,
  });
}
