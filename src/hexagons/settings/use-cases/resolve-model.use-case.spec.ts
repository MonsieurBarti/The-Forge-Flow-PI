import { isOk, ok, type Result } from "@kernel";
import { describe, expect, it } from "vitest";
import { BudgetTrackingPort } from "../domain/ports/budget-tracking.port";
import { ProjectSettingsBuilder } from "../domain/project-settings.builder";
import { ResolveModelUseCase } from "./resolve-model.use-case";

// Helper: budget adapter that returns a fixed percentage
class FixedBudgetAdapter extends BudgetTrackingPort {
  constructor(private readonly percent: number) {
    super();
  }
  async getUsagePercent(): Promise<Result<number, never>> {
    return ok(this.percent);
  }
}

describe("ResolveModelUseCase", () => {
  const defaultSettings = new ProjectSettingsBuilder().build();

  describe("complexity tier mapping (AC4)", () => {
    const useCase = new ResolveModelUseCase(new FixedBudgetAdapter(0));

    it("S complexity → budget profile → default", async () => {
      const result = await useCase.execute({
        phase: "execute",
        complexity: "S",
        settings: defaultSettings,
      });
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.data).toBe("default");
    });

    it("F-lite complexity → balanced profile → default", async () => {
      const result = await useCase.execute({
        phase: "execute",
        complexity: "F-lite",
        settings: defaultSettings,
      });
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.data).toBe("default");
    });

    it("F-full complexity → quality profile → default", async () => {
      const result = await useCase.execute({
        phase: "execute",
        complexity: "F-full",
        settings: defaultSettings,
      });
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.data).toBe("default");
    });
  });

  describe("budget enforcement (AC5)", () => {
    it("at 50% budget, F-full downshifts to balanced → default", async () => {
      const useCase = new ResolveModelUseCase(new FixedBudgetAdapter(50));
      const result = await useCase.execute({
        phase: "execute",
        complexity: "F-full",
        settings: defaultSettings,
      });
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.data).toBe("default");
    });

    it("at 75% budget, F-full downshifts to budget → default", async () => {
      const useCase = new ResolveModelUseCase(new FixedBudgetAdapter(75));
      const result = await useCase.execute({
        phase: "execute",
        complexity: "F-full",
        settings: defaultSettings,
      });
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.data).toBe("default");
    });

    it("at 75% budget, S (already budget) → no further downshift", async () => {
      const useCase = new ResolveModelUseCase(new FixedBudgetAdapter(75));
      const result = await useCase.execute({
        phase: "execute",
        complexity: "S",
        settings: defaultSettings,
      });
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.data).toBe("default");
    });
  });

  describe("fallback chains (AC6)", () => {
    const useCase = new ResolveModelUseCase(new FixedBudgetAdapter(0));
    const settingsWithFallback = new ProjectSettingsBuilder()
      .withModelRouting({
        profiles: {
          quality: { model: "opus", fallbackChain: ["sonnet", "haiku"] },
          balanced: { model: "sonnet", fallbackChain: ["haiku"] },
          budget: { model: "sonnet", fallbackChain: [] },
        },
        complexityMapping: { S: "budget", "F-lite": "balanced", "F-full": "quality" },
      })
      .build();

    it("walks fallbackChain when resolved model is unavailable", async () => {
      const result = await useCase.execute({
        phase: "execute",
        complexity: "F-full",
        settings: settingsWithFallback,
        unavailableModels: ["opus"],
      });
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.data).toBe("sonnet");
    });

    it("returns last chain entry when entire chain exhausted", async () => {
      const result = await useCase.execute({
        phase: "execute",
        complexity: "F-full",
        settings: settingsWithFallback,
        unavailableModels: ["opus", "sonnet"],
      });
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.data).toBe("haiku");
    });
  });

  describe("phase overrides (AC7)", () => {
    const useCase = new ResolveModelUseCase(new FixedBudgetAdapter(0));
    const settingsWithPhaseOverride = new ProjectSettingsBuilder()
      .withModelRouting({
        profiles: {
          quality: { model: "opus", fallbackChain: [] },
          balanced: { model: "sonnet", fallbackChain: [] },
          budget: { model: "sonnet", fallbackChain: [] },
        },
        complexityMapping: { S: "budget", "F-lite": "balanced", "F-full": "quality" },
        phaseOverrides: { review: "budget" },
      })
      .build();

    it("phase override overrides complexity-based profile", async () => {
      const result = await useCase.execute({
        phase: "review",
        complexity: "F-full",
        settings: settingsWithPhaseOverride,
      });
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.data).toBe("sonnet");
    });

    it("other phases are not affected by override", async () => {
      const result = await useCase.execute({
        phase: "execute",
        complexity: "F-full",
        settings: settingsWithPhaseOverride,
      });
      expect(isOk(result)).toBe(true);
      if (isOk(result)) expect(result.data).toBe("opus");
    });
  });
});
