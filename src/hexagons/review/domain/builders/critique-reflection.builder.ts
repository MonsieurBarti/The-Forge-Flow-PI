import { faker } from "@faker-js/faker";
import type { CritiqueReflectionResult, ReflectionInsight } from "../schemas/critique-reflection.schemas";
import { FindingBuilder } from "./finding.builder";
import type { FindingImpact, FindingProps } from "../schemas/review.schemas";

export class CritiqueReflectionResultBuilder {
  private _rawFindings: FindingProps[] = [];
  private _impacts: Map<string, FindingImpact> = new Map();
  private _insights: ReflectionInsight[] = [];
  private _summary: string = faker.lorem.sentence();

  withFindings(count: number): this {
    this._rawFindings = Array.from({ length: count }, () =>
      new FindingBuilder().withId(faker.string.uuid()).build(),
    );
    for (const f of this._rawFindings) {
      this._impacts.set(f.id, "should-fix");
    }
    return this;
  }

  withRawFindings(findings: FindingProps[]): this {
    this._rawFindings = findings;
    for (const f of findings) {
      if (!this._impacts.has(f.id)) {
        this._impacts.set(f.id, "should-fix");
      }
    }
    return this;
  }

  withImpact(findingId: string, impact: FindingImpact): this {
    this._impacts.set(findingId, impact);
    return this;
  }

  withInsights(insights: ReflectionInsight[]): this {
    this._insights = insights;
    return this;
  }

  withSummary(summary: string): this {
    this._summary = summary;
    return this;
  }

  build(): CritiqueReflectionResult {
    const prioritizedFindings = this._rawFindings.map((f) => ({
      ...f,
      impact: this._impacts.get(f.id) ?? ("should-fix" satisfies FindingImpact),
    }));

    return {
      critique: { rawFindings: this._rawFindings },
      reflection: {
        prioritizedFindings,
        insights:
          this._insights.length > 0
            ? this._insights
            : this._rawFindings.length > 0
              ? [
                  {
                    theme: "General",
                    affectedFindings: this._rawFindings.map((f) => f.id),
                    recommendation: "Review",
                  },
                ]
              : [],
        summary: this._summary,
      },
    };
  }
}
