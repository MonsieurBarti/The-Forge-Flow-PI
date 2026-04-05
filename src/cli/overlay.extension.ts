import type { BudgetTrackingPort } from "@hexagons/settings/domain/ports/budget-tracking.port";
import type { HotkeysConfig } from "@hexagons/settings/domain/project-settings.schemas";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@infrastructure/pi";
import type { EventName } from "@kernel/event-names";
import { EVENT_NAMES } from "@kernel/event-names";
import type { AgentEventPort } from "@kernel/ports/agent-event.port";
import type { EventBusPort } from "@kernel/ports/event-bus.port";
import type { LoggerPort } from "@kernel/ports/logger.port";
import type { OverlayDataPort } from "@kernel/ports/overlay-data.port";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import type { KeyId, OverlayHandle } from "@mariozechner/pi-tui";
import { DashboardComponent } from "./components/dashboard.component";
import { ExecutionMonitorComponent } from "./components/execution-monitor.component";
import { WorkflowComponent } from "./components/workflow.component";

export interface OverlayExtensionDeps {
  overlayDataPort: OverlayDataPort;
  budgetTrackingPort: BudgetTrackingPort;
  eventBus: EventBusPort;
  agentEventPort: AgentEventPort;
  hotkeys: HotkeysConfig;
  logger: LoggerPort;
}

export function registerOverlayExtension(api: ExtensionAPI, deps: OverlayExtensionDeps): void {
  let dashboardHandle: OverlayHandle | undefined;
  let workflowHandle: OverlayHandle | undefined;
  let executionMonitorHandle: OverlayHandle | undefined;

  const registerSafe = (
    keyId: string,
    description: string,
    handler: (ctx: ExtensionContext) => Promise<void> | void,
  ): void => {
    try {
      api.registerShortcut(keyId as KeyId, { description, handler });
    } catch (e) {
      deps.logger.warn(`Shortcut registration failed for ${keyId} — use slash command instead`, {
        error: e,
      });
    }
  };

  // --- Dashboard ---
  let dashboardComponent: DashboardComponent | undefined;

  const toggleDashboard = async (ctx: ExtensionContext): Promise<void> => {
    if (!ctx.hasUI) return;
    if (dashboardHandle) {
      dashboardHandle.setHidden(!dashboardHandle.isHidden());
    } else {
      void ctx.ui.custom(
        (tui, _theme, _kb, _done) => {
          dashboardComponent = new DashboardComponent(
            tui,
            deps.overlayDataPort,
            deps.budgetTrackingPort,
            getMarkdownTheme(),
            2,
            1,
          );
          return dashboardComponent;
        },
        {
          overlay: true,
          overlayOptions: { anchor: "center", width: "80%" },
          onHandle: (h) => {
            dashboardHandle = h;
          },
        },
      );
    }
  };

  registerSafe(deps.hotkeys.dashboard, "Toggle TFF Status Dashboard", toggleDashboard);
  api.registerCommand("tff:dashboard", {
    description: "Toggle TFF Status Dashboard",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await toggleDashboard(ctx);
    },
  });

  // --- Workflow ---
  let workflowComponent: WorkflowComponent | undefined;

  const toggleWorkflow = async (ctx: ExtensionContext): Promise<void> => {
    if (!ctx.hasUI) return;
    if (workflowHandle) {
      workflowHandle.setHidden(!workflowHandle.isHidden());
    } else {
      void ctx.ui.custom(
        (tui, _theme, _kb, _done) => {
          workflowComponent = new WorkflowComponent(
            tui,
            deps.overlayDataPort,
            getMarkdownTheme(),
            2,
            1,
          );
          return workflowComponent;
        },
        {
          overlay: true,
          overlayOptions: { anchor: "center", width: "80%" },
          onHandle: (h) => {
            workflowHandle = h;
          },
        },
      );
    }
  };

  registerSafe(deps.hotkeys.workflow, "Toggle TFF Workflow Visualizer", toggleWorkflow);
  api.registerCommand("tff:workflow-view", {
    description: "Toggle TFF Workflow Visualizer",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await toggleWorkflow(ctx);
    },
  });

  // --- Execution Monitor ---
  let execMonitorComponent: ExecutionMonitorComponent | undefined;

  const toggleExecMonitor = async (ctx: ExtensionContext): Promise<void> => {
    if (!ctx.hasUI) return;
    if (executionMonitorHandle) {
      executionMonitorHandle.setHidden(!executionMonitorHandle.isHidden());
    } else {
      void ctx.ui.custom(
        (tui, _theme, _kb, _done) => {
          execMonitorComponent = new ExecutionMonitorComponent(
            tui,
            deps.agentEventPort,
            getMarkdownTheme(),
            2,
            1,
          );
          return execMonitorComponent;
        },
        {
          overlay: true,
          overlayOptions: { anchor: "center", width: "80%" },
          onHandle: (h) => {
            executionMonitorHandle = h;
          },
        },
      );
    }
  };

  registerSafe(deps.hotkeys.executionMonitor, "Toggle TFF Execution Monitor", toggleExecMonitor);
  api.registerCommand("tff:execution-monitor", {
    description: "Toggle TFF Execution Monitor",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await toggleExecMonitor(ctx);
    },
  });

  // --- EventBus subscriptions: refresh dashboard on relevant domain events ---
  const DASHBOARD_EVENTS: EventName[] = [
    EVENT_NAMES.SLICE_STATUS_CHANGED,
    EVENT_NAMES.TASK_COMPLETED,
    EVENT_NAMES.TASK_CREATED,
    EVENT_NAMES.MILESTONE_CLOSED,
  ];

  for (const eventName of DASHBOARD_EVENTS) {
    deps.eventBus.subscribe(eventName, async () => {
      if (dashboardComponent) {
        await dashboardComponent.refresh();
      }
    });
  }

  // --- EventBus subscriptions: refresh workflow on relevant domain events ---
  const WORKFLOW_EVENTS: EventName[] = [
    EVENT_NAMES.SLICE_STATUS_CHANGED,
    EVENT_NAMES.SLICE_CREATED,
    EVENT_NAMES.MILESTONE_CLOSED,
  ];

  for (const eventName of WORKFLOW_EVENTS) {
    deps.eventBus.subscribe(eventName, async () => {
      if (workflowComponent) {
        await workflowComponent.refresh();
      }
    });
  }
}
