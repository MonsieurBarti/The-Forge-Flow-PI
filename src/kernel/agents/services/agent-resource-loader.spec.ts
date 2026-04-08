import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentResourceLoader } from "./agent-resource-loader";

const TEST_DIR = join(tmpdir(), "tff-agent-loader-test");

function writeAgent(name: string, content: string): void {
  writeFileSync(join(TEST_DIR, "agents", name), content, "utf-8");
}

function writePrompt(name: string): void {
  writeFileSync(join(TEST_DIR, name), "prompt content", "utf-8");
}

const VALID_AGENT = `---
type: tff-fixer
displayName: Fixer
purpose: Fix bugs
scope: task
freshReviewerRule: none
modelProfile: budget
skills:
  - name: standard
    prompt: prompts/standard.md
    strategy: standard
requiredTools: [Read, Bash]
capabilities: [fix]
---

You are a fixer.`;

describe("AgentResourceLoader", () => {
  const loader = new AgentResourceLoader();

  beforeEach(() => {
    mkdirSync(join(TEST_DIR, "agents"), { recursive: true });
    mkdirSync(join(TEST_DIR, "prompts"), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  it("loads a valid agent file", () => {
    writeAgent("fixer.agent.md", VALID_AGENT);
    writePrompt("prompts/standard.md");
    const result = loader.loadAll(TEST_DIR);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.size).toBe(1);
      const card = result.data.get("tff-fixer");
      expect(card?.identity).toBe("You are a fixer.");
      expect(card?.description).toBe("Fix bugs");
      expect(card?.defaultModelProfile).toBe("budget");
    }
  });

  it("returns Err for malformed YAML", () => {
    writeAgent("bad.agent.md", "---\n: invalid yaml [[[");
    const result = loader.loadAll(TEST_DIR);
    expect(result.ok).toBe(false);
  });

  it("returns Err when prompt file does not exist", () => {
    writeAgent("fixer.agent.md", VALID_AGENT);
    // Do NOT create the prompt file
    const result = loader.loadAll(TEST_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toMatch(/PROMPT_NOT_FOUND|MULTIPLE/);
    }
  });

  it("returns Err with multiple causes for multiple invalid files", () => {
    writeAgent("a.agent.md", "---\n: bad");
    writeAgent("b.agent.md", "---\n: also bad");
    const result = loader.loadAll(TEST_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AGENT.MULTIPLE_LOAD_ERRORS");
    }
  });

  it("returns Err for duplicate agent types", () => {
    writeAgent("fixer1.agent.md", VALID_AGENT);
    writeAgent("fixer2.agent.md", VALID_AGENT);
    writePrompt("prompts/standard.md");
    const result = loader.loadAll(TEST_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("duplicate");
    }
  });

  it("returns Err when no agent files exist", () => {
    const result = loader.loadAll(TEST_DIR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AGENT.NO_AGENT_FILES");
    }
  });

  it("maps modelProfile to defaultModelProfile", () => {
    writeAgent("fixer.agent.md", VALID_AGENT);
    writePrompt("prompts/standard.md");
    const result = loader.loadAll(TEST_DIR);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.get("tff-fixer")?.defaultModelProfile).toBe("budget");
    }
  });

  it("sets description equal to purpose", () => {
    writeAgent("fixer.agent.md", VALID_AGENT);
    writePrompt("prompts/standard.md");
    const result = loader.loadAll(TEST_DIR);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.get("tff-fixer")?.description).toBe("Fix bugs");
    }
  });
});
