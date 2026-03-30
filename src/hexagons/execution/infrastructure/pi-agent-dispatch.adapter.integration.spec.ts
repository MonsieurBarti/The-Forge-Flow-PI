import {
  type Api,
  fauxAssistantMessage,
  type Model,
  registerFauxProvider,
} from "@mariozechner/pi-ai";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import { afterEach, describe } from "vitest";
import type { AgentDispatchError } from "../domain/errors/agent-dispatch.error";
import { runContractTests, type TestConfigurator } from "./agent-dispatch.contract.spec";
import { PiAgentDispatchAdapter } from "./pi-agent-dispatch.adapter";

const MODEL_ID = "test-model";
const COST_CONFIG = {
  input: 0.001,
  output: 0.002,
  cacheRead: 0,
  cacheWrite: 0,
};

interface FauxTestContext {
  faux: ReturnType<typeof registerFauxProvider>;
  model: Model<Api>;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
}

function createFauxContext(): FauxTestContext {
  const faux = registerFauxProvider({
    models: [{ id: MODEL_ID, cost: COST_CONFIG }],
  });
  const model = faux.getModel();
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey("faux", "fake-key");
  const modelRegistry = ModelRegistry.inMemory(authStorage);
  return { faux, model, authStorage, modelRegistry };
}

function createAdapter(ctx: FauxTestContext): PiAgentDispatchAdapter {
  return new PiAgentDispatchAdapter({
    resolveModel: () => ctx.model,
    authStorage: ctx.authStorage,
    modelRegistry: ctx.modelRegistry,
  });
}

const VALID_STATUS_REPORT_RESPONSE = `Task completed.

<!-- TFF_STATUS_REPORT -->
{
  "status": "DONE",
  "concerns": [],
  "selfReview": {
    "dimensions": [
      { "dimension": "completeness", "passed": true },
      { "dimension": "quality", "passed": true },
      { "dimension": "discipline", "passed": true },
      { "dimension": "verification", "passed": true }
    ],
    "overallConfidence": "high"
  }
}
<!-- /TFF_STATUS_REPORT -->`;

const createTestConfigurator = (ctx: FauxTestContext): TestConfigurator => ({
  givenSuccess(_taskId: string) {
    ctx.faux.appendResponses([fauxAssistantMessage(VALID_STATUS_REPORT_RESPONSE)]);
  },
  givenFailure(_taskId: string, _error: AgentDispatchError) {
    ctx.faux.appendResponses([
      fauxAssistantMessage("Failed", {
        stopReason: "error",
        errorMessage: "boom",
      }),
    ]);
  },
  givenDelayed(_taskId: string, _delayMs: number) {
    // Faux provider responds instantly; delay cannot be simulated.
    // Abort-related contract tests are skipped below.
    ctx.faux.appendResponses([fauxAssistantMessage(VALID_STATUS_REPORT_RESPONSE)]);
  },
  reset() {
    ctx.faux.unregister();
    const newCtx = createFauxContext();
    ctx.faux = newCtx.faux;
    ctx.model = newCtx.model;
    ctx.authStorage = newCtx.authStorage;
    ctx.modelRegistry = newCtx.modelRegistry;
  },
});

/**
 * Run contract tests for PiAgentDispatchAdapter using the faux provider.
 *
 * NOTE: The faux provider responds instantly (no actual LLM latency), so
 * abort-related tests cannot observe the "running" state mid-flight.
 * Those 3 tests are skipped here and covered by InMemoryAgentDispatchAdapter.
 */
describe("PiAgentDispatchAdapter integration", () => {
  const ctx = createFauxContext();

  afterEach(() => {
    // Cleanup handled by configurator.reset() in beforeEach
  });

  // Faux provider responds instantly, so delay-dependent tests cannot observe
  // the "running" state mid-flight. These are skipped here and verified by
  // InMemoryAgentDispatchAdapter contract tests instead.
  const SKIP_DELAY_TESTS = [
    "aborts a running agent by taskId",
    "isRunning returns false after abort",
    "returns true while agent is dispatched",
  ];

  runContractTests(
    "PiAgentDispatchAdapter",
    () => {
      const adapter = createAdapter(ctx);
      return { adapter, configurator: createTestConfigurator(ctx) };
    },
    { skip: SKIP_DELAY_TESTS },
  );
});
