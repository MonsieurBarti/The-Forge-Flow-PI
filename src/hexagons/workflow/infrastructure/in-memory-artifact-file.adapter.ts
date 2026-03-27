import { ok, type Result } from "@kernel";
import type { FileIOError } from "../domain/errors/file-io.error";
import {
  ARTIFACT_FILENAMES,
  ArtifactFilePort,
  type ArtifactType,
} from "../domain/ports/artifact-file.port";

export class InMemoryArtifactFileAdapter extends ArtifactFilePort {
  private store = new Map<string, string>();

  private key(milestoneLabel: string, sliceLabel: string, artifactType: ArtifactType): string {
    return `${milestoneLabel}/${sliceLabel}/${artifactType}`;
  }

  async write(
    milestoneLabel: string,
    sliceLabel: string,
    artifactType: ArtifactType,
    content: string,
  ): Promise<Result<string, FileIOError>> {
    this.store.set(this.key(milestoneLabel, sliceLabel, artifactType), content);
    const path = `.tff/milestones/${milestoneLabel}/slices/${sliceLabel}/${ARTIFACT_FILENAMES[artifactType]}`;
    return ok(path);
  }

  async read(
    milestoneLabel: string,
    sliceLabel: string,
    artifactType: ArtifactType,
  ): Promise<Result<string | null, FileIOError>> {
    return ok(this.store.get(this.key(milestoneLabel, sliceLabel, artifactType)) ?? null);
  }

  reset(): void {
    this.store.clear();
  }
}
