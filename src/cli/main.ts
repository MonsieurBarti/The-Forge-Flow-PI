/**
 * TFF-PI extension entry point.
 *
 * - Named export: for programmatic usage
 * - Default export: required by PI SDK for auto-discovery from .pi/extensions/
 *   (exception to project's named-export convention — PI SDK mandates default export)
 *
 * Bootstrap (createAgentSession) lives in loader.ts (M08-S06).
 */
import type { ExtensionAPI } from "@infrastructure/pi";
import { createTffExtension } from "./extension";

export type { TffExtensionOptions } from "./extension";
export { createTffExtension };

// PI auto-discovery requires a default export — see pi-mono/packages/coding-agent/src/core/extensions/
export default function (pi: ExtensionAPI) {
  createTffExtension(pi, { projectRoot: process.cwd() });
}
