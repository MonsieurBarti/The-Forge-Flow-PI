import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type Result } from "@kernel";
import type { LoggerPort } from "@kernel/ports";
import type { GitPort } from "@kernel/ports/git.port";
import { DocWriterError } from "../domain/errors/doc-writer.error";
import type { DocType, DocWriterPort } from "../domain/ports/doc-writer.port";

export interface MapCodebaseInput {
  tffDir: string;
  workingDirectory: string;
  mode: "full" | "incremental";
  milestoneLabel?: string;
  baseBranch?: string;
  headBranch?: string;
}

export interface MapCodebaseOutput {
  updatedDocs: string[];
  skippedDocs: string[];
  totalAgentsDispatched: number;
}

const DOC_FILE_MAP: Record<DocType, string> = {
  architecture: "ARCHITECTURE.md",
  conventions: "CONVENTIONS.md",
  stack: "STACK.md",
  concerns: "CONCERNS.md",
};

const ALL_DOC_TYPES: DocType[] = ["architecture", "conventions", "stack", "concerns"];

const INCREMENTAL_PATTERNS: Record<DocType, RegExp[]> = {
  architecture: [
    /src\/hexagons\/[^/]+\/index\.ts/,
    /src\/hexagons\/[^/]+\/domain\//,
    /src\/kernel\//,
  ],
  conventions: [/biome\.json/, /tsconfig\.json/, /\.schemas\.ts/, /\.spec\.ts/],
  stack: [/package\.json/, /tsconfig\.json/, /vitest\.config/],
  concerns: [/TODO|FIXME/, /stub/, /Not implemented/, /\.spec\.ts/],
};

export class MapCodebaseUseCase {
  constructor(
    private readonly docWriter: DocWriterPort,
    private readonly gitPort: GitPort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(input: MapCodebaseInput): Promise<Result<MapCodebaseOutput, DocWriterError>> {
    const docsDir = join(input.tffDir, "docs");

    if (input.mode === "full") {
      return this.executeFull(input.workingDirectory, docsDir);
    }
    return this.executeIncremental(input, docsDir);
  }

  private async executeFull(
    workingDirectory: string,
    docsDir: string,
  ): Promise<Result<MapCodebaseOutput, DocWriterError>> {
    const updatedDocs: string[] = [];
    const results = await Promise.allSettled(
      ALL_DOC_TYPES.map((docType) => this.docWriter.generateDoc({ docType, workingDirectory })),
    );

    for (let i = 0; i < ALL_DOC_TYPES.length; i++) {
      const docType = ALL_DOC_TYPES[i];
      const result = results[i];
      if (result.status === "fulfilled" && result.value.ok) {
        writeFileSync(join(docsDir, DOC_FILE_MAP[docType]), result.value.data);
        updatedDocs.push(DOC_FILE_MAP[docType]);
      } else {
        const reason =
          result.status === "rejected"
            ? String(result.reason)
            : !result.value.ok
              ? result.value.error.message
              : "unknown";
        this.logger.warn(`map-codebase: failed to generate ${docType}`, { reason });
      }
    }

    return ok({
      updatedDocs,
      skippedDocs: [],
      totalAgentsDispatched: ALL_DOC_TYPES.length,
    });
  }

  private async executeIncremental(
    input: MapCodebaseInput,
    docsDir: string,
  ): Promise<Result<MapCodebaseOutput, DocWriterError>> {
    if (!input.baseBranch) {
      return err(
        DocWriterError.dispatchFailed("incremental", "baseBranch required for incremental mode"),
      );
    }

    const diffResult = await this.gitPort.diffAgainst(input.baseBranch, input.workingDirectory);
    if (!diffResult.ok) {
      return err(DocWriterError.dispatchFailed("incremental", diffResult.error));
    }

    const changedFiles = diffResult.data
      .split("\n")
      .filter((line) => line.startsWith("diff --git"))
      .map((line) => line.replace(/^diff --git a\/(.+?) b\/.*$/, "$1"));

    const affectedTypes = this.classifyChanges(changedFiles);

    if (affectedTypes.length === 0) {
      return ok({
        updatedDocs: [],
        skippedDocs: Object.values(DOC_FILE_MAP),
        totalAgentsDispatched: 0,
      });
    }

    const updatedDocs: string[] = [];
    const skippedDocs: string[] = [];

    const results = await Promise.allSettled(
      affectedTypes.map(async (docType) => {
        const existingPath = join(docsDir, DOC_FILE_MAP[docType]);
        let existingContent: string | undefined;
        try {
          existingContent = readFileSync(existingPath, "utf-8");
        } catch {
          // File doesn't exist — full generation
        }
        return {
          docType,
          result: await this.docWriter.generateDoc({
            docType,
            workingDirectory: input.workingDirectory,
            existingContent,
            diffContent: diffResult.data,
          }),
        };
      }),
    );

    for (const settled of results) {
      if (settled.status === "fulfilled" && settled.value.result.ok) {
        const { docType } = settled.value;
        writeFileSync(join(docsDir, DOC_FILE_MAP[docType]), settled.value.result.data);
        updatedDocs.push(DOC_FILE_MAP[docType]);
      }
    }

    for (const docType of ALL_DOC_TYPES) {
      if (!affectedTypes.includes(docType)) {
        skippedDocs.push(DOC_FILE_MAP[docType]);
      }
    }

    return ok({
      updatedDocs,
      skippedDocs,
      totalAgentsDispatched: affectedTypes.length,
    });
  }

  private classifyChanges(changedFiles: string[]): DocType[] {
    const affected = new Set<DocType>();
    for (const file of changedFiles) {
      for (const [docType, patterns] of Object.entries(INCREMENTAL_PATTERNS)) {
        if (patterns.some((p) => p.test(file))) {
          affected.add(docType as DocType);
        }
      }
    }
    return [...affected];
  }
}
