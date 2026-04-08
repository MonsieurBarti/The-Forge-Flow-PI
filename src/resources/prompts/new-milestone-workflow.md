## New Milestone Workflow

**CRITICAL: NEVER run `git merge` or `git push` directly. Merges happen ONLY via `/tff ship`.**

IMPORTANT: Follow these steps IN ORDER. Do NOT skip ahead.

**Step 1 — Milestone scope**
Ask the user: What is this milestone about? What's the goal?
Discuss until the scope is clear. Propose a milestone title.

**Step 2 — Requirements gathering**
Ask the user to describe the requirements for this milestone.
For each requirement, discuss:
- What problem does it solve?
- What are the acceptance criteria?
- What are the constraints?
Compile the requirements into a clear document.

**Step 3 — Create milestone**
Once requirements are gathered and confirmed by the user,
call `tff_create_milestone` with the title, description, AND the compiled requirements.
Do NOT call this tool before discussing requirements with the user.

**Step 4 — Slice decomposition**
Propose how to break the milestone into 3-8 slices.
Each slice should be a coherent, reviewable unit of work.
Present as a numbered list with title and brief description.
Ask the user to approve, adjust, or add/remove slices.

**Step 5 — Create slices**
Only after the user approves the breakdown:
Call `tff_add_slice` for each approved slice using the milestoneId from step 3.
Use descriptive titles (e.g., 'Authentication & JWT Setup'), NOT labels.

**Step 6 — Summary and next**
Show the milestone structure and suggest `/tff discuss` to begin scoping the first slice.
