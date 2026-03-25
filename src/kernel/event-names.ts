import { z } from "zod";

export const EVENT_NAMES = {
  PROJECT_INITIALIZED: "project.initialized",
  MILESTONE_CREATED: "milestone.created",
  MILESTONE_CLOSED: "milestone.closed",
  SLICE_CREATED: "slice.created",
  SLICE_STATUS_CHANGED: "slice.status-changed",
  TASK_COMPLETED: "task.completed",
  TASK_BLOCKED: "task.blocked",
  ALL_TASKS_COMPLETED: "execution.all-tasks-completed",
  REVIEW_RECORDED: "review.recorded",
  SKILL_REFINED: "intelligence.skill-refined",
  WORKFLOW_PHASE_CHANGED: "workflow.phase-changed",
} as const;

export type EventName = (typeof EVENT_NAMES)[keyof typeof EVENT_NAMES];

export const EventNameSchema = z.enum([
  EVENT_NAMES.PROJECT_INITIALIZED,
  EVENT_NAMES.MILESTONE_CREATED,
  EVENT_NAMES.MILESTONE_CLOSED,
  EVENT_NAMES.SLICE_CREATED,
  EVENT_NAMES.SLICE_STATUS_CHANGED,
  EVENT_NAMES.TASK_COMPLETED,
  EVENT_NAMES.TASK_BLOCKED,
  EVENT_NAMES.ALL_TASKS_COMPLETED,
  EVENT_NAMES.REVIEW_RECORDED,
  EVENT_NAMES.SKILL_REFINED,
  EVENT_NAMES.WORKFLOW_PHASE_CHANGED,
]);
