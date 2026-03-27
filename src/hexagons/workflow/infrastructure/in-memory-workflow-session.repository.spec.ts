import { faker } from "@faker-js/faker";
import { beforeEach, describe, expect, it } from "vitest";
import { WorkflowSessionBuilder } from "../domain/workflow-session.builder";
import { InMemoryWorkflowSessionRepository } from "./in-memory-workflow-session.repository";

describe("InMemoryWorkflowSessionRepository", () => {
  let repo: InMemoryWorkflowSessionRepository;

  beforeEach(() => {
    repo = new InMemoryWorkflowSessionRepository();
  });

  it("saves and finds by id", async () => {
    const session = new WorkflowSessionBuilder().build();
    const saveResult = await repo.save(session);
    expect(saveResult.ok).toBe(true);
    const findResult = await repo.findById(session.id);
    expect(findResult.ok).toBe(true);
    if (findResult.ok) {
      expect(findResult.data).not.toBeNull();
      expect(findResult.data?.id).toBe(session.id);
    }
  });

  it("finds by milestoneId", async () => {
    const milestoneId = faker.string.uuid();
    const session = new WorkflowSessionBuilder().withMilestoneId(milestoneId).build();
    await repo.save(session);
    const result = await repo.findByMilestoneId(milestoneId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).not.toBeNull();
      expect(result.data?.milestoneId).toBe(milestoneId);
    }
  });

  it("returns null for non-existent id", async () => {
    const result = await repo.findById(faker.string.uuid());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBeNull();
  });

  it("enforces one session per milestone", async () => {
    const milestoneId = faker.string.uuid();
    const session1 = new WorkflowSessionBuilder().withMilestoneId(milestoneId).build();
    const session2 = new WorkflowSessionBuilder().withMilestoneId(milestoneId).build();
    await repo.save(session1);
    const result = await repo.save(session2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("cardinality");
  });

  it("allows updating existing session (same id)", async () => {
    const session = new WorkflowSessionBuilder().build();
    await repo.save(session);
    const result = await repo.save(session);
    expect(result.ok).toBe(true);
  });
});
