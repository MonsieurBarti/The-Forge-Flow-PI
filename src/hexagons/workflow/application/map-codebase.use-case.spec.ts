import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok, type Result } from "@kernel";
import type { LoggerPort } from "@kernel/ports";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocWriterError } from "../domain/errors/doc-writer.error";
import { type DocType, DocWriterPort } from "../domain/ports/doc-writer.port";
import { MapCodebaseUseCase } from "./map-codebase.use-case";

class StubDocWriter extends DocWriterPort {
  calls: Array<{ docType: DocType; existingContent?: string; diffContent?: string }> = [];
  results = new Map<DocType, Result<string, DocWriterError>>();

  setResult(docType: DocType, result: Result<string, DocWriterError>): void {
    this.results.set(docType, result);
  }

  async generateDoc(params: {
    docType: DocType;
    workingDirectory: string;
    existingContent?: string;
    diffContent?: string;
  }): Promise<Result<string, DocWriterError>> {
    this.calls.push({
      docType: params.docType,
      existingContent: params.existingContent,
      diffContent: params.diffContent,
    });
    return this.results.get(params.docType) ?? ok(`# ${params.docType} doc content`);
  }
}

class StubGitPort {
  diffContent = "";
  async diffAgainst(): Promise<Result<string, Error>> {
    return ok(this.diffContent);
  }
}

const stubLogger: LoggerPort = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("MapCodebaseUseCase", () => {
  let docWriter: StubDocWriter;
  let gitPort: StubGitPort;
  let useCase: MapCodebaseUseCase;
  let tmpDir: string;
  let docsDir: string;

  beforeEach(() => {
    docWriter = new StubDocWriter();
    gitPort = new StubGitPort();
    useCase = new MapCodebaseUseCase(
      docWriter,
      gitPort as unknown as import("@kernel/ports/git.port").GitPort,
      stubLogger,
    );
    tmpDir = join(tmpdir(), `tff-map-test-${Date.now()}`);
    docsDir = join(tmpDir, "docs");
    mkdirSync(docsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("full mode", () => {
    it("dispatches 4 agents and writes 4 docs", async () => {
      const result = await useCase.execute({
        tffDir: tmpDir,
        workingDirectory: "/mock/project",
        mode: "full",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.updatedDocs).toHaveLength(4);
        expect(result.data.totalAgentsDispatched).toBe(4);
        expect(docWriter.calls).toHaveLength(4);
      }

      const arch = readFileSync(join(docsDir, "ARCHITECTURE.md"), "utf-8");
      expect(arch).toContain("architecture");
    });

    it("handles dispatch failure for one doc gracefully", async () => {
      docWriter.setResult("stack", err({ message: "dispatch failed" } as DocWriterError));

      const result = await useCase.execute({
        tffDir: tmpDir,
        workingDirectory: "/mock/project",
        mode: "full",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.updatedDocs).toHaveLength(3);
        expect(result.data.updatedDocs).not.toContain("STACK.md");
      }
    });
  });

  describe("incremental mode", () => {
    it("dispatches only affected doc types based on diff", async () => {
      gitPort.diffContent = "diff --git a/package.json b/package.json\n+new dep";

      const result = await useCase.execute({
        tffDir: tmpDir,
        workingDirectory: "/mock/project",
        mode: "incremental",
        baseBranch: "main",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.updatedDocs).toContain("STACK.md");
        expect(result.data.skippedDocs.length).toBeGreaterThan(0);
        expect(result.data.totalAgentsDispatched).toBeLessThan(4);
      }
    });

    it("skips all docs when no relevant changes", async () => {
      gitPort.diffContent = "diff --git a/README.md b/README.md\n+hello";

      const result = await useCase.execute({
        tffDir: tmpDir,
        workingDirectory: "/mock/project",
        mode: "incremental",
        baseBranch: "main",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.updatedDocs).toHaveLength(0);
        expect(result.data.skippedDocs).toHaveLength(4);
        expect(result.data.totalAgentsDispatched).toBe(0);
      }
    });

    it("dispatches architecture agent for new hexagon domain files", async () => {
      gitPort.diffContent =
        "diff --git a/src/hexagons/billing/domain/billing.aggregate.ts b/src/hexagons/billing/domain/billing.aggregate.ts\n+new";

      const result = await useCase.execute({
        tffDir: tmpDir,
        workingDirectory: "/mock/project",
        mode: "incremental",
        baseBranch: "main",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.updatedDocs).toContain("ARCHITECTURE.md");
      }
    });

    it("requires baseBranch for incremental mode", async () => {
      const result = await useCase.execute({
        tffDir: tmpDir,
        workingDirectory: "/mock/project",
        mode: "incremental",
      });

      expect(result.ok).toBe(false);
    });
  });
});
