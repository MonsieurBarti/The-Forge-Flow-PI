/**
 * Minimal bootstrap for post-checkout hook invocation.
 *
 * Called by .git/hooks/post-checkout via:
 *   node -e "require('./node_modules/.tff-restore.js')" 2>/dev/null || true
 *
 * This is an optimization — the BranchConsistencyGuard is the primary safety net.
 * If this script fails (missing deps, wrong path, etc.), the guard catches the
 * mismatch on the next TFF command.
 *
 * Full implementation deferred — requires build pipeline to produce
 * node_modules/.tff-restore.js artifact.
 */
export async function restoreOnCheckout(): Promise<void> {
  // Placeholder — see BranchConsistencyGuard for the active restore path
}
