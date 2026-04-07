import type { SliceKind } from "@hexagons/slice";
import { ok, type Result } from "@kernel";
import type { FileIOError } from "../domain/errors/file-io.error";
import {
  ARTIFACT_FILENAMES,
  ArtifactFilePort,
  type ArtifactType,
} from "../domain/ports/artifact-file.port";

export class InMemoryArtifactFileAdapter extends ArtifactFilePort {
  private store = new Map<string, string>();

  private key(
    milestoneLabel: string | null,
    sliceLabel: string,
    artifactType: ArtifactType,
    kind: SliceKind = "milestone",
  ): string {
    return `${kind}/${milestoneLabel ?? "_"}/${sliceLabel}/${artifactType}`;
  }

  private resolvePath(
    milestoneLabel: string | null,
    sliceLabel: string,
    artifactType: ArtifactType,
    kind: SliceKind = "milestone",
  ): string {
    if (kind === "quick") {
      return `.tff/quick/${sliceLabel}/${ARTIFACT_FILENAMES[artifactType]}`;
    }
    if (kind === "debug") {
      return `.tff/debug/${sliceLabel}/${ARTIFACT_FILENAMES[artifactType]}`;
    }
    return `.tff/milestones/${milestoneLabel}/slices/${sliceLabel}/${ARTIFACT_FILENAMES[artifactType]}`;
  }

  async write(
    milestoneLabel: string | null,
    sliceLabel: string,
    artifactType: ArtifactType,
    content: string,
    kind?: SliceKind,
    _sliceId?: string,
  ): Promise<Result<string, FileIOError>> {
    this.store.set(this.key(milestoneLabel, sliceLabel, artifactType, kind), content);
    return ok(this.resolvePath(milestoneLabel, sliceLabel, artifactType, kind));
  }

  async read(
    milestoneLabel: string | null,
    sliceLabel: string,
    artifactType: ArtifactType,
    kind?: SliceKind,
    _sliceId?: string,
  ): Promise<Result<string | null, FileIOError>> {
    return ok(this.store.get(this.key(milestoneLabel, sliceLabel, artifactType, kind)) ?? null);
  }

  reset(): void {
    this.store.clear();
  }
}
