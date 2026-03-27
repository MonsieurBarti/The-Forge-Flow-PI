import { DateProviderPort } from "@kernel";
import type { Slice } from "../domain/slice.aggregate";
import { InMemorySliceRepository } from "./in-memory-slice.repository";
import { WorkflowSliceTransitionAdapter } from "./workflow-slice-transition.adapter";

class StubDateProvider extends DateProviderPort {
  now(): Date {
    return new Date();
  }
}

export class InMemoryWorkflowSliceTransitionAdapter extends WorkflowSliceTransitionAdapter {
  private readonly repo: InMemorySliceRepository;

  constructor() {
    const repo = new InMemorySliceRepository();
    super(repo, new StubDateProvider());
    this.repo = repo;
  }

  seed(slice: Slice): void {
    this.repo.seed(slice);
  }

  reset(): void {
    this.repo.reset();
  }
}
