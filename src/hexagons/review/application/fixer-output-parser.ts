import type { Result } from "@kernel";
import { err, ok } from "@kernel";
import { z } from "zod";
import { FixerError } from "../domain/errors/fixer.error";
import type { FixResult } from "../domain/ports/fixer.port";
import type { FindingProps } from "../domain/review.schemas";

const FixerOutputSchema = z.object({
  fixed: z.array(z.string()),
  deferred: z.array(z.string()),
  justifications: z.record(z.string(), z.string()).default({}),
  testsPassing: z.boolean(),
});

export class FixerOutputParser {
  parse(agentOutput: string, originalFindings: FindingProps[]): Result<FixResult, FixerError> {
    const jsonStr = this.extractJsonBlock(agentOutput);

    if (jsonStr === undefined) {
      return err(
        new FixerError("Failed to parse fixer output: no JSON block found", {
          rawOutput: agentOutput.slice(0, 200),
        }),
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      return err(
        new FixerError(
          `Failed to parse fixer output: ${e instanceof Error ? e.message : String(e)}`,
          { rawOutput: agentOutput.slice(0, 200) },
        ),
      );
    }

    const schemaResult = FixerOutputSchema.safeParse(parsed);
    if (!schemaResult.success) {
      return err(
        new FixerError(`Failed to parse fixer output: ${schemaResult.error.message}`, {
          rawOutput: agentOutput.slice(0, 200),
        }),
      );
    }

    const output = schemaResult.data;
    const findingMap = new Map<string, FindingProps>(originalFindings.map((f) => [f.id, f]));

    const fixedSet = new Set(output.fixed);
    const mentionedIds = new Set([...output.fixed, ...output.deferred]);

    const fixed: FindingProps[] = output.fixed
      .map((id) => findingMap.get(id))
      .filter((f): f is FindingProps => f !== undefined);

    const deferredFromOutput: FindingProps[] = output.deferred
      .map((id) => findingMap.get(id))
      .filter((f): f is FindingProps => f !== undefined);

    const autoDeferredFromUnmentioned: FindingProps[] = originalFindings.filter(
      (f) => !mentionedIds.has(f.id) && !fixedSet.has(f.id),
    );

    const deferred = [...deferredFromOutput, ...autoDeferredFromUnmentioned];

    return ok({
      fixed,
      deferred,
      justifications: output.justifications,
      testsPassing: output.testsPassing,
    });
  }

  extractJsonBlock(output: string): string | undefined {
    // Try fenced ```json ... ``` first
    const fencedMatch = /```json\s*([\s\S]*?)```/.exec(output);
    if (fencedMatch?.[1] !== undefined) {
      return fencedMatch[1].trim();
    }

    // Try bare { ... } with brace-matching
    const firstBrace = output.indexOf("{");
    if (firstBrace === -1) {
      return undefined;
    }

    let depth = 0;
    for (let i = firstBrace; i < output.length; i++) {
      if (output[i] === "{") depth++;
      else if (output[i] === "}") {
        depth--;
        if (depth === 0) {
          return output.slice(firstBrace, i + 1);
        }
      }
    }

    return undefined;
  }
}
