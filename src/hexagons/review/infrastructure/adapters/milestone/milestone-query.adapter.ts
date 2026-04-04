import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MilestoneRepositoryPort } from "@hexagons/milestone/domain/ports/milestone-repository.port";
import type { SliceRepositoryPort } from "@hexagons/slice/domain/ports/slice-repository.port";
import { err, ok, type Result } from "@kernel";
import { MilestoneQueryError } from "../../../domain/errors/milestone-query.error";
import {
  MilestoneQueryPort,
  type MilestoneSliceStatus,
} from "../../../domain/ports/milestone-query.port";

export class MilestoneQueryAdapter extends MilestoneQueryPort {
  constructor(
    private readonly sliceRepo: SliceRepositoryPort,
    private readonly milestoneRepo: MilestoneRepositoryPort,
    private readonly projectRoot: string,
  ) {
    super();
  }

  async getSliceStatuses(
    milestoneId: string,
  ): Promise<Result<MilestoneSliceStatus[], MilestoneQueryError>> {
    const result = await this.sliceRepo.findByMilestoneId(milestoneId);
    if (!result.ok) return err(MilestoneQueryError.queryFailed(milestoneId, result.error));
    return ok(
      result.data.map((slice) => ({
        sliceId: slice.id,
        sliceLabel: slice.label,
        status: slice.status,
      })),
    );
  }

  async getMilestoneStatus(milestoneId: string): Promise<Result<string, MilestoneQueryError>> {
    const result = await this.milestoneRepo.findById(milestoneId);
    if (!result.ok) return err(MilestoneQueryError.queryFailed(milestoneId, result.error));
    if (result.data === null) return err(MilestoneQueryError.notFound(milestoneId));
    return ok(result.data.status);
  }

  async getRequirementsContent(
    milestoneLabel: string,
  ): Promise<Result<string, MilestoneQueryError>> {
    try {
      const filePath = join(
        this.projectRoot,
        ".tff",
        "milestones",
        milestoneLabel,
        "REQUIREMENTS.md",
      );
      const content = readFileSync(filePath, "utf-8");
      return ok(content);
    } catch (e) {
      return err(MilestoneQueryError.queryFailed(milestoneLabel, e));
    }
  }
}
