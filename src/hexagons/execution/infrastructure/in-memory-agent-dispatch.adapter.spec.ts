import { err, ok } from "@kernel";
import { AgentResultBuilder } from "@kernel/agents";
import type { AgentDispatchError } from "../domain/errors/agent-dispatch.error";
import { runContractTests, type TestConfigurator } from "./agent-dispatch.contract.spec";
import { InMemoryAgentDispatchAdapter } from "./in-memory-agent-dispatch.adapter";

const createTestConfigurator = (adapter: InMemoryAgentDispatchAdapter): TestConfigurator => ({
  givenSuccess(taskId: string) {
    adapter.givenResult(taskId, ok(new AgentResultBuilder().withTaskId(taskId).build()));
  },
  givenFailure(taskId: string, error: AgentDispatchError) {
    adapter.givenResult(taskId, err(error));
  },
  givenDelayed(taskId: string, delayMs: number) {
    adapter.givenDelayedResult(
      taskId,
      ok(new AgentResultBuilder().withTaskId(taskId).build()),
      delayMs,
    );
  },
  reset() {
    adapter.reset();
  },
});

runContractTests("InMemoryAgentDispatchAdapter", () => {
  const adapter = new InMemoryAgentDispatchAdapter();
  return { adapter, configurator: createTestConfigurator(adapter) };
});
