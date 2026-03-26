/**
 * TFF-PI CLI entry point.
 *
 * Bootstraps a PI coding agent session with TFF extensions pre-loaded.
 * The exact PI SDK bootstrap API is documented in RESEARCH.md § 1.4.
 *
 * Currently a placeholder — PI SDK packages must be installed before
 * this file becomes fully functional. The extension wiring (extension.ts)
 * is the real composition root and is fully tested independently.
 */

// TODO: Install @mariozechner/pi-coding-agent and wire createAgentSession
// import { createAgentSession } from '@mariozechner/pi-coding-agent';
// import { createTffExtension } from './extension';
//
// const { session } = await createAgentSession({
//   cwd: process.cwd(),
//   customTools: [],  // tools registered via extension
// });
//
// After session creation, call:
// createTffExtension(session.extensionApi, { projectRoot: process.cwd() });

export { createTffExtension } from "./extension";
