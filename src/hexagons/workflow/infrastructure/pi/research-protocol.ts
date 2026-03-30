import { loadResource } from "@resources";

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

const template = loadResource("protocols/research.md");

function render(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

export function buildResearchProtocolMessage(params: ResearchProtocolParams): string {
  return render(template, {
    ...params,
    nextStep: params.nextStep,
  });
}
