import { isErr, isOk } from "@kernel";
import { beforeEach, describe, expect, it } from "vitest";
import type { ProjectRepositoryPort } from "../domain/ports/project-repository.port";
import { ProjectBuilder } from "../domain/project.builder";
import { InMemoryProjectRepository } from "./in-memory-project.repository";

function runContractTests(name: string, factory: () => ProjectRepositoryPort & { reset(): void }) {
  describe(`${name} contract`, () => {
    let repo: ProjectRepositoryPort & { reset(): void };

    beforeEach(() => {
      repo = factory();
      repo.reset();
    });

    it("save + findById roundtrip", async () => {
      const project = new ProjectBuilder().build();
      const saveResult = await repo.save(project);
      expect(isOk(saveResult)).toBe(true);

      const findResult = await repo.findById(project.id);
      expect(isOk(findResult)).toBe(true);
      if (isOk(findResult)) {
        expect(findResult.data).not.toBeNull();
        expect(findResult.data?.id).toBe(project.id);
        expect(findResult.data?.name).toBe(project.name);
        expect(findResult.data?.vision).toBe(project.vision);
      }
    });

    it("findSingleton returns null when empty", async () => {
      const result = await repo.findSingleton();
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toBeNull();
      }
    });

    it("findSingleton returns project after save", async () => {
      const project = new ProjectBuilder().build();
      await repo.save(project);

      const result = await repo.findSingleton();
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).not.toBeNull();
        expect(result.data?.id).toBe(project.id);
      }
    });

    it("save rejects when a different project already exists", async () => {
      const project1 = new ProjectBuilder().withName("Project 1").build();
      const project2 = new ProjectBuilder().withName("Project 2").build();

      await repo.save(project1);
      const result = await repo.save(project2);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain("singleton");
      }
    });

    it("save allows updating the same project", async () => {
      const project = new ProjectBuilder().build();
      await repo.save(project);

      project.updateVision("Updated vision", new Date());
      const result = await repo.save(project);
      expect(isOk(result)).toBe(true);
    });

    it("findById returns null for unknown id", async () => {
      const result = await repo.findById(crypto.randomUUID());
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.data).toBeNull();
      }
    });
  });
}

runContractTests("InMemoryProjectRepository", () => new InMemoryProjectRepository());
