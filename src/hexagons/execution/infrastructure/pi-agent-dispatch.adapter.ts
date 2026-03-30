import { err, ok, type Result } from "@kernel";
import type { AgentDispatchConfig, AgentResult } from "@kernel/agents";
import type { Api, KnownProvider, Model } from "@mariozechner/pi-ai";
import { getModels, getProviders } from "@mariozechner/pi-ai";
import {
  type AgentSession,
  type AuthStorage,
  bashTool,
  type codingTools,
  createAgentSession,
  editTool,
  findTool,
  grepTool,
  lsTool,
  type ModelRegistry,
  readTool,
  SessionManager,
  writeTool,
} from "@mariozechner/pi-coding-agent";
import { AgentDispatchError } from "../domain/errors/agent-dispatch.error";
import { AgentDispatchPort } from "../domain/ports/agent-dispatch.port";

/** Tool type matching CreateAgentSessionOptions["tools"] elements. */
type PiTool = (typeof codingTools)[number];

const TOOL_MAP: Record<string, PiTool> = {
  Read: readTool,
  Bash: bashTool,
  Edit: editTool,
  Write: writeTool,
  Grep: grepTool,
  Find: findTool,
  Ls: lsTool,
};

function resolveTools(toolNames: string[]): PiTool[] {
  return toolNames.flatMap((name) => {
    const tool = TOOL_MAP[name];
    return tool ? [tool] : [];
  });
}

function isKnownProvider(
  provider: string,
  known: readonly KnownProvider[],
): provider is KnownProvider {
  return known.some((k) => k === provider);
}

function resolveModel(provider: string, modelId: string): Model<Api> {
  const providers = getProviders();
  if (!isKnownProvider(provider, providers)) {
    throw new Error(`Unknown provider: ${provider}. Available: ${providers.join(", ")}`);
  }
  const models = getModels(provider);
  const model = models.find((m) => m.id === modelId);
  if (!model) {
    const ids = models.map((m) => m.id);
    throw new Error(
      `Unknown model: ${modelId} for provider ${provider}. Available: ${ids.join(", ")}`,
    );
  }
  return model;
}

/**
 * Dependencies that can be injected for testing (e.g., with faux provider).
 * In production, the adapter resolves models via getProviders()/getModels().
 */
export interface PiAgentDispatchDeps {
  readonly resolveModel: (provider: string, modelId: string) => Model<Api>;
  readonly authStorage?: AuthStorage;
  readonly modelRegistry?: ModelRegistry;
}

export class PiAgentDispatchAdapter extends AgentDispatchPort {
  private readonly running = new Map<string, AgentSession>();
  private readonly deps: PiAgentDispatchDeps;

  constructor(deps?: Partial<PiAgentDispatchDeps>) {
    super();
    this.deps = {
      resolveModel: deps?.resolveModel ?? resolveModel,
      authStorage: deps?.authStorage,
      modelRegistry: deps?.modelRegistry,
    };
  }

  async dispatch(config: AgentDispatchConfig): Promise<Result<AgentResult, AgentDispatchError>> {
    let session: AgentSession | undefined;
    try {
      const model = this.deps.resolveModel(config.model.provider, config.model.modelId);

      const tools = resolveTools(config.tools);
      const { session: created } = await createAgentSession({
        cwd: config.workingDirectory,
        model,
        tools: tools.length > 0 ? tools : undefined,
        sessionManager: SessionManager.inMemory(),
        authStorage: this.deps.authStorage,
        modelRegistry: this.deps.modelRegistry,
      });
      session = created;
      this.running.set(config.taskId, session);

      const startTime = Date.now();
      const prompt = config.systemPrompt
        ? `${config.systemPrompt}\n\n---\n\n${config.taskPrompt}`
        : config.taskPrompt;

      await session.prompt(prompt);

      const durationMs = Date.now() - startTime;
      const stats = session.getSessionStats();
      const output = session.getLastAssistantText() ?? "";
      const stateError = session.state.error;

      this.running.delete(config.taskId);
      session.dispose();

      if (stateError) {
        return err(AgentDispatchError.unexpectedFailure(config.taskId, stateError));
      }

      // NOTE: status/selfReview parsing integrated in S06/T06 (PI adapter integration)
      return ok({
        taskId: config.taskId,
        agentType: config.agentType,
        status: "DONE" as const,
        concerns: [],
        selfReview: {
          dimensions: [
            { dimension: "completeness" as const, passed: true },
            { dimension: "quality" as const, passed: true },
            { dimension: "discipline" as const, passed: true },
            { dimension: "verification" as const, passed: true },
          ],
          overallConfidence: "high" as const,
        },
        output,
        filesChanged: [], // Git diff deferred to execution engine (S07)
        cost: {
          provider: config.model.provider,
          modelId: config.model.modelId,
          inputTokens: stats.tokens.input,
          outputTokens: stats.tokens.output,
          costUsd: stats.cost,
        },
        durationMs,
      } satisfies AgentResult);
    } catch (e) {
      this.running.delete(config.taskId);
      if (session) {
        session.dispose();
        return err(AgentDispatchError.unexpectedFailure(config.taskId, e));
      }
      return err(AgentDispatchError.sessionCreationFailed(config.taskId, e));
    }
  }

  async abort(taskId: string): Promise<void> {
    const session = this.running.get(taskId);
    if (session) {
      await session.abort();
      this.running.delete(taskId);
      session.dispose();
    }
  }

  isRunning(taskId: string): boolean {
    return this.running.has(taskId);
  }
}
