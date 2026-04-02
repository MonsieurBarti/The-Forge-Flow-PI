import { join } from "node:path";
import { AgentRegistry, AgentResourceLoader, initializeAgentRegistry } from "@kernel/agents";

// Strip GIT_* environment variables so integration tests that spawn git
// subprocesses never leak into the host repository. Without this, a
// GIT_DIR or GIT_WORK_TREE inherited from the test runner (e.g. when
// running inside a git worktree) could cause `git -C <tmpdir>` to
// silently operate on the wrong repo.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("GIT_")) {
    delete process.env[key];
  }
}

// Initialize agent registry from resource files so that any test calling
// getAgentCard() or findAgentsByCapability() works without explicit setup.
// Individual test files (e.g. agent-registry.spec.ts) may reset and
// re-initialize with their own test data — that's fine.
const agentLoader = new AgentResourceLoader();
const agentResult = AgentRegistry.loadFromResources(
  agentLoader,
  join(import.meta.dirname, "resources"),
);
if (agentResult.ok) {
  initializeAgentRegistry(agentResult.data);
}
