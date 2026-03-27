import { AgentTypeSchema, IdSchema, ModelProfileNameSchema } from "@kernel";
import { z } from "zod";
import { WorkflowPhaseSchema } from "./workflow-session.schemas";

export const SKILL_NAMES = {
  BRAINSTORMING: "brainstorming",
  WRITING_PLANS: "writing-plans",
  STRESS_TESTING_SPECS: "stress-testing-specs",
  TEST_DRIVEN_DEVELOPMENT: "test-driven-development",
  HEXAGONAL_ARCHITECTURE: "hexagonal-architecture",
  COMMIT_CONVENTIONS: "commit-conventions",
  SYSTEMATIC_DEBUGGING: "systematic-debugging",
  RESEARCH_METHODOLOGY: "research-methodology",
  ACCEPTANCE_CRITERIA_VALIDATION: "acceptance-criteria-validation",
  VERIFICATION_BEFORE_COMPLETION: "verification-before-completion",
  CODE_REVIEW_PROTOCOL: "code-review-protocol",
  ARCHITECTURE_REVIEW: "architecture-review",
  FINISHING_WORK: "finishing-work",
} as const;

export const SkillNameSchema = z.enum([
  SKILL_NAMES.BRAINSTORMING,
  SKILL_NAMES.WRITING_PLANS,
  SKILL_NAMES.STRESS_TESTING_SPECS,
  SKILL_NAMES.TEST_DRIVEN_DEVELOPMENT,
  SKILL_NAMES.HEXAGONAL_ARCHITECTURE,
  SKILL_NAMES.COMMIT_CONVENTIONS,
  SKILL_NAMES.SYSTEMATIC_DEBUGGING,
  SKILL_NAMES.RESEARCH_METHODOLOGY,
  SKILL_NAMES.ACCEPTANCE_CRITERIA_VALIDATION,
  SKILL_NAMES.VERIFICATION_BEFORE_COMPLETION,
  SKILL_NAMES.CODE_REVIEW_PROTOCOL,
  SKILL_NAMES.ARCHITECTURE_REVIEW,
  SKILL_NAMES.FINISHING_WORK,
]);
export type SkillName = z.infer<typeof SkillNameSchema>;

export const SkillTypeSchema = z.enum(["rigid", "flexible"]);
export type SkillType = z.infer<typeof SkillTypeSchema>;

export const SkillReferenceSchema = z.object({
  name: SkillNameSchema,
  type: SkillTypeSchema,
});
export type SkillReference = z.infer<typeof SkillReferenceSchema>;

export const ContextPackagePropsSchema = z.object({
  phase: WorkflowPhaseSchema,
  sliceId: IdSchema,
  taskId: IdSchema.optional(),
  skills: z.array(SkillReferenceSchema).max(3),
  agentType: AgentTypeSchema,
  modelProfile: ModelProfileNameSchema,
  filePaths: z.array(z.string()),
  taskPrompt: z.string(),
});
export type ContextPackageProps = z.infer<typeof ContextPackagePropsSchema>;
