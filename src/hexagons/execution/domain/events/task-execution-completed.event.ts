import {
  DomainEvent,
  DomainEventPropsSchema,
  EVENT_NAMES,
  type EventName,
  IdSchema,
  type ModelProfileName,
  ModelProfileNameSchema,
} from "@kernel";
import { type AgentResult, AgentResultSchema } from "@kernel/agents";
import { z } from "zod";

const TaskExecutionCompletedEventPropsSchema = DomainEventPropsSchema.extend({
  taskId: IdSchema,
  sliceId: IdSchema,
  milestoneId: IdSchema,
  waveIndex: z.number().int().min(0),
  modelProfile: ModelProfileNameSchema,
  agentResult: AgentResultSchema,
});

type TaskExecutionCompletedEventProps = z.infer<typeof TaskExecutionCompletedEventPropsSchema>;

export class TaskExecutionCompletedEvent extends DomainEvent {
  readonly eventName: EventName = EVENT_NAMES.TASK_EXECUTION_COMPLETED;
  readonly taskId: string;
  readonly sliceId: string;
  readonly milestoneId: string;
  readonly waveIndex: number;
  readonly modelProfile: ModelProfileName;
  readonly agentResult: AgentResult;

  constructor(props: TaskExecutionCompletedEventProps) {
    const parsed = TaskExecutionCompletedEventPropsSchema.parse(props);
    super(parsed);
    this.taskId = parsed.taskId;
    this.sliceId = parsed.sliceId;
    this.milestoneId = parsed.milestoneId;
    this.waveIndex = parsed.waveIndex;
    this.modelProfile = parsed.modelProfile;
    this.agentResult = parsed.agentResult;
  }
}
