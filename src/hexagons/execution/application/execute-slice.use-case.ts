import type { TaskRepositoryPort } from "@hexagons/task/domain/ports/task-repository.port";
import type { WaveDetectionPort } from "@hexagons/task/domain/ports/wave-detection.port";
import type { Task } from "@hexagons/task/domain/task.aggregate";
import type { TaskDependencyInput, Wave } from "@hexagons/task/domain/wave.schemas";
import {
  type DateProviderPort,
  type EventBusPort,
  err,
  type LoggerPort,
  ok,
  type Result,
} from "@kernel";
import {
  type AgentConcern,
  type AgentDispatchConfig,
  AgentDispatchError,
  type AgentDispatchPort,
  type AgentResult,
  isSuccessfulStatus,
} from "@kernel/agents";
import type { GitPort } from "@kernel/ports/git.port";
import type { WorktreePort } from "@kernel/ports/worktree.port";
import { Checkpoint } from "../domain/checkpoint.aggregate";
import { ExecutionError } from "../domain/errors/execution.error";
import { OverseerError } from "../domain/errors/overseer.error";
import { AllTasksCompletedEvent } from "../domain/events/all-tasks-completed.event";
import { TaskExecutionCompletedEvent } from "../domain/events/task-execution-completed.event";
import type { GuardrailValidationReport, GuardrailViolation } from "../domain/guardrail.schemas";
import type {
  GuardrailViolationEntry,
  ModelDownshiftEntry,
  OverseerInterventionEntry,
  PreDispatchBlockedEntry,
  ReflectionEntry,
  TaskEscalatedEntry,
} from "../domain/journal-entry.schemas";
import type { OverseerConfig, OverseerVerdict } from "../domain/overseer.schemas";
import type { CheckpointRepositoryPort } from "../domain/ports/checkpoint-repository.port";
import type { JournalRepositoryPort } from "../domain/ports/journal-repository.port";
import type { MetricsRepositoryPort } from "../domain/ports/metrics-repository.port";
import type { OutputGuardrailPort } from "../domain/ports/output-guardrail.port";
import type { OverseerPort } from "../domain/ports/overseer.port";
import type { PreDispatchGuardrailPort } from "../domain/ports/pre-dispatch-guardrail.port";
import type { RetryPolicy } from "../domain/ports/retry-policy.port";
import type { ReflectionResult } from "../domain/reflection.schemas";
import { buildReflectionConfig } from "./build-reflection-config";
import { DomainRouter } from "./domain-router";
import type { ExecuteSliceInput, ExecuteSliceResult } from "./execute-slice.schemas";
import { JournalEventHandler } from "./journal-event-handler";
import { PromptBuilder } from "./prompt-builder";
import { RecordTaskMetricsUseCase } from "./record-task-metrics.use-case";

function toAgentConcern(v: GuardrailViolation): AgentConcern {
  return {
    area: v.ruleId,
    description: v.filePath ? `${v.message} (${v.filePath}:${v.line ?? "?"})` : v.message,
    severity: v.severity === "error" ? "critical" : v.severity === "warning" ? "warning" : "info",
  };
}

const STALE_CLAIM_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

interface ExecuteSliceUseCaseDeps {
  readonly taskRepository: TaskRepositoryPort;
  readonly waveDetection: WaveDetectionPort;
  readonly checkpointRepository: CheckpointRepositoryPort;
  readonly agentDispatch: AgentDispatchPort;
  readonly worktree: WorktreePort;
  readonly eventBus: EventBusPort;
  readonly journalRepository: JournalRepositoryPort;
  readonly metricsRepository: MetricsRepositoryPort;
  readonly dateProvider: DateProviderPort;
  readonly logger: LoggerPort;
  readonly templateContent: string;
  readonly guardrail: OutputGuardrailPort;
  readonly gitPort: GitPort;
  readonly overseer: OverseerPort;
  readonly retryPolicy: RetryPolicy;
  readonly overseerConfig: OverseerConfig;
  readonly preDispatchGuardrail: PreDispatchGuardrailPort;
  readonly modelResolver: (profileName: string) => { provider: string; modelId: string };
  readonly checkpointBeforeRetry: boolean;
}

