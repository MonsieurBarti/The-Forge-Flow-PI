import type { MilestoneRepositoryPort } from "@hexagons/milestone";
import type { ProjectRepositoryPort } from "@hexagons/project";
import type { SliceRepositoryPort } from "@hexagons/slice";
import type { Slice } from "@hexagons/slice/domain/slice.aggregate";
import type { SliceStatus } from "@hexagons/slice/domain/slice.schemas";
import { isErr, isOk, type Result } from "@kernel";

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

/**
 * Find a slice by identifier with fuzzy matching.
 * Tries: exact label -> exact ID -> suffix match (e.g., "S01" matches "M01-S01")
 */
export async function findSliceFuzzy(
  identifier: string,
  sliceRepo: SliceRepositoryPort,
  milestoneRepo?: MilestoneRepositoryPort,
  projectRepo?: ProjectRepositoryPort,
): Promise<Result<Slice | null, Error>> {
  // 1. Exact label match
  const byLabel = await sliceRepo.findByLabel(identifier);
  if (isErr(byLabel)) return byLabel;
  if (byLabel.data) return byLabel;

  // 2. Exact ID match
  const byId = await sliceRepo.findById(identifier);
  if (isErr(byId)) return byId;
  if (byId.data) return byId;

  // 3. Suffix match (e.g., "S01" -> "M01-S01")
  if (projectRepo && milestoneRepo) {
    const projectResult = await projectRepo.findSingleton();
    if (isOk(projectResult) && projectResult.data) {
      const msResult = await milestoneRepo.findByProjectId(projectResult.data.id);
      if (isOk(msResult)) {
        const active = msResult.data.find((m) => m.status === "in_progress");
        if (active) {
          const slicesResult = await sliceRepo.findByMilestoneId(active.id);
          if (isOk(slicesResult)) {
            const suffixMatch = slicesResult.data.find(
              (s) =>
                s.label.endsWith(`-${identifier}`) ||
                s.label.toLowerCase() === identifier.toLowerCase(),
            );
            if (suffixMatch) {
              return { ok: true as const, data: suffixMatch };
            }
          }
        }
      }
    }
  }

  return { ok: true as const, data: null };
}
