import type { SliceRepositoryPort } from "@hexagons/slice";
import { SliceNotFoundError } from "@hexagons/slice";
import type { DateProviderPort, PersistenceError } from "@kernel";
import { err, isErr, ok, type Result } from "@kernel";
import type { FileIOError } from "../domain/errors/file-io.error";
import type { ArtifactFilePort } from "../domain/ports/artifact-file.port";

export interface WriteSpecInput {
  milestoneLabel: string;
  sliceLabel: string;
  sliceId: string;
  content: string;
}

export class WriteSpecUseCase {
  constructor(
    private readonly artifactFilePort: ArtifactFilePort,
    private readonly sliceRepo: SliceRepositoryPort,
    private readonly dateProvider: DateProviderPort,
  ) {}

  async execute(
    input: WriteSpecInput,
  ): Promise<Result<{ path: string }, FileIOError | SliceNotFoundError | PersistenceError>> {
    const sliceResult = await this.sliceRepo.findById(input.sliceId);
    if (isErr(sliceResult)) return sliceResult;
    if (!sliceResult.data) return err(new SliceNotFoundError(input.sliceId));

    const writeResult = await this.artifactFilePort.write(
      input.milestoneLabel,
      input.sliceLabel,
      "spec",
      input.content,
    );
    if (isErr(writeResult)) return writeResult;

    sliceResult.data.setSpecPath(writeResult.data, this.dateProvider.now());

    const saveResult = await this.sliceRepo.save(sliceResult.data);
    if (isErr(saveResult)) return saveResult;

    return ok({ path: writeResult.data });
  }
}
