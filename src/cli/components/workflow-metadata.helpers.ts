import type { SliceStatus } from "@hexagons/slice/domain/slice.schemas";

export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);

  if (totalMinutes < 60) return `${totalMinutes}m`;
  if (totalHours < 24) return `${totalHours}h ${totalMinutes % 60}m`;
  return `${totalDays}d ${totalHours % 24}h`;
}

export function renderMetadata(
  status: SliceStatus,
  durationMs: number,
  artifacts: {
    specPath: string | null;
    planPath: string | null;
    researchPath: string | null;
  },
): string {
  const spec = artifacts.specPath ? "SPEC.md ✓" : "SPEC.md …";
  const plan = artifacts.planPath ? "PLAN.md ✓" : "PLAN.md …";
  const research = artifacts.researchPath ? "RESEARCH.md ✓" : "RESEARCH.md …";

  return [
    `**Phase:** ${status} (${formatDuration(durationMs)})`,
    `**Artifacts:** ${spec}  ${plan}  ${research}`,
  ].join("\n");
}
