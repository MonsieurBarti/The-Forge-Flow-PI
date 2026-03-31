import { loadResource } from "@resources";

export interface DiscussProtocolParams {
  sliceId: string;
  sliceLabel: string;
  sliceTitle: string;
  sliceDescription: string;
  milestoneLabel: string;
  milestoneId: string;
  autonomyMode: string;
  nextStep: string;
}

const template = loadResource("protocols/discuss.md");

function render(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

export function buildDiscussProtocolMessage(params: DiscussProtocolParams): string {
  return render(template, {
    ...params,
    nextStep: params.nextStep,
  });
}
