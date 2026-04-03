import type { SliceStatus } from "@hexagons/slice/domain/slice.schemas";

export const PHASE_ORDER: SliceStatus[] = [
  "discussing", "researching", "planning", "executing",
  "verifying", "reviewing", "completing", "closed",
];

export const PHASE_DISPLAY_NAMES: Record<SliceStatus, string> = {
  discussing: "discuss",
  researching: "research",
  planning: "plan",
  executing: "execute",
  verifying: "verify",
  reviewing: "review",
  completing: "ship",
  closed: "closed",
};

export function renderPipeline(currentStatus: SliceStatus): string {
  const currentIndex = PHASE_ORDER.indexOf(currentStatus);
  const parts = PHASE_ORDER.map((phase, i) => {
    const name = PHASE_DISPLAY_NAMES[phase];
    if (i < currentIndex) return `● ${name}`;
    if (i === currentIndex) return `**▶ ${name}**`;
    return `○ ${name}`;
  });
  return parts.join(" ── ");
}
