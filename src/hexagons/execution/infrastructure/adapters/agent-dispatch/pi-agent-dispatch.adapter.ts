import { err, ok, type Result } from "@kernel";
import type { AgentDispatchConfig, AgentResult } from "@kernel/agents";
import { AgentDispatchError, AgentDispatchPort } from "@kernel/agents";
import type {
  AgentConcern,
  AgentStatus,
  SelfReviewChecklist,
} from "@kernel/agents/schemas/agent-status.schema";
import { crossCheckAgentResult } from "@kernel/agents/services/agent-status-cross-checker";
import { parseAgentStatusReport } from "@kernel/agents/services/agent-status-parser";
import { AGENT_STATUS_PROMPT } from "@kernel/agents/services/agent-status-prompt";
import { GUARDRAIL_PROMPT } from "@kernel/agents/prompts/guardrail-prompt";
import type { AgentEventPort } from "@kernel/ports";
import type { Api, AssistantMessageEvent, KnownProvider, Model } from "@mariozechner/pi-ai";
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
import type { ToolExecutionEntry, TurnBoundaryEntry } from "../../../domain/journal-entry.schemas";
import type { JournalRepositoryPort } from "../../../domain/ports/journal-repository.port";
import { TurnMetricsCollector } from "../../../domain/turn-metrics-collector";

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

function extractTextDelta(event: AssistantMessageEvent): string | null {
  return event.type === "text_delta" ? event.delta : null;
}

/**
 * Dependencies that can be injected for testing (e.g., with faux provider).
 * In production, the adapter resolves models via getProviders()/getModels().
 */
export interface PiAgentDispatchDeps {
  readonly resolveModel: (provider: string, modelId: string) => Model<Api>;
  readonly authStorage?: AuthStorage;
  readonly modelRegistry?: ModelRegistry;
  readonly agentEventPort?: AgentEventPort;
  readonly journalRepository?: JournalRepositoryPort;
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
      agentEventPort: deps?.agentEventPort,
      journalRepository: deps?.journalRepository,
    };
  }

  async dispatch(config: AgentDispatchConfig): Promise<Result<AgentResult, AgentDispatchError>> {
    let session: AgentSession | undefined;
    let collector: TurnMetricsCollector | undefined;
    let unsubEvents: (() => void) | undefined;
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

      const agentEventPort = this.deps.agentEventPort;
      const journalRepo = this.deps.journalRepository;

      if (agentEventPort) {
        const metricsCollector = new TurnMetricsCollector();
        collector = metricsCollector;
        const unsubCollector = agentEventPort.subscribe(config.taskId, (e) =>
          metricsCollector.record(e),
        );

        let turnIndex = -1;
        let toolCallsInTurn = 0;
        const toolStartTimes = new Map<string, number>();

        const unsubSession = session.subscribe((piEvent) => {
          const now = Date.now();
          switch (piEvent.type) {
            case "turn_start":
              turnIndex++;
              toolCallsInTurn = 0;
              agentEventPort.emit(config.taskId, {
                type: "turn_start",
                taskId: config.taskId,
                turnIndex,
                timestamp: now,
              });
              if (journalRepo) {
                const entry: Omit<TurnBoundaryEntry, "seq"> = {
                  type: "turn-boundary",
                  sliceId: config.sliceId,
                  timestamp: new Date(now),
                  taskId: config.taskId,
                  turnIndex,
                  boundary: "start",
                };
                journalRepo.append(config.sliceId, entry).catch(() => {});
              }
              break;
            case "turn_end":
              agentEventPort.emit(config.taskId, {
                type: "turn_end",
                taskId: config.taskId,
                turnIndex,
                toolCallCount: toolCallsInTurn,
                timestamp: now,
              });
              if (journalRepo) {
                const entry: Omit<TurnBoundaryEntry, "seq"> = {
                  type: "turn-boundary",
                  sliceId: config.sliceId,
                  timestamp: new Date(now),
                  taskId: config.taskId,
                  turnIndex,
                  boundary: "end",
                  toolCallCount: toolCallsInTurn,
                };
                journalRepo.append(config.sliceId, entry).catch(() => {});
              }
              toolCallsInTurn = 0;
              break;
            case "message_start":
            case "message_end":
              agentEventPort.emit(config.taskId, {
                type: piEvent.type,
                taskId: config.taskId,
                turnIndex,
                timestamp: now,
              });
              break;
            case "message_update": {
              const delta = extractTextDelta(piEvent.assistantMessageEvent);
              if (delta) {
                agentEventPort.emit(config.taskId, {
                  type: "message_update",
                  taskId: config.taskId,
                  turnIndex,
                  textDelta: delta,
                  timestamp: now,
                });
              }
              break;
            }
            case "tool_execution_start":
              toolCallsInTurn++;
              toolStartTimes.set(piEvent.toolCallId, now);
              agentEventPort.emit(config.taskId, {
                type: "tool_execution_start",
                taskId: config.taskId,
                turnIndex,
                toolCallId: piEvent.toolCallId,
                toolName: piEvent.toolName,
                timestamp: now,
              });
              break;
            case "tool_execution_update":
              agentEventPort.emit(config.taskId, {
                type: "tool_execution_update",
                taskId: config.taskId,
                turnIndex,
                toolCallId: piEvent.toolCallId,
                toolName: piEvent.toolName,
                timestamp: now,
              });
              break;
            case "tool_execution_end": {
              const startTime = toolStartTimes.get(piEvent.toolCallId) ?? now;
              const durationMs = now - startTime;
              agentEventPort.emit(config.taskId, {
                type: "tool_execution_end",
                taskId: config.taskId,
                turnIndex,
                toolCallId: piEvent.toolCallId,
                toolName: piEvent.toolName,
                isError: piEvent.isError,
                durationMs,
                timestamp: now,
              });
              toolStartTimes.delete(piEvent.toolCallId);
              if (journalRepo) {
                const entry: Omit<ToolExecutionEntry, "seq"> = {
                  type: "tool-execution",
                  sliceId: config.sliceId,
                  timestamp: new Date(now),
                  taskId: config.taskId,
                  turnIndex,
                  toolCallId: piEvent.toolCallId,
                  toolName: piEvent.toolName,
                  durationMs,
                  isError: piEvent.isError,
                };
                journalRepo.append(config.sliceId, entry).catch(() => {});
              }
              break;
            }
            // Skip: agent_start, agent_end, compaction_*, auto_retry_*, queue_update
          }
        });

        unsubEvents = () => {
          unsubSession();
          unsubCollector();
        };
      }

      const startTime = Date.now();
      const fullSystemPrompt = config.systemPrompt
        ? `${config.systemPrompt}\n\n${AGENT_STATUS_PROMPT}\n\n${GUARDRAIL_PROMPT}`
        : `${AGENT_STATUS_PROMPT}\n\n${GUARDRAIL_PROMPT}`;
      const prompt = `${fullSystemPrompt}\n\n---\n\n${config.taskPrompt}`;

      await session.prompt(prompt);

      if (unsubEvents) unsubEvents();
      if (agentEventPort) agentEventPort.clear(config.taskId);

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

      const turns = collector?.toMetrics() ?? [];

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
        turns,
      } satisfies AgentResult);
    } catch (e) {
      if (unsubEvents) unsubEvents();
      if (this.deps.agentEventPort) this.deps.agentEventPort.clear(config.taskId);
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
