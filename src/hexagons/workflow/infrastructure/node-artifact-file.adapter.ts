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
  private readonly resolveActiveTffDir?: (sliceId?: string) => Promise<string>;

  constructor(projectRoot: string, resolveActiveTffDir?: (sliceId?: string) => Promise<string>) {
    super();
    this.projectRoot = resolve(projectRoot);
    this.basePath = resolve(projectRoot, ".tff", "milestones");
    this.resolveActiveTffDir = resolveActiveTffDir;
  }

  private async resolvePath(
    milestoneLabel: string | null,
    sliceLabel: string,
    artifactType: ArtifactType,
    kind: SliceKind = "milestone",
    sliceId?: string,
  ): Promise<string> {
    // Resolve the .tff root — worktree if available, else project root
    let tffRoot: string;
    if (sliceId && this.resolveActiveTffDir) {
      tffRoot = await this.resolveActiveTffDir(sliceId);
    } else {
      tffRoot = resolve(this.projectRoot, ".tff");
    }

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
    const milestonesBase = resolve(tffRoot, "milestones");
    const target = resolve(
      milestonesBase,
      milestoneLabel,
      "slices",
      sliceLabel,
      ARTIFACT_FILENAMES[artifactType],
    );
    if (!target.startsWith(milestonesBase)) {
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
    sliceId?: string,
  ): Promise<Result<string, FileIOError>> {
    const path = await this.resolvePath(milestoneLabel, sliceLabel, artifactType, kind, sliceId);
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
    sliceId?: string,
  ): Promise<Result<string | null, FileIOError>> {
    const path = await this.resolvePath(milestoneLabel, sliceLabel, artifactType, kind, sliceId);
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
