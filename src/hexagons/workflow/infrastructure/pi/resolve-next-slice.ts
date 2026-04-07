import type { MilestoneRepositoryPort } from "@hexagons/milestone";
import type { ProjectRepositoryPort } from "@hexagons/project";
import type { SliceRepositoryPort } from "@hexagons/slice";
import type { SliceStatus } from "@hexagons/slice/domain/slice.schemas";
import { isErr } from "@kernel";

export interface ResolveNextSliceResult {
  sliceLabel: string;
}

/**
 * Resolves the next actionable slice for a given phase by finding the active
 * milestone and the first slice matching the target status.
 */
export async function resolveNextSlice(
  targetStatus: SliceStatus,
  projectRepo: ProjectRepositoryPort,
  milestoneRepo: MilestoneRepositoryPort,
  sliceRepo: SliceRepositoryPort,
): Promise<ResolveNextSliceResult | string> {
  const projectResult = await projectRepo.findSingleton();
  if (isErr(projectResult) || !projectResult.data) {
    return "No TFF project found. Run /tff new to initialize.";
  }

  const msResult = await milestoneRepo.findByProjectId(projectResult.data.id);
  if (isErr(msResult)) {
    return "Failed to load milestones.";
  }

  const active = msResult.data.find((m) => m.status === "in_progress");
  if (!active) {
    return "No active milestone. Run /tff new-milestone to create one.";
  }

  const slicesResult = await sliceRepo.findByMilestoneId(active.id);
  if (isErr(slicesResult)) {
    return "Failed to load slices.";
  }

  const match = slicesResult.data.find((s) => s.status === targetStatus);
  if (!match) {
    return `No slice in "${targetStatus}" phase. Run /tff status to see current state.`;
  }

  return { sliceLabel: match.label };
}
