export { MilestoneClosedEvent } from "./domain/events/milestone-closed.event";
export { MilestoneCreatedEvent } from "./domain/events/milestone-created.event";
export type { MilestoneDTO, MilestoneStatus } from "./domain/milestone.schemas";
export {
  MilestoneLabelSchema,
  MilestonePropsSchema,
  MilestoneStatusSchema,
} from "./domain/milestone.schemas";
export { MilestoneRepositoryPort } from "./domain/ports/milestone-repository.port";
// Infrastructure — PI
export type { MilestoneExtensionDeps } from "./infrastructure/pi/milestone.extension";
export { registerMilestoneExtension } from "./infrastructure/pi/milestone.extension";
export type { CreateMilestoneParams } from "./use-cases/create-milestone.use-case";
// Use Cases
export {
  CreateMilestoneError,
  CreateMilestoneParamsSchema,
  CreateMilestoneUseCase,
} from "./use-cases/create-milestone.use-case";
