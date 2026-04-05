import { faker } from "@faker-js/faker";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import type { WorkflowSessionRepositoryPort } from "../domain/ports/workflow-session.repository.port";
import { WorkflowSessionBuilder } from "../domain/workflow-session.builder";
import { InMemoryWorkflowSessionRepository } from "./in-memory-workflow-session.repository";
import { SqliteWorkflowSessionRepository } from "./sqlite-workflow-session.repository";

function contractSuite(name: string, factory: () => WorkflowSessionRepositoryPort) {
  describe(name, () => {
    let repo: WorkflowSessionRepositoryPort;

    beforeEach(() => {
      repo = factory();
    });

    it("saves and finds by id (roundtrip)", async () => {
      const session = new WorkflowSessionBuilder()
        .withCurrentPhase("discussing")
        .withSliceId(faker.string.uuid())
        .build();

      const saveResult = await repo.save(session);
      expect(saveResult.ok).toBe(true);

      const findResult = await repo.findById(session.id);
      expect(findResult.ok).toBe(true);
      if (findResult.ok) {
        if (!findResult.data) throw new Error("Expected findResult.data to be defined");
        const found = findResult.data;
        expect(found.id).toBe(session.id);
        expect(found.milestoneId).toBe(session.milestoneId);
        expect(found.sliceId).toBe(session.sliceId);
        expect(found.currentPhase).toBe(session.currentPhase);
        expect(found.retryCount).toBe(session.retryCount);
        expect(found.autonomyMode).toBe(session.autonomyMode);
        expect(found.createdAt.toISOString()).toBe(session.createdAt.toISOString());
        expect(found.updatedAt.toISOString()).toBe(session.updatedAt.toISOString());
      }
    });

    it("saves and finds by id with lastEscalation", async () => {
      const session = new WorkflowSessionBuilder()
        .withCurrentPhase("executing")
        .withSliceId(faker.string.uuid())
        .build();

      // Trigger a transition to blocked to get an escalation
      const ctx = {
        complexityTier: "F-lite" as const,
        retryCount: 4,
        maxRetries: 3,
        allSlicesClosed: false,
        lastError: "build failed",
      };
      session.trigger("fail", ctx, new Date());

      const saveResult = await repo.save(session);
      expect(saveResult.ok).toBe(true);

      const findResult = await repo.findById(session.id);
      expect(findResult.ok).toBe(true);
      if (findResult.ok) {
        if (!findResult.data) throw new Error("Expected findResult.data to be defined");
        const found = findResult.data;
        expect(found.lastEscalation).not.toBeNull();
        expect(found.lastEscalation?.phase).toBe("executing");
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

    it("returns null for non-existent milestoneId", async () => {
      const result = await repo.findByMilestoneId(faker.string.uuid());
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toBeNull();
    });

    it("enforces one session per milestone (cardinality)", async () => {
      const milestoneId = faker.string.uuid();
      const session1 = new WorkflowSessionBuilder().withMilestoneId(milestoneId).build();
      const session2 = new WorkflowSessionBuilder().withMilestoneId(milestoneId).build();
      await repo.save(session1);

      const result = await repo.save(session2);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain("cardinality");
    });

    it("allows updating existing session (same id, same milestone)", async () => {
      const session = new WorkflowSessionBuilder().build();
      await repo.save(session);

      const result = await repo.save(session);
      expect(result.ok).toBe(true);
    });

    it("returns null for non-existent id", async () => {
      const result = await repo.findById(faker.string.uuid());
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toBeNull();
    });

    it("findAll returns all saved sessions", async () => {
      const s1 = new WorkflowSessionBuilder().build();
      const s2 = new WorkflowSessionBuilder().build();
      await repo.save(s1);
      await repo.save(s2);

      const result = await repo.findAll();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(2);
        const ids = result.data.map((s) => s.id);
        expect(ids).toContain(s1.id);
        expect(ids).toContain(s2.id);
      }
    });

    it("reset clears all sessions", async () => {
      const s1 = new WorkflowSessionBuilder().build();
      await repo.save(s1);

      repo.reset();

      const result = await repo.findAll();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toHaveLength(0);
    });

    it("finds session by sliceId", async () => {
      const sliceId = faker.string.uuid();
      const session = new WorkflowSessionBuilder().withSliceId(sliceId).build();
      await repo.save(session);

      const result = await repo.findBySliceId(sliceId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).not.toBeNull();
        expect(result.data?.sliceId).toBe(sliceId);
      }
    });

    it("returns null for unknown sliceId", async () => {
      const result = await repo.findBySliceId(faker.string.uuid());
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toBeNull();
    });

    it("saves and retrieves session with null milestoneId", async () => {
      const session = new WorkflowSessionBuilder().withNullMilestoneId().build();
      const saveResult = await repo.save(session);
      expect(saveResult.ok).toBe(true);

      const findResult = await repo.findById(session.id);
      expect(findResult.ok).toBe(true);
      if (findResult.ok) {
        expect(findResult.data).not.toBeNull();
        expect(findResult.data?.milestoneId).toBeNull();
      }
    });
  });
}

contractSuite(
  "InMemoryWorkflowSessionRepository (contract)",
  () => new InMemoryWorkflowSessionRepository(),
);

contractSuite("SqliteWorkflowSessionRepository (contract)", () => {
  const db = new Database(":memory:");
  return new SqliteWorkflowSessionRepository(db);
});
