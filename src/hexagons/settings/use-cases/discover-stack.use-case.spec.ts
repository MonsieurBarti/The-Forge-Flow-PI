import { beforeEach, describe, expect, it } from "vitest";
import { InMemorySettingsFileAdapter } from "../infrastructure/in-memory-settings-file.adapter";
import { DiscoverStackUseCase } from "./discover-stack.use-case";

describe("DiscoverStackUseCase", () => {
  let adapter: InMemorySettingsFileAdapter;
  let sut: DiscoverStackUseCase;
  const root = "/project";

  beforeEach(() => {
    adapter = new InMemorySettingsFileAdapter();
    sut = new DiscoverStackUseCase(adapter);
  });

  it("detects Node/TS project from package.json with typescript dep and tsconfig", async () => {
    adapter.seed(
      `${root}/package.json`,
      JSON.stringify({ devDependencies: { typescript: "^5.0.0" } }),
    );
    adapter.seed(`${root}/tsconfig.json`, "{}");

    const result = await sut.execute(root);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.runtime).toBe("typescript");
    expect(result.data.buildTool).toBe("tsc");
  });

  it("detects pnpm from pnpm-lock.yaml", async () => {
    adapter.seed(`${root}/package.json`, JSON.stringify({ dependencies: {} }));
    adapter.seed(`${root}/pnpm-lock.yaml`, "lockfileVersion: 9");

    const result = await sut.execute(root);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.packageManager).toBe("pnpm");
  });

  it("detects vitest from vitest.config.ts", async () => {
    adapter.seed(`${root}/package.json`, JSON.stringify({ dependencies: {} }));
    adapter.seed(`${root}/vitest.config.ts`, "export default {}");

    const result = await sut.execute(root);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.testRunner).toBe("vitest");
  });

  it("detects biome from biome.json", async () => {
    adapter.seed(`${root}/package.json`, JSON.stringify({ dependencies: {} }));
    adapter.seed(`${root}/biome.json`, "{}");

    const result = await sut.execute(root);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.linter).toBe("biome");
  });

  it("detects React framework from package.json dependencies", async () => {
    adapter.seed(
      `${root}/package.json`,
      JSON.stringify({ dependencies: { react: "^18.0.0", "react-dom": "^18.0.0" } }),
    );

    const result = await sut.execute(root);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.framework).toBe("react");
  });

  it("detects Next.js framework (takes priority over react)", async () => {
    adapter.seed(
      `${root}/package.json`,
      JSON.stringify({
        dependencies: { next: "^14.0.0", react: "^18.0.0", "react-dom": "^18.0.0" },
      }),
    );

    const result = await sut.execute(root);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.framework).toBe("next");
  });

  it("returns empty StackInfo for empty directory (no package.json)", async () => {
    const result = await sut.execute(root);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({});
  });

  it("handles malformed package.json gracefully", async () => {
    adapter.seed(`${root}/package.json`, "not valid json {{{");

    const result = await sut.execute(root);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({});
  });

  it("detects npm from package-lock.json", async () => {
    adapter.seed(`${root}/package.json`, JSON.stringify({ dependencies: {} }));
    adapter.seed(`${root}/package-lock.json`, "{}");

    const result = await sut.execute(root);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.packageManager).toBe("npm");
  });

  it("detects yarn from yarn.lock", async () => {
    adapter.seed(`${root}/package.json`, JSON.stringify({ dependencies: {} }));
    adapter.seed(`${root}/yarn.lock`, "# yarn lockfile");

    const result = await sut.execute(root);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.packageManager).toBe("yarn");
  });

  it("detects jest from jest.config.ts", async () => {
    adapter.seed(`${root}/package.json`, JSON.stringify({ dependencies: {} }));
    adapter.seed(`${root}/jest.config.ts`, "export default {}");

    const result = await sut.execute(root);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.testRunner).toBe("jest");
  });

  it("detects eslint from .eslintrc.json", async () => {
    adapter.seed(`${root}/package.json`, JSON.stringify({ dependencies: {} }));
    adapter.seed(`${root}/.eslintrc.json`, "{}");

    const result = await sut.execute(root);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.linter).toBe("eslint");
  });

  it("detects express framework", async () => {
    adapter.seed(`${root}/package.json`, JSON.stringify({ dependencies: { express: "^4.0.0" } }));

    const result = await sut.execute(root);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.framework).toBe("express");
  });

  it("defaults runtime to node when typescript is not present", async () => {
    adapter.seed(`${root}/package.json`, JSON.stringify({ dependencies: { express: "^4.0.0" } }));

    const result = await sut.execute(root);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.runtime).toBe("node");
  });
});
