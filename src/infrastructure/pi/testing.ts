/**
 * Test helpers for PI SDK type mocks.
 *
 * Provides complete mock factories that satisfy the real PI SDK interfaces
 * without requiring type casts.
 */
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { vi } from "vitest";

/**
 * Create a complete mock of ExtensionAPI.
 * Returns `{ api, fns }` — pass `api` to production code, use `fns` for assertions.
 */
export function createMockExtensionAPI() {
  const fns = {
    on: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    registerFlag: vi.fn(),
    getFlag: vi.fn(),
    registerMessageRenderer: vi.fn(),
    sendMessage: vi.fn(),
    sendUserMessage: vi.fn(),
    appendEntry: vi.fn(),
    setSessionName: vi.fn(),
    getSessionName: vi.fn(),
    setLabel: vi.fn(),
    exec: vi.fn(),
    getActiveTools: vi.fn(),
    getAllTools: vi.fn(),
    setActiveTools: vi.fn(),
    getCommands: vi.fn(),
    setModel: vi.fn(),
    getThinkingLevel: vi.fn(),
    setThinkingLevel: vi.fn(),
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
  };
  const api: ExtensionAPI = {
    ...fns,
    events: { on: vi.fn(), emit: vi.fn() },
  };
  return { api, fns };
}

/**
 * Create a deep Proxy-based mock that returns vi.fn() for any accessed method.
 * Satisfies any interface shape at runtime without type casts.
 */
function createDeepMock<T>(): T {
  const cache = new Map<string | symbol, unknown>();
  return new Proxy(Object.create(null), {
    get(_target: unknown, prop: string | symbol) {
      if (!cache.has(prop)) {
        const fn = vi.fn();
        // Nested property access returns another deep mock
        const nested = new Proxy(fn, {
          get(target: unknown, nestedProp: string | symbol) {
            if (nestedProp === "mock") return (fn as ReturnType<typeof vi.fn>).mock;
            if (typeof (target as Record<string | symbol, unknown>)[nestedProp] === "function") {
              return (target as Record<string | symbol, unknown>)[nestedProp];
            }
            return vi.fn();
          },
        });
        cache.set(prop, nested);
      }
      return cache.get(prop);
    },
  }) as T;
}

/**
 * Create a mock of ExtensionContext.
 * Uses Proxy-based deep mocking for nested SDK interfaces (ui, sessionManager, modelRegistry).
 */
export function createMockExtensionContext(overrides: { cwd?: string } = {}): ExtensionContext {
  const ctx = createDeepMock<ExtensionContext>();
  // Override specific properties that tests may inspect
  Object.defineProperty(ctx, "cwd", { value: overrides.cwd ?? "/tmp", writable: true });
  Object.defineProperty(ctx, "hasUI", { value: false, writable: true });
  Object.defineProperty(ctx, "model", { value: undefined, writable: true });
  Object.defineProperty(ctx, "signal", { value: undefined, writable: true });
  return ctx;
}

/**
 * Create a mock of ExtensionCommandContext (extends ExtensionContext with session control methods).
 * Proxy-based deep mock satisfies both ExtensionContext and ExtensionCommandContext.
 */
export function createMockExtensionCommandContext(
  overrides: { cwd?: string } = {},
): ExtensionCommandContext {
  const ctx = createDeepMock<ExtensionCommandContext>();
  Object.defineProperty(ctx, "cwd", { value: overrides.cwd ?? "/tmp", writable: true });
  Object.defineProperty(ctx, "hasUI", { value: false, writable: true });
  Object.defineProperty(ctx, "model", { value: undefined, writable: true });
  Object.defineProperty(ctx, "signal", { value: undefined, writable: true });
  return ctx;
}
