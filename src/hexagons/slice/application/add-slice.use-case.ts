import type { MilestoneRepositoryPort } from "@hexagons/milestone/domain/ports/milestone-repository.port";
import { type EventBusPort, err, ok, PersistenceError, type Result } from "@kernel";
import type { DateProviderPort } from "@kernel/ports";
import type { SliceRepositoryPort } from "../domain/ports/slice-repository.port";
import { Slice } from "../domain/slice.aggregate";

export interface AddSliceInput {
  milestoneId: string;
  title: string;
  description?: string;
  afterLabel?: string;
}

export interface AddSliceOutput {
  sliceId: string;
  sliceLabel: string;
  position: number;
}

export class AddSliceUseCase {
  constructor(
    private readonly sliceRepo: SliceRepositoryPort,
    private readonly milestoneRepo: MilestoneRepositoryPort,
    private readonly dateProvider: DateProviderPort,
    private readonly eventBus: EventBusPort,
  ) {}

  async execute(input: AddSliceInput): Promise<Result<AddSliceOutput, PersistenceError>> {
    // Retry loop handles parallel calls that race on label assignment
    const MAX_RETRIES = 8;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const result = await this.tryCreate(input);
      if (result.ok) return result;

      // Retry only on label uniqueness violations (parallel race condition)
      if (result.error.message.includes("Label uniqueness violated")) continue;
      return result;
    }
    return err(new PersistenceError("Failed to create slice after retries — label collision"));
  }

  private async tryCreate(input: AddSliceInput): Promise<Result<AddSliceOutput, PersistenceError>> {
    // 1. Load milestone, guard in_progress
    const msResult = await this.milestoneRepo.findById(input.milestoneId);
    if (!msResult.ok) return err(msResult.error);
    if (!msResult.data)
      return err(new PersistenceError(`Milestone not found: ${input.milestoneId}`));
    if (msResult.data.status !== "in_progress") {
      return err(
        new PersistenceError(`Milestone must be in_progress, got: ${msResult.data.status}`),
      );
    }

    // 2. Get existing slices for this milestone
    const slicesResult = await this.sliceRepo.findByMilestoneId(input.milestoneId);
    if (!slicesResult.ok) return err(slicesResult.error);
    const existing = slicesResult.data;

    // 3. Compute next label
    const msLabel = msResult.data.label;
    const maxSuffix = existing.reduce((max, s) => {
      const match = s.label.match(/^M\d+-S(\d+)$/);
      return match ? Math.max(max, Number.parseInt(match[1], 10)) : max;
    }, 0);
    const nextSuffix = String(maxSuffix + 1).padStart(2, "0");
    const sliceLabel = `${msLabel}-S${nextSuffix}`;

    // 4. Compute position
    let position: number;
    if (input.afterLabel) {
      const target = existing.find((s) => s.label === input.afterLabel);
      if (!target) {
        return err(new PersistenceError(`Slice not found: ${input.afterLabel}`));
      }
      position = target.position + 1;

      // Shift downstream slices
      for (const s of existing) {
        if (s.position >= position) {
          const props = s.toJSON();
          props.position = props.position + 1;
          const shifted = Slice.reconstitute(props);
          const saveResult = await this.sliceRepo.save(shifted);
          if (!saveResult.ok) return err(saveResult.error);
        }
      }
    } else {
      const maxPos = existing.reduce((max, s) => Math.max(max, s.position), -1);
      position = maxPos + 1;
    }

    // 5. Create and save slice
    const id = crypto.randomUUID();
    const slice = Slice.createNew({
      id,
      milestoneId: input.milestoneId,
      label: sliceLabel,
      title: input.title,
      description: input.description,
      kind: "milestone",
      position,
      now: this.dateProvider.now(),
    });

    const saveResult = await this.sliceRepo.save(slice);
    if (!saveResult.ok) return err(saveResult.error);

    for (const event of slice.pullEvents()) {
      await this.eventBus.publish(event);
    }

    return ok({ sliceId: id, sliceLabel, position });
  }
}