export class ExecuteSliceUseCase {
  constructor(private readonly deps: ExecuteSliceUseCaseDeps) {}

  private async executeTaskWithOverseer(
    task: Task,
    config: AgentDispatchConfig,
    input: ExecuteSliceInput,
  ): Promise<Result<AgentResult, AgentDispatchError | OverseerError>> {
    if (!this.deps.overseerConfig.enabled) {
      return this.deps.agentDispatch.dispatch(config);
    }

    const maxRetries = this.deps.overseerConfig.retryLoop?.threshold
      ? Math.min(2, this.deps.overseerConfig.retryLoop.threshold)
      : 2;
    let currentConfig = config;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const monitorPromise = this.deps.overseer.monitor({
        taskId: task.id,
        sliceId: input.sliceId,
        complexityTier: input.complexity,
        dispatchTimestamp: this.deps.dateProvider.now(),
      });

      const dispatchPromise = this.deps.agentDispatch.dispatch(currentConfig);

      type RaceResult =
        | { type: "completed"; value: Result<AgentResult, AgentDispatchError> }
        | { type: "intervention"; verdict: OverseerVerdict };

      const raceResult: RaceResult = await Promise.race([
        dispatchPromise.then((r): RaceResult => ({ type: "completed", value: r })),
        monitorPromise.then((v): RaceResult => ({ type: "intervention", verdict: v })),
      ]);

      if (raceResult.type === "completed") {
        await this.deps.overseer.stop(task.id).catch(() => {});
        monitorPromise.catch(() => {}); // swallow cancellation rejection
        return raceResult.value;
      }

      // Overseer triggered — abort agent
      await this.deps.agentDispatch.abort(task.id);
      dispatchPromise.catch(() => {}); // swallow abort rejection

      // Journal the abort
      const abortEntry: Omit<OverseerInterventionEntry, "seq"> = {
        type: "overseer-intervention",
        sliceId: input.sliceId,
        timestamp: this.deps.dateProvider.now(),
        taskId: task.id,
        strategy: raceResult.verdict.strategy,
        reason: raceResult.verdict.reason,
        action: "aborted",
        retryCount: attempt,
      };
      await this.deps.journalRepository.append(input.sliceId, abortEntry);

      // Check retry policy
      this.deps.retryPolicy.recordFailure(task.id, raceResult.verdict.strategy);
      const decision = this.deps.retryPolicy.shouldRetry(
        task.id,
        raceResult.verdict.strategy,
        attempt,
      );

      if (!decision.retry) {
        const escalateEntry: Omit<OverseerInterventionEntry, "seq"> = {
          type: "overseer-intervention",
          sliceId: input.sliceId,
          timestamp: this.deps.dateProvider.now(),
          taskId: task.id,
          strategy: raceResult.verdict.strategy,
          reason: raceResult.verdict.reason,
          action: "escalated",
          retryCount: attempt,
        };
        await this.deps.journalRepository.append(input.sliceId, escalateEntry);
        return err(OverseerError.timeout(task.id, raceResult.verdict.reason));
      }

      // Journal retry
      const retryEntry: Omit<OverseerInterventionEntry, "seq"> = {
        type: "overseer-intervention",
        sliceId: input.sliceId,
        timestamp: this.deps.dateProvider.now(),
        taskId: task.id,
        strategy: raceResult.verdict.strategy,
        reason: raceResult.verdict.reason,
        action: "retrying",
        retryCount: attempt,
      };
      await this.deps.journalRepository.append(input.sliceId, retryEntry);

      // Enrich prompt with error context
      currentConfig = {
        ...currentConfig,
        taskPrompt: `${currentConfig.taskPrompt}\n\n[OVERSEER] Previous attempt failed: ${raceResult.verdict.reason}. Avoid repeating the same approach.`,
      };
      // Cleanup before retry
      await this.deps.gitPort.restoreWorktree(input.workingDirectory);
    }

