import type { SliceStatus } from "@hexagons/slice/domain/slice.schemas";

export const PHASE_ORDER: SliceStatus[] = [
  "discussing",
  "researching",
  "planning",
  "executing",
  "verifying",
  "reviewing",
  "completing",
  "closed",
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

export const NEXT_ACTION: Record<SliceStatus, { cmd: string; desc: string }> = {
  discussing: { cmd: "/tff research", desc: "Research the current slice" },
  researching: { cmd: "/tff plan", desc: "Plan the current slice" },
  planning: { cmd: "/tff execute", desc: "Execute the current slice" },
  executing: { cmd: "/tff verify", desc: "Verify acceptance criteria" },
  verifying: { cmd: "/tff ship", desc: "Ship the slice PR" },
  reviewing: { cmd: "/tff ship", desc: "Complete the review" },
  completing: { cmd: "/tff complete-milestone", desc: "Complete the milestone" },
  closed: { cmd: "/tff status", desc: "All slices closed" },
};
