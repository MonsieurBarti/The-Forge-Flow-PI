import { execFileSync } from "node:child_process";
import type { MilestoneRepositoryPort } from "@hexagons/milestone";
import type { ProjectRepositoryPort } from "@hexagons/project";
import type { ExtensionAPI, ExtensionCommandContext } from "@infrastructure/pi";
import { isErr } from "@kernel";
import type { TffDispatcher } from "../../../../cli/tff-dispatcher";

export interface RepairBranchesCommandDeps {
  projectRepo: ProjectRepositoryPort;
  milestoneRepo: MilestoneRepositoryPort;
  projectRoot: string;
}

export function registerRepairBranchesCommand(
  dispatcher: TffDispatcher,
  api: ExtensionAPI,
  deps: RepairBranchesCommandDeps,
): void {
  dispatcher.register({
    name: "repair-branches",
    description: "Check and recreate missing milestone/state branches",
    handler: async (_args: string, _ctx: ExtensionCommandContext) => {
      const fixes: string[] = [];
      const warnings: string[] = [];

      // 1. Check git repo exists
      try {
        execFileSync("git", ["rev-parse", "--git-dir"], {
          cwd: deps.projectRoot,
          encoding: "utf-8",
        });
      } catch {
        api.sendUserMessage("Not a git repository. Run `git init` first.");
        return;
      }

      // 2. Check for at least one commit
      try {
        execFileSync("git", ["log", "--oneline", "-1"], {
          cwd: deps.projectRoot,
          encoding: "utf-8",
        });
      } catch {
        try {
          execFileSync("git", ["add", ".gitignore"], {
            cwd: deps.projectRoot,
            encoding: "utf-8",
          });
          execFileSync("git", ["commit", "-m", "chore: initial commit for TFF project"], {
            cwd: deps.projectRoot,
            encoding: "utf-8",
          });
          fixes.push("Created initial commit with .gitignore");
        } catch (e) {
          warnings.push(
            `Failed to create initial commit: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      // 3. Load milestones and check branches
      const projectResult = await deps.projectRepo.findSingleton();
      if (isErr(projectResult) || !projectResult.data) {
        api.sendUserMessage("No TFF project found.");
        return;
      }

      const msResult = await deps.milestoneRepo.findByProjectId(projectResult.data.id);
      if (isErr(msResult)) {
        api.sendUserMessage("Failed to load milestones.");
        return;
      }

      // Get current branch for base
      let currentBranch = "HEAD";
      try {
        currentBranch =
          execFileSync("git", ["branch", "--show-current"], {
            cwd: deps.projectRoot,
            encoding: "utf-8",
          }).trim() || "HEAD";
      } catch {
        /* use HEAD */
      }

      for (const ms of msResult.data) {
        const codeBranch = `milestone/${ms.label}`;

        // Check code branch
        try {
          execFileSync("git", ["rev-parse", "--verify", codeBranch], {
            cwd: deps.projectRoot,
            encoding: "utf-8",
          });
        } catch {
          try {
            execFileSync("git", ["branch", codeBranch, currentBranch], {
              cwd: deps.projectRoot,
              encoding: "utf-8",
            });
            fixes.push(`Created missing branch: ${codeBranch}`);
          } catch (e) {
            warnings.push(
              `Failed to create ${codeBranch}: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }

        // Check state branch
        const stateBranch = `tff-state/${codeBranch}`;
        try {
          execFileSync("git", ["rev-parse", "--verify", stateBranch], {
            cwd: deps.projectRoot,
            encoding: "utf-8",
          });
        } catch {
          warnings.push(
            `Missing state branch: ${stateBranch} (will be created on next state sync)`,
          );
        }
      }

      // 4. Report
      const lines: string[] = ["## Branch Repair Report", ""];
      if (fixes.length > 0) {
        lines.push("### Fixed");
        for (const f of fixes) lines.push(`- ${f}`);
        lines.push("");
      }
      if (warnings.length > 0) {
        lines.push("### Warnings");
        for (const w of warnings) lines.push(`- ${w}`);
        lines.push("");
      }
      if (fixes.length === 0 && warnings.length === 0) {
        lines.push("All branches OK.");
      }
      api.sendUserMessage(lines.join("\n"));
    },
  });
}
