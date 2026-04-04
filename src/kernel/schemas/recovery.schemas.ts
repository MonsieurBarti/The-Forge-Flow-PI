import { z } from 'zod';
import { BranchMetaSchema } from './branch-meta.schemas';

export const RecoveryTypeSchema = z.enum([
  'crash',
  'mismatch',
  'rename',
  'fresh-clone',
  'untracked',
  'healthy',
]);
export type RecoveryType = z.infer<typeof RecoveryTypeSchema>;

export const RecoveryScenarioSchema = z.object({
  type: RecoveryTypeSchema,
  currentBranch: z.string().nullable(),
  branchMeta: BranchMetaSchema.nullable(),
  backupPaths: z.array(z.string()),
  stateBranchExists: z.boolean(),
  parentStateBranch: z.string().nullable(),
});
export type RecoveryScenario = z.infer<typeof RecoveryScenarioSchema>;

export const RecoveryReportSchema = z.object({
  type: RecoveryTypeSchema,
  action: z.enum(['restored', 'renamed', 'created-fresh', 'skipped', 'none']),
  source: z.string(),
  filesRestored: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});
export type RecoveryReport = z.infer<typeof RecoveryReportSchema>;
