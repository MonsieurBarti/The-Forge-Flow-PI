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
    return `${kind}:${milestoneLabel ?? ""}/${sliceLabel}/${artifactType}`;
  }

  async write(
    milestoneLabel: string | null,
    sliceLabel: string,
    artifactType: ArtifactType,
    content: string,
    kind?: SliceKind,
  ): Promise<Result<string, FileIOError>> {
    this.store.set(this.key(milestoneLabel, sliceLabel, artifactType, kind), content);
    let path: string;
    const resolvedKind = kind ?? "milestone";
    if (resolvedKind === "quick") {
      path = `.tff/quick/${sliceLabel}/${ARTIFACT_FILENAMES[artifactType]}`;
    } else if (resolvedKind === "debug") {
      path = `.tff/debug/${sliceLabel}/${ARTIFACT_FILENAMES[artifactType]}`;
    } else {
      path = `.tff/milestones/${milestoneLabel}/slices/${sliceLabel}/${ARTIFACT_FILENAMES[artifactType]}`;
    }
    return ok(path);
  }

  async read(
    milestoneLabel: string | null,
    sliceLabel: string,
    artifactType: ArtifactType,
    kind?: SliceKind,
  ): Promise<Result<string | null, FileIOError>> {
    return ok(this.store.get(this.key(milestoneLabel, sliceLabel, artifactType, kind)) ?? null);
  }

  reset(): void {
    this.store.clear();
  }
}
