import type { OverlayHandle } from "@mariozechner/pi-tui";
import { Box, Text } from "@mariozechner/pi-tui";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@infrastructure/pi";
import type { OverlayDataPort } from "@kernel/ports/overlay-data.port";
import type { LoggerPort } from "@kernel/ports/logger.port";
import type { HotkeysConfig } from "@hexagons/settings/domain/project-settings.schemas";

export interface OverlayExtensionDeps {
  overlayDataPort: OverlayDataPort;
  hotkeys: HotkeysConfig;
  logger: LoggerPort;
}

export function registerOverlayExtension(
  api: ExtensionAPI,
  deps: OverlayExtensionDeps,
): void {
  let dashboardHandle: OverlayHandle | undefined;
  let workflowHandle: OverlayHandle | undefined;
  let executionMonitorHandle: OverlayHandle | undefined;

  const toggleOverlay = async (
    ctx: ExtensionContext,
    handle: OverlayHandle | undefined,
    name: string,
    setHandle: (h: OverlayHandle) => void,
  ): Promise<void> => {
    if (!ctx.hasUI) return;
    if (handle) {
      handle.setHidden(!handle.isHidden());
    } else {
      void ctx.ui.custom(
        (_tui, _theme, _kb, _done) => {
          const box = new Box(2, 1);
          box.addChild(new Text(`${name} (placeholder — content in S04-S06)`));
          return box;
        },
        {
          overlay: true,
          overlayOptions: { anchor: "center", width: "80%" },
          onHandle: setHandle,
        },
      );
    }
  };

  const registerSafe = (
    keyId: string,
    description: string,
    handler: (ctx: ExtensionContext) => Promise<void> | void,
  ): void => {
    try {
      api.registerShortcut(keyId, { description, handler });
    } catch (e) {
      deps.logger.warn(
        `Shortcut registration failed for ${keyId} — use slash command instead`,
        { error: e },
      );
    }
  };

  // --- Dashboard ---
  const toggleDashboard = (ctx: ExtensionContext): Promise<void> =>
    toggleOverlay(ctx, dashboardHandle, "Status Dashboard", (h) => {
      dashboardHandle = h;
    });

  registerSafe(deps.hotkeys.dashboard, "Toggle TFF Status Dashboard", toggleDashboard);
  api.registerCommand("tff:dashboard", {
    description: "Toggle TFF Status Dashboard",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await toggleDashboard(ctx);
    },
  });

  // --- Workflow ---
  const toggleWorkflow = (ctx: ExtensionContext): Promise<void> =>
    toggleOverlay(ctx, workflowHandle, "Workflow Visualizer", (h) => {
      workflowHandle = h;
    });

  registerSafe(deps.hotkeys.workflow, "Toggle TFF Workflow Visualizer", toggleWorkflow);
  api.registerCommand("tff:workflow-view", {
    description: "Toggle TFF Workflow Visualizer",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await toggleWorkflow(ctx);
    },
  });

  // --- Execution Monitor ---
  const toggleExecMonitor = (ctx: ExtensionContext): Promise<void> =>
    toggleOverlay(ctx, executionMonitorHandle, "Execution Monitor", (h) => {
      executionMonitorHandle = h;
    });

  registerSafe(deps.hotkeys.executionMonitor, "Toggle TFF Execution Monitor", toggleExecMonitor);
  api.registerCommand("tff:execution-monitor", {
    description: "Toggle TFF Execution Monitor",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await toggleExecMonitor(ctx);
    },
  });
}
