import type { SliceRepositoryPort } from "@hexagons/slice";
import { SliceNotFoundError } from "@hexagons/slice";
import type { DateProviderPort, PersistenceError } from "@kernel";
import { err, isErr, ok, type Result } from "@kernel";
import type { FileIOError } from "../domain/errors/file-io.error";
import { PhaseValidationError } from "../domain/errors/phase-validation.error";
import type { ArtifactFilePort } from "../domain/ports/artifact-file.port";

export interface WriteResearchInput {
  milestoneLabel: string;
  sliceLabel: string;
  sliceId: string;
  content: string;
}

export class WriteResearchUseCase {
  constructor(
    private readonly artifactFilePort: ArtifactFilePort,
    private readonly sliceRepo: SliceRepositoryPort,
    private readonly dateProvider: DateProviderPort,
  ) {}

  async execute(
    input: WriteResearchInput,
  ): Promise<
    Result<
      { path: string },
      FileIOError | SliceNotFoundError | PersistenceError | PhaseValidationError
    >
  > {
    const sliceResult = await this.sliceRepo.findById(input.sliceId);
    if (isErr(sliceResult)) return sliceResult;
    if (!sliceResult.data) return err(new SliceNotFoundError(input.sliceId));

    if (sliceResult.data.status !== "researching") {
      return err(
        new PhaseValidationError("write research", "researching", sliceResult.data.status),
      );
    }

    const writeResult = await this.artifactFilePort.write(
      input.milestoneLabel,
      input.sliceLabel,
      "research",
      input.content,
    );
    if (isErr(writeResult)) return writeResult;

    sliceResult.data.setResearchPath(writeResult.data, this.dateProvider.now());

    const saveResult = await this.sliceRepo.save(sliceResult.data);
    if (isErr(saveResult)) return saveResult;

    return ok({ path: writeResult.data });
  }
}
