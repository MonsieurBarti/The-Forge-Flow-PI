# Research — M06-S06: Execution Monitor Overlay

## U1: Is `_agentEventHub` wired to the execution engine?

**Answer: No.** `_agentEventHub` is created at `extension.ts:99` but never passed to any adapter or use case. Events are never emitted to it.

### Root cause

All `PiAgentDispatchAdapter` instances in `extension.ts` are constructed without `agentEventPort`:

```typescript
// These three never emit to agentEventHub:
const piFixerAdapter = new PiFixerAdapter(new PiAgentDispatchAdapter(), ...);
const conductReviewUseCase = new ConductReviewUseCase(..., new PiAgentDispatchAdapter(), ...);
const verifyUseCase = new VerifyAcceptanceCriteriaUseCase(..., new PiAgentDispatchAdapter(), ...);
```

`PiAgentDispatchAdapter` already supports an optional `agentEventPort` dep (already implemented in M06-S02). It simply needs to be passed.

### Fix: one shared dispatch adapter

Create a single `PiAgentDispatchAdapter` with the hub, share it across all three call sites:

```typescript
// extension.ts (rename + wire):
const agentEventHub = new InMemoryAgentEventHub();  // was: const _agentEventHub
const sharedAgentDispatch = new PiAgentDispatchAdapter({ agentEventPort: agentEventHub });

// Then replace all three `new PiAgentDispatchAdapter()` with sharedAgentDispatch:
const piFixerAdapter = new PiFixerAdapter(sharedAgentDispatch, ...);
const conductReviewUseCase = new ConductReviewUseCase(..., sharedAgentDispatch, ...);
const verifyUseCase = new VerifyAcceptanceCriteriaUseCase(..., sharedAgentDispatch, ...);
```

All three accept `AgentDispatchPort` (abstract), not the concrete type — so swapping the instance is safe with no signature changes.

### What the monitor will capture

Since `ExecuteSliceUseCase` is a stub in M06 ("use TFF workflow"), the programmatic execution path is not active. The Execution Monitor will capture events from:
- **Code review agents** (`ConductReviewUseCase` → `sharedAgentDispatch`)  
- **Fixer agents** (`PiFixerAdapter` → `sharedAgentDispatch`)
- **Verification agents** (`VerifyAcceptanceCriteriaUseCase` → `sharedAgentDispatch`)

These are the real agent dispatches that happen during `/tff:ship` and `/tff:verify`. The monitor is functional for these even with the execution stub.

---

## U2: Does `subscribeAll()` need to notify listeners added after events start?

**Answer: No.** The `subscribeAll()` call happens in `ExecutionMonitorComponent`'s constructor, which is called when the overlay is first opened (inside `ctx.ui.custom()`). The subscription is established once and lives for the process lifetime. Late subscription is not a concern because:
- The component is created lazily (first open)
- Events that arrived before the overlay was opened are not accessible (no replay)
- This matches the expected UX: the monitor shows the current/next execution, not history

**Impact on SPEC:** No change needed. The SPEC's idle state ("Waiting for execution…" or "Last run") already handles the case where the component is opened mid-execution or after completion.

---

## U3: SPEC scope gap — dispatch wiring is missing

The SPEC's "DI Wiring" section says:
> "Rename `_agentEventHub`, pass to overlay deps"

But this is insufficient — renaming alone does not cause events to flow through the hub. The spec must also cover replacing the three anonymous `new PiAgentDispatchAdapter()` instances with a shared adapter that has `agentEventPort` set.

**Required SPEC update:** Add a `sharedAgentDispatch` step to the DI Wiring section.

**Additional files affected:**

| File | Action | Reason |
|---|---|---|
| `src/cli/extension.ts` | Modify (expanded) | Create `sharedAgentDispatch`, replace 3 dispatch adapter instances |

No new files. The file count in the SPEC (7 files, 2 new, 5 modified) remains the same.

---

## U4: Architecture check — is sharing a single `PiAgentDispatchAdapter` safe?

`PiAgentDispatchAdapter` maintains `private readonly running = new Map<string, AgentSession>()` to track in-flight sessions. Sharing across use cases means all concurrent agent sessions share this map.

**Risk assessment:** Low. Each session is keyed by `config.taskId` (UUID). Different use cases use different taskIds. No collision possible unless the same taskId is dispatched twice simultaneously, which the application logic prevents.

**Conclusion:** Safe to share.

---

## Summary of SPEC Changes Required

| Finding | SPEC Change |
|---------|-------------|
| `_agentEventHub` not wired to dispatch | Add `sharedAgentDispatch` creation + replacement of 3 adapter instances to DI Wiring section |
| SPEC is otherwise complete | No other changes needed |
