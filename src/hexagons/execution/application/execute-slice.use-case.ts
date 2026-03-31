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
import type { AgentConcern } from "@kernel/agents";
import { isSuccessfulStatus } from "@kernel/agents";
import type { GitPort } from "@kernel/ports/git.port";
import { Checkpoint } from "../domain/checkpoint.aggregate";
import { ExecutionError } from "../domain/errors/execution.error";
import { AllTasksCompletedEvent } from "../domain/events/all-tasks-completed.event";
import { TaskExecutionCompletedEvent } from "../domain/events/task-execution-completed.event";
import type { GuardrailValidationReport, GuardrailViolation } from "../domain/guardrail.schemas";
import type { GuardrailViolationEntry } from "../domain/journal-entry.schemas";
import type { AgentDispatchPort } from "../domain/ports/agent-dispatch.port";
import type { CheckpointRepositoryPort } from "../domain/ports/checkpoint-repository.port";
import type { JournalRepositoryPort } from "../domain/ports/journal-repository.port";
import type { MetricsRepositoryPort } from "../domain/ports/metrics-repository.port";
import type { OutputGuardrailPort } from "../domain/ports/output-guardrail.port";
import type { WorktreePort } from "../domain/ports/worktree.port";
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
}

export class ExecuteSliceUseCase {
  constructor(private readonly deps: ExecuteSliceUseCaseDeps) {}

  async execute(input: ExecuteSliceInput): Promise<Result<ExecuteSliceResult, ExecutionError>> {
    // 1. Load tasks
    const tasksResult = await this.deps.taskRepository.findBySliceId(input.sliceId);
    if (!tasksResult.ok) {
      return err(ExecutionError.noTasks(input.sliceId));
    }
    const tasks = tasksResult.data;
    if (tasks.length === 0) {
      return err(ExecutionError.noTasks(input.sliceId));
    }

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

      // 6e. Dispatch all tasks in parallel via Promise.allSettled
      const settled = await Promise.allSettled(
        configs.map((config) => this.deps.agentDispatch.dispatch(config)),
      );

      // 6e-bis. Wave-level guardrail validation
      const waveFailedTasks: string[] = [];
      let guardrailBlocked = false;

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
        guardrailBlocked = true;
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

      if (guardrailBlocked) {
        failedTasks.push(...waveFailedTasks);
        aborted = true;
        break;
      }

      // 6f. Process settled results
      for (let i = 0; i < settled.length; i++) {
        const settlement = settled[i];
        const task = waveTasks[i];
        if (!settlement || !task) continue;

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

      // 6g. Fail-fast on failures
      if (waveFailedTasks.length > 0) {
        failedTasks.push(...waveFailedTasks);
        aborted = true;
        break;
      }

      // 6h. Advance wave
      checkpoint.advanceWave(this.deps.dateProvider.now());
      await this.deps.checkpointRepository.save(checkpoint);

      // Publish checkpoint events from advanceWave
      const advanceEvents = checkpoint.pullEvents();
      for (const advEvent of advanceEvents) {
        await this.deps.eventBus.publish(advEvent);
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
}
