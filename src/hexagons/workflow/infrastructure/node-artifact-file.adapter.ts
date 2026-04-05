import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { SliceKind } from "@hexagons/slice";
import { err, ok, type Result } from "@kernel";
import { FileIOError } from "../domain/errors/file-io.error";
import {
  ARTIFACT_FILENAMES,
  ArtifactFilePort,
  type ArtifactType,
} from "../domain/ports/artifact-file.port";

export class NodeArtifactFileAdapter extends ArtifactFilePort {
  private readonly projectRoot: string;
  private readonly basePath: string;

  constructor(projectRoot: string) {
    super();
    this.projectRoot = resolve(projectRoot);
    this.basePath = resolve(projectRoot, ".tff", "milestones");
  }

  private resolvePath(
    milestoneLabel: string | null,
    sliceLabel: string,
    artifactType: ArtifactType,
    kind: SliceKind = "milestone",
  ): string {
    const tffRoot = resolve(this.projectRoot, ".tff");

    if (kind === "quick") {
      const target = resolve(tffRoot, "quick", sliceLabel, ARTIFACT_FILENAMES[artifactType]);
      if (!target.startsWith(tffRoot)) {
        throw new FileIOError("Path traversal detected: resolved path escapes base directory");
      }
      return target;
    }
    if (kind === "debug") {
      const target = resolve(tffRoot, "debug", sliceLabel, ARTIFACT_FILENAMES[artifactType]);
      if (!target.startsWith(tffRoot)) {
        throw new FileIOError("Path traversal detected: resolved path escapes base directory");
      }
      return target;
    }

    // milestone (default)
    if (milestoneLabel === null) {
      throw new FileIOError("milestoneLabel is required for milestone kind");
    }
    const target = resolve(
      this.basePath,
      milestoneLabel,
      "slices",
      sliceLabel,
      ARTIFACT_FILENAMES[artifactType],
    );
    if (!target.startsWith(this.basePath)) {
      throw new FileIOError("Path traversal detected: resolved path escapes base directory");
    }
    return target;
  }

  async write(
    milestoneLabel: string | null,
    sliceLabel: string,
    artifactType: ArtifactType,
    content: string,
    kind?: SliceKind,
  ): Promise<Result<string, FileIOError>> {
    const path = this.resolvePath(milestoneLabel, sliceLabel, artifactType, kind);
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf-8");
      return ok(path);
    } catch (cause) {
      return err(new FileIOError(`Failed to write ${path}`, cause));
    }
  }

  async read(
    milestoneLabel: string | null,
    sliceLabel: string,
    artifactType: ArtifactType,
    kind?: SliceKind,
  ): Promise<Result<string | null, FileIOError>> {
    const path = this.resolvePath(milestoneLabel, sliceLabel, artifactType, kind);
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
