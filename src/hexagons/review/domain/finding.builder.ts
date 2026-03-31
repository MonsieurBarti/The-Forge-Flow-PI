import { faker } from "@faker-js/faker";
import type { FindingImpact, FindingProps, ReviewSeverity } from "./review.schemas";

export class FindingBuilder {
  private _id: string = faker.string.uuid();
  private _severity: ReviewSeverity = "medium";
  private _message: string = faker.lorem.sentence();
  private _filePath: string = `src/${faker.system.fileName()}`;
  private _lineStart: number = faker.number.int({ min: 1, max: 500 });
  private _lineEnd?: number;
  private _suggestion?: string;
  private _ruleId?: string;
  private _impact?: FindingImpact;

  withId(id: string): this {
    this._id = id;
    return this;
  }
  withImpact(impact: FindingImpact): this {
    this._impact = impact;
    return this;
  }
  withSeverity(s: ReviewSeverity): this {
    this._severity = s;
    return this;
  }
  withFilePath(p: string): this {
    this._filePath = p;
    return this;
  }
  withLineStart(n: number): this {
    this._lineStart = n;
    return this;
  }
  withLineEnd(n: number): this {
    this._lineEnd = n;
    return this;
  }
  withMessage(m: string): this {
    this._message = m;
    return this;
  }
  withSuggestion(s: string): this {
    this._suggestion = s;
    return this;
  }
  withRuleId(r: string): this {
    this._ruleId = r;
    return this;
  }

  build(): FindingProps {
    return {
      id: this._id,
      severity: this._severity,
      message: this._message,
      filePath: this._filePath,
      lineStart: this._lineStart,
      lineEnd: this._lineEnd,
      suggestion: this._suggestion,
      ruleId: this._ruleId,
      impact: this._impact,
    };
  }
}
