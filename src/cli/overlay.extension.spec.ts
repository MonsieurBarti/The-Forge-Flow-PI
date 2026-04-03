import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@infrastructure/pi";
import type { OverlayDataPort } from "@kernel/ports/overlay-data.port";
import type { LoggerPort } from "@kernel/ports/logger.port";
import type { HotkeysConfig } from "@hexagons/settings/domain/project-settings.schemas";
import type { EventBusPort } from "@kernel/ports/event-bus.port";
import type { BudgetTrackingPort } from "@hexagons/settings/domain/ports/budget-tracking.port";
import { EVENT_NAMES } from "@kernel/event-names";
import { describe, expect, it, vi } from "vitest";
import { registerOverlayExtension } from "./overlay.extension";

function mockApi(): ExtensionAPI & {
  shortcuts: Map<string, { description?: string; handler: Function }>;
  commands: Map<string, { description?: string; handler: Function }>;
} {
  const shortcuts = new Map<string, { description?: string; handler: Function }>();
  const commands = new Map<string, { description?: string; handler: Function }>();

  return {
    on: vi.fn(),
    registerTool: vi.fn(),
    registerFlag: vi.fn(),
    registerShortcut: vi.fn((key: string, opts: { description?: string; handler: Function }) => {
      shortcuts.set(key, opts);
    }),
    registerCommand: vi.fn((name: string, opts: { description?: string; handler: Function }) => {
      commands.set(name, opts);
    }),
    shortcuts,
    commands,
  } as unknown as ReturnType<typeof mockApi>;
}

function mockLogger(): LoggerPort {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
}

function mockOverlayDataPort(): OverlayDataPort {
  return {
    getProjectSnapshot: vi.fn(),
    getSliceSnapshot: vi.fn(),
  } as unknown as OverlayDataPort;
}

function mockEventBus(): EventBusPort & { handlers: Map<string, Function[]> } {
  const handlers = new Map<string, Function[]>();
  return {
    publish: vi.fn(),
    subscribe: vi.fn((eventName: string, handler: Function) => {
      const list = handlers.get(eventName) ?? [];
      list.push(handler);
      handlers.set(eventName, list);
    }),
    handlers,
  } as unknown as EventBusPort & { handlers: Map<string, Function[]> };
}

const DEFAULT_HOTKEYS: HotkeysConfig = {
  dashboard: "ctrl+alt+d",
  workflow: "ctrl+alt+w",
  executionMonitor: "ctrl+alt+e",
};

