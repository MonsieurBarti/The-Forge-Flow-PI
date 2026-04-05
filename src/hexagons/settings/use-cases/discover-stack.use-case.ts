import { ok, type Result } from "@kernel";
import type { SettingsFileError } from "../domain/errors/settings-file.error";
import type { SettingsFilePort } from "../domain/ports/settings-file.port";
import type { StackInfo } from "../domain/project-settings.schemas";

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export class DiscoverStackUseCase {
  constructor(private readonly filePort: SettingsFilePort) {}

  async execute(projectRoot: string): Promise<Result<StackInfo, SettingsFileError>> {
    const pkgResult = await this.filePort.readFile(`${projectRoot}/package.json`);
    if (!pkgResult.ok) return pkgResult;

    // No package.json → empty stack
    if (pkgResult.data === null) return ok({});

    let pkg: PackageJson;
    try {
      pkg = JSON.parse(pkgResult.data) as PackageJson;
    } catch {
      return ok({});
    }

    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    const framework = this.detectFramework(allDeps);
    const runtime = this.detectRuntime(allDeps);
    const packageManager = await this.detectPackageManager(projectRoot);
    const testRunner = await this.detectTestRunner(projectRoot);
    const linter = await this.detectLinter(projectRoot);
    const buildTool = await this.detectBuildTool(projectRoot);

    const info: StackInfo = {};
    if (framework) info.framework = framework;
    if (runtime) info.runtime = runtime;
    if (packageManager) info.packageManager = packageManager;
    if (testRunner) info.testRunner = testRunner;
    if (linter) info.linter = linter;
    if (buildTool) info.buildTool = buildTool;

    return ok(info);
  }

  private detectFramework(deps: Record<string, string>): string | undefined {
    if ("next" in deps) return "next";
    if ("react" in deps || "react-dom" in deps) return "react";
    if ("express" in deps) return "express";
    return undefined;
  }

  private detectRuntime(deps: Record<string, string>): string | undefined {
    if ("typescript" in deps) return "typescript";
    return "node";
  }

  private async detectPackageManager(root: string): Promise<string | undefined> {
    const checks: [string, string][] = [
      [`${root}/pnpm-lock.yaml`, "pnpm"],
      [`${root}/package-lock.json`, "npm"],
      [`${root}/yarn.lock`, "yarn"],
    ];
    for (const [path, name] of checks) {
      const r = await this.filePort.readFile(path);
      if (r.ok && r.data !== null) return name;
    }
    return undefined;
  }

  private async detectTestRunner(root: string): Promise<string | undefined> {
    const vitestFiles = [`${root}/vitest.config.ts`, `${root}/vitest.config.js`];
    for (const path of vitestFiles) {
      const r = await this.filePort.readFile(path);
      if (r.ok && r.data !== null) return "vitest";
    }
    const jestFiles = [`${root}/jest.config.ts`, `${root}/jest.config.js`];
    for (const path of jestFiles) {
      const r = await this.filePort.readFile(path);
      if (r.ok && r.data !== null) return "jest";
    }
    return undefined;
  }

  private async detectLinter(root: string): Promise<string | undefined> {
    const biomeFiles = [`${root}/biome.json`, `${root}/biome.jsonc`];
    for (const path of biomeFiles) {
      const r = await this.filePort.readFile(path);
      if (r.ok && r.data !== null) return "biome";
    }
    const eslintFiles = [`${root}/.eslintrc.json`, `${root}/.eslintrc.js`, `${root}/.eslintrc.yml`];
    for (const path of eslintFiles) {
      const r = await this.filePort.readFile(path);
      if (r.ok && r.data !== null) return "eslint";
    }
    return undefined;
  }

  private async detectBuildTool(root: string): Promise<string | undefined> {
    const r = await this.filePort.readFile(`${root}/tsconfig.json`);
    if (r.ok && r.data !== null) return "tsc";
    return undefined;
  }
}
