import { readFileSync } from "node:fs";

export interface PlanProtocolParams {
  sliceId: string;
  sliceLabel: string;
  sliceTitle: string;
  sliceDescription: string;
  milestoneLabel: string;
  milestoneId: string;
  specContent: string;
  researchContent: string | null;
  autonomyMode: string;
  nextStep: string;
}

const template = readFileSync(new URL("./templates/protocols/plan.md", import.meta.url), "utf-8");

function render(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

export function buildPlanProtocolMessage(params: PlanProtocolParams): string {
  const researchSection = params.researchContent
    ? `## RESEARCH.md\n\n${params.researchContent}`
    : "";

  return render(template, {
    ...params,
    researchContent: params.researchContent ?? "",
    researchSection,
    nextStep: params.nextStep,
  });
}