    return err(OverseerError.timeout(task.id, "max retries exhausted"));
  }

  async execute(
    input: ExecuteSliceInput,
    signal?: AbortSignal,
  ): Promise<Result<ExecuteSliceResult, ExecutionError>> {
    // 1. Load tasks
    const tasksResult = await this.deps.taskRepository.findBySliceId(input.sliceId);
    if (!tasksResult.ok) {
      return err(ExecutionError.noTasks(input.sliceId));
    }
    const tasks = tasksResult.data;
    if (tasks.length === 0) {
      return err(ExecutionError.noTasks(input.sliceId));
    }

    // Compute slice-wide file paths for pre-dispatch context
    const sliceFilePaths = [...new Set(tasks.flatMap((t) => [...t.filePaths]))];

    // 2. Detect waves
    const taskInputs: TaskDependencyInput[] = tasks.map((t) => ({
      id: t.id,
      blockedBy: [...t.blockedBy],
    }));
    const wavesResult = this.deps.waveDetection.detectWaves(taskInputs);
    if (!wavesResult.ok) {
      return err(ExecutionError.cyclicDependency(input.sliceId));
    }
    const waves: Wave[] = wavesResult.data;

    // 3. Validate worktree
    const worktreeExists = await this.deps.worktree.exists(input.sliceId);
    if (!worktreeExists) {
      return err(ExecutionError.worktreeRequired(input.sliceId));
    }

    // 4. Load or create checkpoint
    const cpResult = await this.deps.checkpointRepository.findBySliceId(input.sliceId);
    let checkpoint: Checkpoint;
    if (cpResult.ok && cpResult.data !== null) {
      checkpoint = cpResult.data;
    } else {
      checkpoint = Checkpoint.createNew({
        id: crypto.randomUUID(),
        sliceId: input.sliceId,
        baseCommit: "HEAD",
        now: this.deps.dateProvider.now(),
      });
    }

    // 5. Wire event subscriptions
    new JournalEventHandler(this.deps.journalRepository).register(this.deps.eventBus);
    new RecordTaskMetricsUseCase(this.deps.metricsRepository).register(this.deps.eventBus);

    // Build task lookup
    const taskMap = new Map<string, Task>();
    for (const task of tasks) {
      taskMap.set(task.id, task);
    }

    // Build PromptBuilder
    const router = new DomainRouter();
    const promptBuilder = new PromptBuilder(
      {
        sliceId: input.sliceId,
        sliceLabel: input.sliceLabel,
        sliceTitle: input.sliceTitle,
        milestoneId: input.milestoneId,
        workingDirectory: input.workingDirectory,
        model: input.model,
        complexity: input.complexity,
      },
      router,
      this.deps.templateContent,
    );

    // Track results
    const completedTasks: string[] = [];
    const failedTasks: string[] = [];
    const skippedTasks: string[] = [];
    let wavesCompleted = 0;
    let aborted = false;

    // 6. Process waves sequentially
    for (let waveIndex = 0; waveIndex < waves.length; waveIndex++) {
      const wave = waves[waveIndex];
      if (!wave) continue;

      // 6a. Skip completed waves
      if (checkpoint.isWaveCompleted(waveIndex)) {
        wavesCompleted++;
        continue;
      }

      // 6b. Filter tasks: exclude completed + stale claims
      const now = this.deps.dateProvider.now();
      const waveTasks: Task[] = [];

      for (const taskId of wave.taskIds) {
        // Skip if already completed in checkpoint
        if (checkpoint.isTaskCompleted(taskId)) {
          continue;
        }

        const task = taskMap.get(taskId);
        if (!task) continue;

        // Detect stale claims
        if (
          task.status === "in_progress" &&
          now.getTime() - task.updatedAt.getTime() > STALE_CLAIM_THRESHOLD_MS
        ) {
          this.deps.logger.warn(`Stale claim detected for task ${taskId} — skipping dispatch`);
          skippedTasks.push(taskId);
          continue;
        }

        waveTasks.push(task);
      }

      // 6c. Start tasks + record in checkpoint
      for (const task of waveTasks) {
        task.start(this.deps.dateProvider.now());
        checkpoint.recordTaskStart(task.id, "executor", this.deps.dateProvider.now());
      }

      // 6d. Build dispatch configs
      const configs = waveTasks.map((task) =>
        promptBuilder.build({
          id: task.id,
          label: task.label,
          title: task.title,
          description: task.description,
          acceptanceCriteria: task.acceptanceCriteria,
          filePaths: [...task.filePaths],
        }),
      );

      // 6e. Pre-dispatch validation + dispatch via Promise.allSettled
      const preDispatchBlocked = new Set<string>();
      const settled = await Promise.allSettled(
        waveTasks.map(async (task, i) => {
          const config = configs[i];
          if (!config) throw new Error(`Missing config for task index ${i}`);

          // Pre-dispatch guard
          const pdContext = {
            taskId: task.id,
            sliceId: input.sliceId,
            milestoneId: input.milestoneId,
            taskFilePaths: [...task.filePaths],
            sliceFilePaths,
            worktreePath: input.workingDirectory,
            expectedBranch: `slice/${input.sliceId}`,
            agentModel: `${input.model.provider}/${input.model.modelId}`,
            agentTools: config.tools,
            upstreamTasks: [...task.blockedBy].map((id) => {
              const t = taskMap.get(id);
              return { id, status: t?.status ?? "unknown" };
            }),
          };
          const pdResult = await this.deps.preDispatchGuardrail.validate(pdContext);
          if (pdResult.ok) {
            const report = pdResult.data;
            // Journal all violations (blockers and warnings)
            for (const v of report.violations) {
              const entry: Omit<PreDispatchBlockedEntry, "seq"> = {
                type: "pre-dispatch-blocked",
                sliceId: input.sliceId,
                timestamp: this.deps.dateProvider.now(),
                taskId: task.id,
                waveIndex,
                ruleId: v.ruleId,
                severity: v.severity,
                message: v.message,
              };
              await this.deps.journalRepository.append(input.sliceId, entry);
            }
            if (!report.passed) {
              // Blocker — skip dispatch
              preDispatchBlocked.add(task.id);
              return err(AgentDispatchError.sessionAborted(task.id));
            }
          }

          return this.executeTaskWithOverseer(task, config, input);
        }),
      );

      // 6e-bis. Run reflection per completed task (sequential)
      for (let i = 0; i < settled.length; i++) {
        const settlement = settled[i];
        const task = waveTasks[i];
        if (!settlement || !task || settlement.status !== "fulfilled" || !settlement.value.ok)
          continue;
        const agentResult = settlement.value.data;
        if (!isSuccessfulStatus(agentResult.status)) continue;

        const reflectionResult = await this.runReflection(
          task,
          agentResult,
          configs[i]!,
          input,
          waveIndex,
        );

        // Journal reflection
        const reflectionEntry: Omit<ReflectionEntry, "seq"> = {
          type: "reflection" as const,
          sliceId: input.sliceId,
          timestamp: this.deps.dateProvider.now(),
          taskId: task.id,
          waveIndex,
          tier: reflectionResult.tier,
          passed: reflectionResult.passed,
          issues: reflectionResult.issues,
          triggeredRetry: reflectionResult.issues.some((iss) => iss.severity === "blocker"),
        };
        await this.deps.journalRepository.append(input.sliceId, reflectionEntry);

        // If blocker issues found, mark as reflection-failed
        if (reflectionResult.issues.some((iss) => iss.severity === "blocker")) {
          // Replace the settled result to prevent completion
          settled[i] = {
            status: "fulfilled",
            value: err(AgentDispatchError.unexpectedFailure(task.id, "Reflection blocker")),
          };
        }
      }

      // 6e-ter. Wave-level guardrail validation
      const waveFailedTasks: string[] = [];
      let _guardrailBlocked = false;

      const guardrailResults = new Map<string, GuardrailValidationReport>();

      for (let i = 0; i < settled.length; i++) {
        const settlement = settled[i];
        const task = waveTasks[i];
        if (!settlement || !task || settlement.status !== "fulfilled" || !settlement.value.ok)
          continue;
        const agentResult = settlement.value.data;
        if (!isSuccessfulStatus(agentResult.status)) continue;

        const reportResult = await this.deps.guardrail.validate({
          agentResult,
          taskFilePaths: [...task.filePaths],
          workingDirectory: input.workingDirectory,
          filesChanged: [...agentResult.filesChanged],
        });
        if (reportResult.ok) {
          guardrailResults.set(task.id, reportResult.data);
        }
      }

      const hasBlockers = [...guardrailResults.values()].some((r) => !r.passed);

      if (hasBlockers) {
        _guardrailBlocked = true;
        await this.deps.gitPort.restoreWorktree(input.workingDirectory);

        for (const [taskId, report] of guardrailResults) {
          if (!report.passed) {
            const entry: Omit<GuardrailViolationEntry, "seq"> = {
              type: "guardrail-violation",
              sliceId: input.sliceId,
              timestamp: this.deps.dateProvider.now(),
              taskId,
              waveIndex,
              violations: report.violations,
              action: "blocked",
            };
            await this.deps.journalRepository.append(input.sliceId, entry);
            waveFailedTasks.push(taskId);
          }
        }
      } else {
        for (const [taskId, report] of guardrailResults) {
          const warnings = report.violations.filter((v) => v.severity !== "info");
          if (warnings.length > 0) {
            const entry: Omit<GuardrailViolationEntry, "seq"> = {
              type: "guardrail-violation",
              sliceId: input.sliceId,
              timestamp: this.deps.dateProvider.now(),
              taskId,
              waveIndex,
              violations: warnings,
              action: "warned",
            };
            await this.deps.journalRepository.append(input.sliceId, entry);
            // Enrich AgentResult concerns
            const idx = waveTasks.findIndex((t) => t.id === taskId);
            const settlement = settled[idx];
            if (settlement?.status === "fulfilled" && settlement.value.ok) {
              const result = settlement.value.data;
              const enrichedConcerns = [...result.concerns, ...warnings.map(toAgentConcern)];
              Object.assign(result, { concerns: enrichedConcerns });
            }
          }
        }
      }

      // Add pre-dispatch blocked tasks to failures
      for (const blockedId of preDispatchBlocked) {
        waveFailedTasks.push(blockedId);
      }

      // 6f. Process settled results
      for (let i = 0; i < settled.length; i++) {
        const settlement = settled[i];
        const task = waveTasks[i];
        if (!settlement || !task) continue;

        // Skip pre-dispatch blocked tasks (already handled)
        if (preDispatchBlocked.has(task.id)) continue;

        if (settlement.status === "fulfilled") {
          const dispatchResult = settlement.value;

          if (dispatchResult.ok) {
            const agentResult = dispatchResult.data;

            // Emit TaskExecutionCompletedEvent for all completed dispatches
            await this.deps.eventBus.publish(
              new TaskExecutionCompletedEvent({
                id: crypto.randomUUID(),
                aggregateId: task.id,
                occurredAt: this.deps.dateProvider.now(),
                taskId: task.id,
                sliceId: input.sliceId,
                milestoneId: input.milestoneId,
                waveIndex,
                modelProfile: input.modelProfile,
                agentResult,
              }),
            );

            if (isSuccessfulStatus(agentResult.status)) {
              // Success: DONE or DONE_WITH_CONCERNS
              const completeResult = task.complete(this.deps.dateProvider.now());
              if (completeResult.ok) {
                checkpoint.recordTaskComplete(task.id, this.deps.dateProvider.now());
                await this.deps.taskRepository.save(task);

                // Publish task-hex events (TaskCompletedEvent)
                for (const taskEvent of task.pullEvents()) {
                  await this.deps.eventBus.publish(taskEvent);
                }

                await this.deps.checkpointRepository.save(checkpoint);

                // Publish checkpoint events
                const cpEvents = checkpoint.pullEvents();
                for (const cpEvent of cpEvents) {
                  await this.deps.eventBus.publish(cpEvent);
                }

                completedTasks.push(task.id);
              }
            } else {
              // BLOCKED or NEEDS_CONTEXT
              task.block([task.id], this.deps.dateProvider.now());
              await this.deps.taskRepository.save(task);

              // Publish task-hex events (TaskBlockedEvent)
              for (const taskEvent of task.pullEvents()) {
                await this.deps.eventBus.publish(taskEvent);
              }

              waveFailedTasks.push(task.id);
            }
          } else {
            // AgentDispatchError
            waveFailedTasks.push(task.id);
          }
        } else {
          // Rejected (thrown error)
          waveFailedTasks.push(task.id);
        }
      }

      // 6g. Post-wave retry pass (sequential)
      // Pre-dispatch blocked tasks are permanent failures — skip retry
      const retriableFailures = waveFailedTasks.filter((id) => !preDispatchBlocked.has(id));
      const permanentFailures = waveFailedTasks.filter((id) => preDispatchBlocked.has(id));
      failedTasks.push(...permanentFailures);

      if (retriableFailures.length > 0) {
        const retryResults = await this.runRetryPass(
          retriableFailures,
          taskMap,
          input,
          checkpoint,
          waveIndex,
          promptBuilder,
        );
        // Move succeeded retries to completedTasks, escalated to failedTasks
        completedTasks.push(...retryResults.succeeded);
        failedTasks.push(...retryResults.escalated);

        // If all retries failed, set aborted
        if (retryResults.escalated.length > 0 && retryResults.succeeded.length === 0) {
          aborted = true;
        }
      }

      // 6h. Advance wave
      checkpoint.advanceWave(this.deps.dateProvider.now());
      await this.deps.checkpointRepository.save(checkpoint);

      // Publish checkpoint events from advanceWave
      const advanceEvents = checkpoint.pullEvents();
      for (const advEvent of advanceEvents) {
        await this.deps.eventBus.publish(advEvent);
      }

      // Check abort signal between waves
      if (signal?.aborted) {
        return ok({
          sliceId: input.sliceId,
          completedTasks,
          failedTasks,
          skippedTasks,
          wavesCompleted,
          totalWaves: waves.length,
          aborted: true,
        });
      }

      wavesCompleted++;
    }

    // 7. All waves done and not aborted => AllTasksCompletedEvent
    if (!aborted) {
      await this.deps.eventBus.publish(
        new AllTasksCompletedEvent({
          id: crypto.randomUUID(),
          aggregateId: input.sliceId,
          occurredAt: this.deps.dateProvider.now(),
          sliceId: input.sliceId,
          milestoneId: input.milestoneId,
          completedTaskCount: completedTasks.length,
          totalWaveCount: waves.length,
        }),
      );
    }

    // 8. Return result
    return ok({
      sliceId: input.sliceId,
      completedTasks,
      failedTasks,
      skippedTasks,
      wavesCompleted,
      totalWaves: waves.length,
      aborted,
    });
  }

  private async runReflection(
    task: Task,
    agentResult: AgentResult,
    originalConfig: AgentDispatchConfig,
    input: ExecuteSliceInput,
    _waveIndex: number,
  ): Promise<ReflectionResult> {
    // Fast path: check selfReview dimensions
    const allPassed = agentResult.selfReview.dimensions.every((d) => d.passed);
    const noConcerns = agentResult.concerns.length === 0;
    const isDone = agentResult.status === "DONE";
    const isSTier = input.complexity === "S";
    const isFull = input.complexity === "F-full";

    // S-tier: always fast path
    // F-lite with clean self-review: fast path (F-full always gets full path)
    if (isSTier || (!isFull && allPassed && noConcerns && isDone)) {
      return {
        passed: true,
        tier: "fast",
        issues: [],
        reflectedAt: this.deps.dateProvider.now().toISOString(),
      };
    }

    // F-full always gets full path, F-lite with concerns gets full path
    try {
      const gitDiff = await this.deps.gitPort.diff(input.workingDirectory);
      const reflectionConfig = buildReflectionConfig({
        originalConfig,
        acceptanceCriteria: task.acceptanceCriteria,
        gitDiff: gitDiff.ok ? gitDiff.data : "",
      });

      const result = await this.deps.agentDispatch.dispatch(reflectionConfig);
      if (!result.ok) {
        return {
          passed: true,
          tier: "full",
          issues: [{ severity: "warning", description: "Reflection dispatch failed" }],
          reflectedAt: this.deps.dateProvider.now().toISOString(),
        };
      }

      return this.parseReflectionReport(result.data.output);
    } catch {
      return {
        passed: true,
        tier: "full",
        issues: [{ severity: "warning", description: "Reflection parse failure" }],
        reflectedAt: this.deps.dateProvider.now().toISOString(),
      };
    }
  }

  private parseReflectionReport(output: string): ReflectionResult {
    const match = output.match(
      /<!-- TFF_REFLECTION_REPORT -->\s*([\s\S]*?)\s*<!-- \/TFF_REFLECTION_REPORT -->/,
    );
    if (!match?.[1]) {
      return {
        passed: true,
        tier: "full",
        issues: [{ severity: "warning", description: "No reflection report found in output" }],
        reflectedAt: this.deps.dateProvider.now().toISOString(),
      };
    }
    try {
      const parsed = JSON.parse(match[1]);
      return {
        passed: parsed.passed ?? true,
        tier: "full",
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        reflectedAt: this.deps.dateProvider.now().toISOString(),
      };
    } catch {
      return {
        passed: true,
        tier: "full",
        issues: [{ severity: "warning", description: "Failed to parse reflection report JSON" }],
        reflectedAt: this.deps.dateProvider.now().toISOString(),
      };
    }
  }

  private async runRetryPass(
    failedTaskIds: string[],
    taskMap: Map<string, Task>,
    input: ExecuteSliceInput,
    checkpoint: Checkpoint,
    waveIndex: number,
    promptBuilder: PromptBuilder,
  ): Promise<{ succeeded: string[]; escalated: string[] }> {
    const succeeded: string[] = [];
    const escalated: string[] = [];

    for (const taskId of failedTaskIds) {
      const task = taskMap.get(taskId);
      if (!task) {
        escalated.push(taskId);
        continue;
      }

      let currentProfile: string = input.modelProfile;
      const profilesAttempted: string[] = [currentProfile];
      let attempt = 0;

      while (true) {
        const resolution = this.deps.retryPolicy.resolveModel(taskId, currentProfile, attempt);

        if (resolution.action === "escalate") {
          const entry: Omit<TaskEscalatedEntry, "seq"> = {
            type: "task-escalated",
            sliceId: input.sliceId,
            timestamp: this.deps.dateProvider.now(),
            taskId,
            waveIndex,
            reason: "Exhausted retry chain",
            totalAttempts: attempt,
            profilesAttempted,
          };
          await this.deps.journalRepository.append(input.sliceId, entry);
          escalated.push(taskId);
          break;
        }

        if (resolution.action === "downshift") {
          const entry: Omit<ModelDownshiftEntry, "seq"> = {
            type: "model-downshift",
            sliceId: input.sliceId,
            timestamp: this.deps.dateProvider.now(),
            taskId,
            waveIndex,
            fromProfile: currentProfile,
            toProfile: resolution.profile,
            reason: "Task failed, downshifting model",
            attempt,
          };
          await this.deps.journalRepository.append(input.sliceId, entry);
          currentProfile = resolution.profile;
          if (!profilesAttempted.includes(currentProfile)) {
            profilesAttempted.push(currentProfile);
          }
          attempt = 0;
          continue;
        }

        // action === "retry"
        // Checkpoint before retry (gated by config)
        if (this.deps.checkpointBeforeRetry) {
          await this.deps.checkpointRepository.save(checkpoint);
        }

        // Restore worktree (safe: sequential, no sibling tasks running)
        await this.deps.gitPort.restoreWorktree(input.workingDirectory);

        // Resolve model for this profile
        const resolvedModel = this.deps.modelResolver(currentProfile);

        // Build new config with the resolved model
        const config = promptBuilder.build({
          id: task.id,
          label: task.label,
          title: task.title,
          description: task.description,
          acceptanceCriteria: task.acceptanceCriteria,
          filePaths: [...task.filePaths],
        });
        const retryConfig = { ...config, model: resolvedModel };

        // Re-dispatch
        const result = await this.executeTaskWithOverseer(task, retryConfig, input);

        if (result.ok && isSuccessfulStatus(result.data.status)) {
          succeeded.push(taskId);
          checkpoint.recordTaskComplete(taskId, this.deps.dateProvider.now());
          await this.deps.checkpointRepository.save(checkpoint);
          break;
        }

        attempt++;
      }
    }

    return { succeeded, escalated };
  }
}
