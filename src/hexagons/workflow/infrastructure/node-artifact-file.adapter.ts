import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { err, ok, type Result } from "@kernel";
import { FileIOError } from "../domain/errors/file-io.error";
import {
  ARTIFACT_FILENAMES,
  ArtifactFilePort,
  type ArtifactType,
} from "../domain/ports/artifact-file.port";

export class NodeArtifactFileAdapter extends ArtifactFilePort {
  constructor(private readonly projectRoot: string) {
    super();
  }

  private resolvePath(
    milestoneLabel: string,
    sliceLabel: string,
    artifactType: ArtifactType,
  ): string {
    return join(
      this.projectRoot,
      ".tff",
      "milestones",
      milestoneLabel,
      "slices",
      sliceLabel,
      ARTIFACT_FILENAMES[artifactType],
    );
  }

  async write(
    milestoneLabel: string,
    sliceLabel: string,
    artifactType: ArtifactType,
    content: string,
  ): Promise<Result<string, FileIOError>> {
    const path = this.resolvePath(milestoneLabel, sliceLabel, artifactType);
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf-8");
      return ok(path);
    } catch (cause) {
      return err(new FileIOError(`Failed to write ${path}`, cause));
    }
  }

  async read(
    milestoneLabel: string,
    sliceLabel: string,
    artifactType: ArtifactType,
  ): Promise<Result<string | null, FileIOError>> {
    const path = this.resolvePath(milestoneLabel, sliceLabel, artifactType);
    try {
      const content = await readFile(path, "utf-8");
      return ok(content);
    } catch (cause: unknown) {
      if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
        return ok(null);
      }
      return err(new FileIOError(`Failed to read ${path}`, cause));
    }
  }
}
