import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Milestone } from "@hexagons/milestone/domain/milestone.aggregate";
import { InMemoryMilestoneRepository } from "@hexagons/milestone/infrastructure/in-memory-milestone.repository";
import { Slice } from "@hexagons/slice/domain/slice.aggregate";
import { InMemorySliceRepository } from "@hexagons/slice/infrastructure/in-memory-slice.repository";
import { isErr, isOk } from "@kernel";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MilestoneQueryAdapter } from "./milestone-query.adapter";

describe("MilestoneQueryAdapter", () => {
  const now = new Date("2026-04-01T00:00:00Z");
  const milestoneId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const sliceId1 = crypto.randomUUID();
  const sliceId2 = crypto.randomUUID();
  let sliceRepo: InMemorySliceRepository;
  let milestoneRepo: InMemoryMilestoneRepository;
  let tmpDir: string;
  let adapter: MilestoneQueryAdapter;

  beforeEach(() => {
    sliceRepo = new InMemorySliceRepository();
    milestoneRepo = new InMemoryMilestoneRepository();
    tmpDir = join(tmpdir(), `milestone-query-test-${crypto.randomUUID()}`);
    mkdirSync(tmpDir, { recursive: true });
    adapter = new MilestoneQueryAdapter(sliceRepo, milestoneRepo, tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("getSliceStatuses", () => {
    it("returns statuses from slice repo when slices exist", async () => {
      const s1 = Slice.createNew({
        id: sliceId1,
        milestoneId: milestoneId,
        label: "M05-S01",
        title: "First slice",
        now,
      });
      const s2 = Slice.createNew({
        id: sliceId2,
        milestoneId: milestoneId,
        label: "M05-S02",
        title: "Second slice",
        now,
      });
      sliceRepo.seed(s1);
      sliceRepo.seed(s2);

      const result = await adapter.getSliceStatuses(milestoneId);

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.data).toHaveLength(2);
      expect(result.data).toEqual(
        expect.arrayContaining([
          { sliceId: sliceId1, sliceLabel: "M05-S01", status: "discussing" },
          { sliceId: sliceId2, sliceLabel: "M05-S02", status: "discussing" },
        ]),
      );
    });

    it("returns empty array when no slices found", async () => {
      const result = await adapter.getSliceStatuses(crypto.randomUUID());

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.data).toEqual([]);
    });
  });

  describe("getMilestoneStatus", () => {
    it("returns milestone status string", async () => {
      const milestone = Milestone.createNew({
        id: milestoneId,
        projectId: projectId,
        label: "M05",
        title: "Review and Ship",
        now,
      });
      milestoneRepo.seed(milestone);

      const result = await adapter.getMilestoneStatus(milestoneId);

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.data).toBe("open");
    });

    it("returns MilestoneQueryError.notFound when milestone does not exist", async () => {
      const result = await adapter.getMilestoneStatus(crypto.randomUUID());

      expect(isErr(result)).toBe(true);
      if (!isErr(result)) return;
      expect(result.error.code).toBe("MILESTONE_QUERY.NOT_FOUND");
    });
  });

  describe("getRequirementsContent", () => {
    it("reads file from correct path", async () => {
      const milestoneDir = join(tmpDir, ".tff", "milestones", "M05");
      mkdirSync(milestoneDir, { recursive: true });
      writeFileSync(join(milestoneDir, "REQUIREMENTS.md"), "# Requirements\nDone.");

      const result = await adapter.getRequirementsContent("M05");

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.data).toBe("# Requirements\nDone.");
    });

    it("returns error when file does not exist", async () => {
      const result = await adapter.getRequirementsContent("M99");

      expect(isErr(result)).toBe(true);
      if (!isErr(result)) return;
      expect(result.error.code).toBe("MILESTONE_QUERY.QUERY_FAILED");
    });
  });
});
