import { readFileSync } from "node:fs";

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

const template = readFileSync(
  new URL("./templates/protocols/discuss.md", import.meta.url),
  "utf-8",
);

function render(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

export function buildDiscussProtocolMessage(params: DiscussProtocolParams): string {
  return render(template, {
    ...params,
    nextStep: params.nextStep,
  });
}
