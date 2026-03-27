import type { Result } from "@kernel";
import { z } from "zod";
import type { FileIOError } from "../errors/file-io.error";

export const ArtifactTypeSchema = z.enum(["spec", "plan", "research", "checkpoint"]);
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

export const ARTIFACT_FILENAMES: Record<ArtifactType, string> = {
  spec: "SPEC.md",
  plan: "PLAN.md",
  research: "RESEARCH.md",
  checkpoint: "CHECKPOINT.md",
};

export abstract class ArtifactFilePort {
  abstract write(
    milestoneLabel: string,
    sliceLabel: string,
    artifactType: ArtifactType,
    content: string,
  ): Promise<Result<string, FileIOError>>;

  abstract read(
    milestoneLabel: string,
    sliceLabel: string,
    artifactType: ArtifactType,
  ): Promise<Result<string | null, FileIOError>>;
}
