import { err, ok, type Result } from "@kernel";
import { SliceSpecError } from "../domain/errors/review-context.error";
import { type SliceSpec, SliceSpecPort } from "../domain/ports/slice-spec.port";

export class BeadSliceSpecAdapter extends SliceSpecPort {
  constructor(
    private readonly readSpec: (
      milestoneLabel: string,
      sliceLabel: string,
    ) => Promise<Result<string | null, Error>>,
    private readonly resolveLabels: (sliceId: string) => {
      milestoneLabel: string;
      sliceLabel: string;
      sliceTitle: string;
    },
  ) {
    super();
  }

  async getSpec(sliceId: string): Promise<Result<SliceSpec, SliceSpecError>> {
    const { milestoneLabel, sliceLabel, sliceTitle } = this.resolveLabels(sliceId);
    const readResult = await this.readSpec(milestoneLabel, sliceLabel);
    if (!readResult.ok) {
      return err(
        new SliceSpecError(`Failed to read spec for ${sliceLabel}`, {
          sliceId,
          cause: readResult.error.message,
        }),
      );
    }
    if (readResult.data === null) {
      return err(new SliceSpecError(`No spec found for ${sliceLabel}`, { sliceId }));
    }
    const specContent = readResult.data;
    const acceptanceCriteria = this.extractAC(specContent);
    return ok({ sliceId, sliceLabel, sliceTitle, specContent, acceptanceCriteria });
  }

  private extractAC(content: string): string {
    const acIndex = content.indexOf("## Acceptance Criteria");
    if (acIndex === -1) return "";
    const afterAC = content.slice(acIndex);
    const nextHeading = afterAC.indexOf("\n## ", 1);
    return nextHeading === -1 ? afterAC : afterAC.slice(0, nextHeading);
  }
}
