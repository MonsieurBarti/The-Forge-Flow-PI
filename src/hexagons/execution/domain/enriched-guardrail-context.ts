import type { GuardrailContext } from "./guardrail.schemas";

export interface EnrichedGuardrailContext extends GuardrailContext {
  readonly fileContents: ReadonlyMap<string, string>;
  readonly gitDiff: string;
}
