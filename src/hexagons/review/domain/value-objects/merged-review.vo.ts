import { BaseDomainError, err, ok, type Result, ValueObject } from "@kernel";
import {
  type ConflictProps,
  type MergedFindingProps,
  type MergedReviewProps,
  MergedReviewPropsSchema,
} from "../schemas/merged-review.schemas";
import type { Review } from "../aggregates/review.aggregate";
import {
  type ReviewRole,
  type ReviewSeverity,
  type ReviewVerdict,
  SEVERITY_RANK,
} from "../schemas/review.schemas";

export class MergeValidationError extends BaseDomainError {
  readonly code = "REVIEW.MERGE_VALIDATION";
}

interface FindingEntry {
  finding: {
    id: string;
    severity: ReviewSeverity;
    message: string;
    filePath: string;
    lineStart: number;
    lineEnd?: number;
    suggestion?: string;
    ruleId?: string;
  };
  reviewId: string;
  role: ReviewRole;
}

export class MergedReview extends ValueObject<MergedReviewProps> {
  private constructor(props: MergedReviewProps) {
    super(props, MergedReviewPropsSchema);
  }

  get sliceId(): string {
    return this.props.sliceId;
  }

  get sourceReviewIds(): ReadonlyArray<string> {
    return this.props.sourceReviewIds;
  }

  get verdict(): ReviewVerdict {
    return this.props.verdict;
  }

  get findings(): ReadonlyArray<MergedFindingProps> {
    return this.props.findings;
  }

  get conflicts(): ReadonlyArray<ConflictProps> {
    return this.props.conflicts;
  }

  hasBlockers(): boolean {
    return this.props.findings.some((f) => f.severity === "critical" || f.severity === "high");
  }

  hasConflicts(): boolean {
    return this.props.conflicts.length > 0;
  }

  toJSON(): MergedReviewProps {
    return { ...this.props };
  }

  static merge(reviews: Review[], now: Date): Result<MergedReview, BaseDomainError> {
    if (reviews.length === 0) {
      return err(new MergeValidationError("Cannot merge empty review array"));
    }

    const sliceId = reviews[0].sliceId;
    if (!reviews.every((r) => r.sliceId === sliceId)) {
      return err(new MergeValidationError("All reviews must share the same sliceId"));
    }

    const sourceReviewIds = reviews.map((r) => r.id);

    // Collect all findings with source tracking
    const allFindings: FindingEntry[] = [];
    for (const review of reviews) {
      for (const finding of review.findings) {
        allFindings.push({ finding, reviewId: review.id, role: review.role });
      }
    }

    // Group by (filePath, lineStart)
    const groups = new Map<string, FindingEntry[]>();
    for (const entry of allFindings) {
      const key = `${entry.finding.filePath}:${entry.finding.lineStart}`;
      const group = groups.get(key) ?? [];
      group.push(entry);
      groups.set(key, group);
    }

    // Dedup + detect conflicts
    const mergedFindings: MergedFindingProps[] = [];
    const conflicts: ConflictProps[] = [];

    for (const [, group] of groups) {
      // Find highest severity (lowest rank number)
      let bestEntry = group[0];
      for (const entry of group) {
        if (SEVERITY_RANK[entry.finding.severity] < SEVERITY_RANK[bestEntry.finding.severity]) {
          bestEntry = entry;
        }
      }

      const sourceIds = [...new Set(group.map((e) => e.reviewId))];

      mergedFindings.push({
        ...bestEntry.finding,
        sourceReviewIds: sourceIds,
      });

      // Detect conflicts: severity diff >= 2 levels within the same location
      if (group.length >= 2) {
        const severities = group.map((e) => SEVERITY_RANK[e.finding.severity]);
        const highestRank = Math.min(...severities);
        const lowestRank = Math.max(...severities);
        if (lowestRank - highestRank >= 2) {
          conflicts.push({
            filePath: bestEntry.finding.filePath,
            lineStart: bestEntry.finding.lineStart,
            description: `Severity disagreement: ${group.map((e) => `${e.role}=${e.finding.severity}`).join(", ")}`,
            reviewerVerdicts: group.map((e) => ({
              reviewId: e.reviewId,
              role: e.role,
              severity: e.finding.severity,
            })),
          });
        }
      }
    }

    // Verdict aggregation: rejected > changes_requested > approved
    let verdict: ReviewVerdict = "approved";
    for (const review of reviews) {
      if (review.verdict === "rejected") {
        verdict = "rejected";
        break;
      }
      if (review.verdict === "changes_requested") {
        verdict = "changes_requested";
      }
    }

    return ok(
      new MergedReview({
        sliceId,
        sourceReviewIds,
        verdict,
        findings: mergedFindings,
        conflicts,
        mergedAt: now,
      }),
    );
  }
}
