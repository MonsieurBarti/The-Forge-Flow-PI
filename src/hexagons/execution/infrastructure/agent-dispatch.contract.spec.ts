import { isErr, isOk } from "@kernel";
import { AgentDispatchConfigBuilder } from "@kernel/agents";
import { beforeEach, describe, expect, it } from "vitest";
import { AgentDispatchError } from "../domain/errors/agent-dispatch.error";
import type { AgentDispatchPort } from "../domain/ports/agent-dispatch.port";

const TASK_1 = "00000000-0000-4000-a000-000000000001";
const TASK_2 = "00000000-0000-4000-a000-000000000002";
const NONEXISTENT = "00000000-0000-4000-a000-ffffffffffff";

export interface TestConfigurator {
  /** Pre-configure a successful result for a taskId */
  givenSuccess(taskId: string): void;
  /** Pre-configure a failed result for a taskId */
  givenFailure(taskId: string, error: AgentDispatchError): void;
  /** Pre-configure a delayed result (for abort testing) */
  givenDelayed(taskId: string, delayMs: number): void;
  /** Reset adapter state */
  reset(): void;
}

export function runContractTests(
  name: string,
  factory: () => { adapter: AgentDispatchPort; configurator: TestConfigurator },
) {
  describe(`${name} contract`, () => {
    let adapter: AgentDispatchPort;
    let configurator: TestConfigurator;

    beforeEach(() => {
      const f = factory();
      adapter = f.adapter;
      configurator = f.configurator;
      configurator.reset();
    });

    describe("dispatch", () => {
      it("returns ok result for successful dispatch", async () => {
        const config = new AgentDispatchConfigBuilder().withTaskId(TASK_1).build();
        configurator.givenSuccess(TASK_1);
        const result = await adapter.dispatch(config);
        expect(isOk(result)).toBe(true);
        if (isOk(result)) {
          expect(result.data.taskId).toBe(TASK_1);
          expect(result.data.success).toBe(true);
        }
      });

      it("returns error result for failed dispatch", async () => {
        const config = new AgentDispatchConfigBuilder().withTaskId(TASK_1).build();
        configurator.givenFailure(TASK_1, AgentDispatchError.unexpectedFailure(TASK_1, "boom"));
        const result = await adapter.dispatch(config);
        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe("AGENT_DISPATCH.UNEXPECTED_FAILURE");
        }
      });

      it("creates isolated sessions — no bleed between tasks (AC1)", async () => {
        const config1 = new AgentDispatchConfigBuilder().withTaskId(TASK_1).build();
        const config2 = new AgentDispatchConfigBuilder().withTaskId(TASK_2).build();
        configurator.givenSuccess(TASK_1);
        configurator.givenSuccess(TASK_2);

        const result1 = await adapter.dispatch(config1);
        const result2 = await adapter.dispatch(config2);

        expect(isOk(result1)).toBe(true);
        expect(isOk(result2)).toBe(true);
        if (isOk(result1) && isOk(result2)) {
          expect(result1.data.taskId).toBe(TASK_1);
          expect(result2.data.taskId).toBe(TASK_2);
        }
      });

      it("includes cost tracking data in result (AC2)", async () => {
        const config = new AgentDispatchConfigBuilder().withTaskId(TASK_1).build();
        configurator.givenSuccess(TASK_1);
        const result = await adapter.dispatch(config);
        expect(isOk(result)).toBe(true);
        if (isOk(result)) {
          expect(result.data.cost.provider).toBeTruthy();
          expect(result.data.cost.modelId).toBeTruthy();
          expect(result.data.cost.inputTokens).toBeGreaterThanOrEqual(0);
          expect(result.data.cost.outputTokens).toBeGreaterThanOrEqual(0);
          expect(result.data.cost.costUsd).toBeGreaterThanOrEqual(0);
        }
      });

      it("includes duration in result", async () => {
        const config = new AgentDispatchConfigBuilder().withTaskId(TASK_1).build();
        configurator.givenSuccess(TASK_1);
        const result = await adapter.dispatch(config);
        expect(isOk(result)).toBe(true);
        if (isOk(result)) {
          expect(result.data.durationMs).toBeGreaterThanOrEqual(0);
        }
      });
    });

    describe("abort", () => {
      it("aborts a running agent by taskId (AC3)", async () => {
        const config = new AgentDispatchConfigBuilder().withTaskId(TASK_1).build();
        configurator.givenDelayed(TASK_1, 5000);

        const dispatchPromise = adapter.dispatch(config);
        // Wait a tick for dispatch to start
        await new Promise((r) => setTimeout(r, 10));
        expect(adapter.isRunning(TASK_1)).toBe(true);

        await adapter.abort(TASK_1);
        const result = await dispatchPromise;
        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe("AGENT_DISPATCH.SESSION_ABORTED");
        }
      });

      it("is no-op for unknown taskId", async () => {
        await expect(adapter.abort(NONEXISTENT)).resolves.toBeUndefined();
      });

      it("isRunning returns false after abort", async () => {
        const config = new AgentDispatchConfigBuilder().withTaskId(TASK_1).build();
        configurator.givenDelayed(TASK_1, 5000);

        const dispatchPromise = adapter.dispatch(config);
        await new Promise((r) => setTimeout(r, 10));
        await adapter.abort(TASK_1);
        await dispatchPromise;

        expect(adapter.isRunning(TASK_1)).toBe(false);
      });
    });

    describe("isRunning", () => {
      it("returns true while agent is dispatched (AC4)", async () => {
        const config = new AgentDispatchConfigBuilder().withTaskId(TASK_1).build();
        configurator.givenDelayed(TASK_1, 5000);

        const dispatchPromise = adapter.dispatch(config);
        await new Promise((r) => setTimeout(r, 10));
        expect(adapter.isRunning(TASK_1)).toBe(true);

        await adapter.abort(TASK_1);
        await dispatchPromise;
      });

      it("returns false after agent completes", async () => {
        const config = new AgentDispatchConfigBuilder().withTaskId(TASK_1).build();
        configurator.givenSuccess(TASK_1);
        await adapter.dispatch(config);
        expect(adapter.isRunning(TASK_1)).toBe(false);
      });

      it("returns false for never-dispatched taskId", () => {
        expect(adapter.isRunning(NONEXISTENT)).toBe(false);
      });
    });
  });
}
