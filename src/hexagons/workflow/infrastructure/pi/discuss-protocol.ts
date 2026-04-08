import { loadResource } from "@resources";

export interface DiscussProtocolParams {
  sliceId: string;
  sliceLabel: string;
  sliceTitle: string;
  sliceDescription: string;
  milestoneLabel: string;
  milestoneId: string;
  autonomyMode: string;
  requirementsContent: string;
  slicesContext: string;
  nextStep: string;
}

const template = loadResource("protocols/discuss.md");

function render(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

export function buildDiscussProtocolMessage(params: DiscussProtocolParams): string {
  const requirementsSection = params.requirementsContent
    ? `## REQUIREMENTS.md\n\n${params.requirementsContent}`
    : "";

  const slicesSection = params.slicesContext
    ? `## Milestone Slices\n\n${params.slicesContext}`
    : "";

  return render(template, {
    ...params,
    requirementsSection,
    slicesSection,
    nextStep: params.nextStep,
  });
}
