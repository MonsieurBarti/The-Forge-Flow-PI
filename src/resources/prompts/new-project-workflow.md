## New Project Workflow

**CRITICAL: NEVER run `git merge` or `git push` directly. Merges happen ONLY via `/tff ship`.**

Follow these steps in order:

**Step 1 — Understand the project**
Ask the user about their project: what are they building? What's the tech stack?
If there's existing code in the repo, read key files to understand the codebase.

**Step 2 — Propose name and vision**
Based on the discussion, propose a project name and a 1-2 sentence vision statement.
Ask the user to confirm or adjust.

**Step 3 — Initialize**
Once confirmed, call `tff_init_project` with the approved name and vision.

**Step 4 — Next**
After init, suggest `/tff new-milestone` to create the first milestone.
Do NOT create milestones automatically — wait for the user to invoke the command.
