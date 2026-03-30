import { err, ok, type Result } from "@kernel";
import type { AgentDispatchConfig, AgentResult } from "@kernel/agents";
import type {
  AgentConcern,
  AgentStatus,
  SelfReviewChecklist,
} from "@kernel/agents/agent-status.schema";
import { crossCheckAgentResult } from "@kernel/agents/agent-status-cross-checker";
import { parseAgentStatusReport } from "@kernel/agents/agent-status-parser";
import { AGENT_STATUS_PROMPT } from "@kernel/agents/agent-status-prompt";
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

const FAILED_SELF_REVIEW: SelfReviewChecklist = {
  dimensions: [
    { dimension: "completeness", passed: false },
    { dimension: "quality", passed: false },
    { dimension: "discipline", passed: false },
    { dimension: "verification", passed: false },
  ],
  overallConfidence: "low",
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
      const fullSystemPrompt = config.systemPrompt
        ? `${config.systemPrompt}\n\n${AGENT_STATUS_PROMPT}`
        : AGENT_STATUS_PROMPT;
      const prompt = `${fullSystemPrompt}\n\n---\n\n${config.taskPrompt}`;

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

      const cost = {
        provider: config.model.provider,
        modelId: config.model.modelId,
        inputTokens: stats.tokens.input,
        outputTokens: stats.tokens.output,
        costUsd: stats.cost,
      };

      const parseResult = parseAgentStatusReport(output);
      let status: AgentStatus;
      let concerns: AgentConcern[];
      let selfReview: SelfReviewChecklist;

      if (parseResult.ok) {
        status = parseResult.data.status;
        concerns = [...parseResult.data.concerns];
        selfReview = parseResult.data.selfReview;
      } else {
        status = "BLOCKED";
        concerns = [
          {
            area: "status-protocol",
            description: `Failed to parse status report: ${parseResult.error.message}`,
            severity: "critical",
          },
        ];
        selfReview = FAILED_SELF_REVIEW;
      }

      const crossCheck = crossCheckAgentResult(
        { status, concerns, selfReview },
        { filesChanged: [], durationMs, cost },
        config.agentType,
      );
      concerns.push(...crossCheck.discrepancies);

      return ok({
        taskId: config.taskId,
        agentType: config.agentType,
        status,
        output,
        filesChanged: [], // Git diff deferred to execution engine (S07)
        concerns,
        selfReview,
        cost,
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
