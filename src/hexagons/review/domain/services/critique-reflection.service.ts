import { err, ok, type Result } from "@kernel";
import { CritiqueReflectionError } from "../errors/critique-reflection.error";
import {
  CritiqueReflectionResultSchema,
  type ProcessedReviewResult,
} from "../schemas/critique-reflection.schemas";

export class CritiqueReflectionService {
  processResult(rawResult: unknown): Result<ProcessedReviewResult, CritiqueReflectionError> {
    // Invariant 1: Parse against schema
    const parsed = CritiqueReflectionResultSchema.safeParse(rawResult);
    if (!parsed.success) {
      return err(
        new CritiqueReflectionError(`Malformed CTR output: ${parsed.error.message}`, parsed.error),
      );
    }

    const { critique, reflection } = parsed.data;
    const rawIds = new Set(critique.rawFindings.map((f) => f.id));
    const prioIds = new Set(reflection.prioritizedFindings.map((f) => f.id));

    // Invariant 2: No invented findings
    for (const id of prioIds) {
      if (!rawIds.has(id)) {
        return err(new CritiqueReflectionError(`Reflection contains invented finding ID: ${id}`));
      }
    }

    // Invariant 3: All findings accounted for
    if (prioIds.size !== rawIds.size) {
      const missing = [...rawIds].filter((id) => !prioIds.has(id));
      return err(
        new CritiqueReflectionError(
          `Reflection is missing ${missing.length} finding(s) from critique: ${missing.join(", ")}`,
        ),
      );
    }

    // Invariant 4: No phantom insight references
    for (const insight of reflection.insights) {
      for (const refId of insight.affectedFindings) {
        if (!rawIds.has(refId)) {
          return err(
            new CritiqueReflectionError(
              `Insight "${insight.theme}" references phantom finding ID: ${refId}`,
            ),
          );
        }
      }
    }

    return ok({
      findings: reflection.prioritizedFindings,
      insights: reflection.insights,
      summary: reflection.summary,
    });
  }
}