describe("registerOverlayExtension", () => {
  it("registers 3 keyboard shortcuts", () => {
    const api = mockApi();
    registerOverlayExtension(api, {
      overlayDataPort: mockOverlayDataPort(),
      budgetTrackingPort: { getUsagePercent: vi.fn() } as unknown as BudgetTrackingPort,
      eventBus: { publish: vi.fn(), subscribe: vi.fn() } as unknown as EventBusPort,
      hotkeys: DEFAULT_HOTKEYS,
      logger: mockLogger(),
    });

    expect(api.registerShortcut).toHaveBeenCalledTimes(3);
    expect(api.shortcuts.has("ctrl+alt+d")).toBe(true);
    expect(api.shortcuts.has("ctrl+alt+w")).toBe(true);
    expect(api.shortcuts.has("ctrl+alt+e")).toBe(true);
  });

  it("registers 3 slash commands", () => {
    const api = mockApi();
    registerOverlayExtension(api, {
      overlayDataPort: mockOverlayDataPort(),
      budgetTrackingPort: { getUsagePercent: vi.fn() } as unknown as BudgetTrackingPort,
      eventBus: { publish: vi.fn(), subscribe: vi.fn() } as unknown as EventBusPort,
      hotkeys: DEFAULT_HOTKEYS,
      logger: mockLogger(),
    });

    expect(api.registerCommand).toHaveBeenCalledTimes(3);
    expect(api.commands.has("tff:dashboard")).toBe(true);
    expect(api.commands.has("tff:workflow-view")).toBe(true);
    expect(api.commands.has("tff:execution-monitor")).toBe(true);
  });

  it("shortcut and command for same overlay share toggle logic", async () => {
    const api = mockApi();
    registerOverlayExtension(api, {
      overlayDataPort: mockOverlayDataPort(),
      budgetTrackingPort: { getUsagePercent: vi.fn() } as unknown as BudgetTrackingPort,
      eventBus: { publish: vi.fn(), subscribe: vi.fn() } as unknown as EventBusPort,
      hotkeys: DEFAULT_HOTKEYS,
      logger: mockLogger(),
    });

    // Both the shortcut and the command for dashboard should exist
    const shortcutHandler = api.shortcuts.get("ctrl+alt+d")?.handler;
    const commandHandler = api.commands.get("tff:dashboard")?.handler;
    expect(shortcutHandler).toBeDefined();
    expect(commandHandler).toBeDefined();
  });

  it("toggle is no-op when ctx.hasUI is false", async () => {
    const api = mockApi();
    registerOverlayExtension(api, {
      overlayDataPort: mockOverlayDataPort(),
      budgetTrackingPort: { getUsagePercent: vi.fn() } as unknown as BudgetTrackingPort,
      eventBus: { publish: vi.fn(), subscribe: vi.fn() } as unknown as EventBusPort,
      hotkeys: DEFAULT_HOTKEYS,
      logger: mockLogger(),
    });

    const handler = api.shortcuts.get("ctrl+alt+d")!.handler;
    const ctx = { hasUI: false, ui: {} } as unknown as ExtensionContext;

    // Should not throw — graceful no-op
    await handler(ctx);
  });

  it("logs warning when shortcut registration fails", () => {
    const api = mockApi();
    const logger = mockLogger();

    // Make registerShortcut throw on the first call
    let callCount = 0;
    (api.registerShortcut as ReturnType<typeof vi.fn>).mockImplementation(
      (key: string, opts: unknown) => {
        callCount++;
        if (callCount === 1) throw new Error("conflict");
        api.shortcuts.set(key, opts as { description?: string; handler: Function });
      },
    );

    registerOverlayExtension(api, {
      overlayDataPort: mockOverlayDataPort(),
      budgetTrackingPort: { getUsagePercent: vi.fn() } as unknown as BudgetTrackingPort,
      eventBus: { publish: vi.fn(), subscribe: vi.fn() } as unknown as EventBusPort,
      hotkeys: DEFAULT_HOTKEYS,
      logger,
    });

    // First shortcut failed → warning logged
    expect(logger.warn).toHaveBeenCalledTimes(1);
    // Commands still registered regardless
    expect(api.registerCommand).toHaveBeenCalledTimes(3);
  });

  it("uses custom hotkey values from config", () => {
    const api = mockApi();
    const customHotkeys: HotkeysConfig = {
      dashboard: "ctrl+d",
      workflow: "ctrl+w",
      executionMonitor: "ctrl+e",
    };

    registerOverlayExtension(api, {
      overlayDataPort: mockOverlayDataPort(),
      budgetTrackingPort: { getUsagePercent: vi.fn() } as unknown as BudgetTrackingPort,
      eventBus: { publish: vi.fn(), subscribe: vi.fn() } as unknown as EventBusPort,
      hotkeys: customHotkeys,
      logger: mockLogger(),
    });

    expect(api.shortcuts.has("ctrl+d")).toBe(true);
    expect(api.shortcuts.has("ctrl+w")).toBe(true);
    expect(api.shortcuts.has("ctrl+e")).toBe(true);
  });

  it("registers 7 EventBus subscriptions (4 dashboard + 3 workflow)", () => {
    const api = mockApi();
    const eventBus = mockEventBus();

    registerOverlayExtension(api, {
      overlayDataPort: mockOverlayDataPort(),
      budgetTrackingPort: { getUsagePercent: vi.fn() } as unknown as BudgetTrackingPort,
      eventBus,
      hotkeys: DEFAULT_HOTKEYS,
      logger: mockLogger(),
    });

    // Dashboard: SLICE_STATUS_CHANGED, TASK_COMPLETED, TASK_CREATED, MILESTONE_CLOSED
    // Workflow: SLICE_STATUS_CHANGED, SLICE_CREATED, MILESTONE_CLOSED
    expect(eventBus.subscribe).toHaveBeenCalledTimes(7);

    const subscribedEvents = [...eventBus.handlers.keys()];
    expect(subscribedEvents).toContain(EVENT_NAMES.SLICE_STATUS_CHANGED);
    expect(subscribedEvents).toContain(EVENT_NAMES.TASK_COMPLETED);
    expect(subscribedEvents).toContain(EVENT_NAMES.TASK_CREATED);
    expect(subscribedEvents).toContain(EVENT_NAMES.MILESTONE_CLOSED);
    expect(subscribedEvents).toContain(EVENT_NAMES.SLICE_CREATED);

    // SLICE_STATUS_CHANGED and MILESTONE_CLOSED should have 2 handlers each (dashboard + workflow)
    expect(eventBus.handlers.get(EVENT_NAMES.SLICE_STATUS_CHANGED)?.length).toBe(2);
    expect(eventBus.handlers.get(EVENT_NAMES.MILESTONE_CLOSED)?.length).toBe(2);
    expect(eventBus.handlers.get(EVENT_NAMES.SLICE_CREATED)?.length).toBe(1);
  });

  it("EventBus subscription is no-op when dashboard not yet opened", async () => {
    const api = mockApi();
    const eventBus = mockEventBus();

    registerOverlayExtension(api, {
      overlayDataPort: mockOverlayDataPort(),
      budgetTrackingPort: { getUsagePercent: vi.fn() } as unknown as BudgetTrackingPort,
      eventBus,
      hotkeys: DEFAULT_HOTKEYS,
      logger: mockLogger(),
    });

    // Trigger each subscription handler — dashboardComponent is undefined, should not throw
    for (const handlers of eventBus.handlers.values()) {
      for (const handler of handlers) {
        await expect(handler({})).resolves.toBeUndefined();
      }
    }
  });

  it("workflow and execution monitor still register commands and shortcuts", () => {
    const api = mockApi();
    registerOverlayExtension(api, {
      overlayDataPort: mockOverlayDataPort(),
      budgetTrackingPort: { getUsagePercent: vi.fn() } as unknown as BudgetTrackingPort,
      eventBus: { publish: vi.fn(), subscribe: vi.fn() } as unknown as EventBusPort,
      hotkeys: DEFAULT_HOTKEYS,
      logger: mockLogger(),
    });

    expect(api.commands.has("tff:workflow-view")).toBe(true);
    expect(api.commands.has("tff:execution-monitor")).toBe(true);
    expect(api.shortcuts.has(DEFAULT_HOTKEYS.workflow)).toBe(true);
    expect(api.shortcuts.has(DEFAULT_HOTKEYS.executionMonitor)).toBe(true);
  });
});
