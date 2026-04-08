import type { BudgetTrackingPort } from "@hexagons/settings/domain/ports/budget-tracking.port";
import type { HotkeysConfig } from "@hexagons/settings/domain/project-settings.schemas";
import type { ExtensionAPI, ExtensionContext } from "@infrastructure/pi";
import { EVENT_NAMES } from "@kernel/event-names";
import type { AgentEventPort } from "@kernel/ports/agent-event.port";
import type { EventBusPort } from "@kernel/ports/event-bus.port";
import type { LoggerPort } from "@kernel/ports/logger.port";
import type { OverlayDataPort } from "@kernel/ports/overlay-data.port";
import { describe, expect, it, vi } from "vitest";
import { registerOverlayExtension } from "./overlay.extension";
import { TffDispatcher } from "./tff-dispatcher";

type HandlerFn = (...args: unknown[]) => unknown;

function mockApi(): ExtensionAPI & {
  shortcuts: Map<string, { description?: string; handler: HandlerFn }>;
  commands: Map<string, { description?: string; handler: HandlerFn }>;
} {
  const shortcuts = new Map<string, { description?: string; handler: HandlerFn }>();
  const commands = new Map<string, { description?: string; handler: HandlerFn }>();

  return {
    on: vi.fn(),
    registerTool: vi.fn(),
    registerFlag: vi.fn(),
    registerShortcut: vi.fn((key: string, opts: { description?: string; handler: HandlerFn }) => {
      shortcuts.set(key, opts);
    }),
    registerCommand: vi.fn((name: string, opts: { description?: string; handler: HandlerFn }) => {
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

function mockAgentEventPort(): AgentEventPort {
  return {
    subscribe: vi.fn(),
    subscribeAll: vi.fn(() => () => {}),
    emit: vi.fn(),
    clear: vi.fn(),
  } as unknown as AgentEventPort;
}

function mockOverlayDataPort(): OverlayDataPort {
  return {
    getProjectSnapshot: vi.fn(),
    getSliceSnapshot: vi.fn(),
  } as unknown as OverlayDataPort;
}

function mockEventBus(): EventBusPort & { handlers: Map<string, HandlerFn[]> } {
  const handlers = new Map<string, HandlerFn[]>();
  return {
    publish: vi.fn(),
    subscribe: vi.fn((eventName: string, handler: HandlerFn) => {
      const list = handlers.get(eventName) ?? [];
      list.push(handler);
      handlers.set(eventName, list);
    }),
    handlers,
  } as unknown as EventBusPort & { handlers: Map<string, HandlerFn[]> };
}

const DEFAULT_HOTKEYS: HotkeysConfig = {
  dashboard: "ctrl+alt+d",
  workflow: "ctrl+alt+w",
  executionMonitor: "ctrl+alt+e",
};

describe("registerOverlayExtension", () => {
  it("registers 3 keyboard shortcuts", () => {
    const api = mockApi();
    registerOverlayExtension(new TffDispatcher(), api, {
      overlayDataPort: mockOverlayDataPort(),
      budgetTrackingPort: { getUsagePercent: vi.fn() } as unknown as BudgetTrackingPort,
      eventBus: { publish: vi.fn(), subscribe: vi.fn() } as unknown as EventBusPort,
      agentEventPort: mockAgentEventPort(),
      hotkeys: DEFAULT_HOTKEYS,
      logger: mockLogger(),
    });

    expect(api.registerShortcut).toHaveBeenCalledTimes(3);
    expect(api.shortcuts.has("ctrl+alt+d")).toBe(true);
    expect(api.shortcuts.has("ctrl+alt+w")).toBe(true);
    expect(api.shortcuts.has("ctrl+alt+e")).toBe(true);
  });

  it("registers 3 subcommands via dispatcher", () => {
    const api = mockApi();
    const dispatcher = new TffDispatcher();
    registerOverlayExtension(dispatcher, api, {
      overlayDataPort: mockOverlayDataPort(),
      budgetTrackingPort: { getUsagePercent: vi.fn() } as unknown as BudgetTrackingPort,
      eventBus: { publish: vi.fn(), subscribe: vi.fn() } as unknown as EventBusPort,
      agentEventPort: mockAgentEventPort(),
      hotkeys: DEFAULT_HOTKEYS,
      logger: mockLogger(),
    });

    const names = dispatcher.getSubcommands().map((s) => s.name);
    expect(names).toContain("dashboard");
    expect(names).toContain("workflow-view");
    expect(names).toContain("execution-monitor");
  });

  it("shortcut and command for same overlay share toggle logic", async () => {
    const api = mockApi();
    const dispatcher = new TffDispatcher();
    registerOverlayExtension(dispatcher, api, {
      overlayDataPort: mockOverlayDataPort(),
      budgetTrackingPort: { getUsagePercent: vi.fn() } as unknown as BudgetTrackingPort,
      eventBus: { publish: vi.fn(), subscribe: vi.fn() } as unknown as EventBusPort,
      agentEventPort: mockAgentEventPort(),
      hotkeys: DEFAULT_HOTKEYS,
      logger: mockLogger(),
    });

    // Both the shortcut and the dispatcher subcommand for dashboard should exist
    const shortcutHandler = api.shortcuts.get("ctrl+alt+d")?.handler;
    const commandEntry = dispatcher.getSubcommands().find((s) => s.name === "dashboard");
    expect(shortcutHandler).toBeDefined();
    expect(commandEntry).toBeDefined();
  });

  it("toggle is no-op when ctx.hasUI is false", async () => {
    const api = mockApi();
    registerOverlayExtension(new TffDispatcher(), api, {
      overlayDataPort: mockOverlayDataPort(),
      budgetTrackingPort: { getUsagePercent: vi.fn() } as unknown as BudgetTrackingPort,
      eventBus: { publish: vi.fn(), subscribe: vi.fn() } as unknown as EventBusPort,
      agentEventPort: mockAgentEventPort(),
      hotkeys: DEFAULT_HOTKEYS,
      logger: mockLogger(),
    });

    const handler = api.shortcuts.get("ctrl+alt+d")?.handler;
    const ctx = { hasUI: false, ui: {} } as unknown as ExtensionContext;

    // Should not throw — graceful no-op
    if (!handler) throw new Error("Expected handler to be defined");
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
        api.shortcuts.set(key, opts as { description?: string; handler: HandlerFn });
      },
    );

    const dispatcher = new TffDispatcher();
    registerOverlayExtension(dispatcher, api, {
      overlayDataPort: mockOverlayDataPort(),
      budgetTrackingPort: { getUsagePercent: vi.fn() } as unknown as BudgetTrackingPort,
      eventBus: { publish: vi.fn(), subscribe: vi.fn() } as unknown as EventBusPort,
      agentEventPort: mockAgentEventPort(),
      hotkeys: DEFAULT_HOTKEYS,
      logger,
    });

    // First shortcut failed → warning logged
    expect(logger.warn).toHaveBeenCalledTimes(1);
    // Subcommands still registered via dispatcher regardless
    expect(dispatcher.getSubcommands()).toHaveLength(3);
  });

  it("uses custom hotkey values from config", () => {
    const api = mockApi();
    const customHotkeys: HotkeysConfig = {
      dashboard: "ctrl+d",
      workflow: "ctrl+w",
      executionMonitor: "ctrl+e",
    };

    registerOverlayExtension(new TffDispatcher(), api, {
      overlayDataPort: mockOverlayDataPort(),
      budgetTrackingPort: { getUsagePercent: vi.fn() } as unknown as BudgetTrackingPort,
      eventBus: { publish: vi.fn(), subscribe: vi.fn() } as unknown as EventBusPort,
      agentEventPort: mockAgentEventPort(),
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

    registerOverlayExtension(new TffDispatcher(), api, {
      overlayDataPort: mockOverlayDataPort(),
      budgetTrackingPort: { getUsagePercent: vi.fn() } as unknown as BudgetTrackingPort,
      eventBus,
      agentEventPort: mockAgentEventPort(),
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

    registerOverlayExtension(new TffDispatcher(), api, {
      overlayDataPort: mockOverlayDataPort(),
      budgetTrackingPort: { getUsagePercent: vi.fn() } as unknown as BudgetTrackingPort,
      eventBus,
      agentEventPort: mockAgentEventPort(),
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

  it("workflow and execution monitor still register subcommands and shortcuts", () => {
    const api = mockApi();
    const dispatcher = new TffDispatcher();
    registerOverlayExtension(dispatcher, api, {
      overlayDataPort: mockOverlayDataPort(),
      budgetTrackingPort: { getUsagePercent: vi.fn() } as unknown as BudgetTrackingPort,
      eventBus: { publish: vi.fn(), subscribe: vi.fn() } as unknown as EventBusPort,
      agentEventPort: mockAgentEventPort(),
      hotkeys: DEFAULT_HOTKEYS,
      logger: mockLogger(),
    });

    const names = dispatcher.getSubcommands().map((s) => s.name);
    expect(names).toContain("workflow-view");
    expect(names).toContain("execution-monitor");
    expect(api.shortcuts.has(DEFAULT_HOTKEYS.workflow)).toBe(true);
    expect(api.shortcuts.has(DEFAULT_HOTKEYS.executionMonitor)).toBe(true);
  });
});
