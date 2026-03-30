interface RouteEntry {
  readonly pattern: RegExp;
  readonly skills: readonly string[];
}

const ROUTE_TABLE: readonly RouteEntry[] = [
  { pattern: /\/(domain|entities)\//, skills: ["hexagonal-architecture"] },
  { pattern: /\/(application|use-case)\//, skills: ["hexagonal-architecture"] },
  { pattern: /\/(infrastructure|adapters?)\//, skills: ["hexagonal-architecture"] },
  { pattern: /\.spec\.ts$/, skills: ["test-driven-development"] },
];

const BASELINE_SKILLS: readonly string[] = ["executing-plans", "commit-conventions"];
const MAX_SKILLS = 3;

const RIGID_SKILLS = new Set(["executing-plans", "commit-conventions", "test-driven-development"]);

export class DomainRouter {
  resolve(filePaths: readonly string[]): string[] {
    const matched = new Set<string>(BASELINE_SKILLS);
    for (const fp of filePaths) {
      for (const route of ROUTE_TABLE) {
        if (route.pattern.test(fp)) {
          for (const skill of route.skills) {
            matched.add(skill);
          }
        }
      }
    }
    return [...matched]
      .sort((a, b) => {
        const aRigid = RIGID_SKILLS.has(a) ? 0 : 1;
        const bRigid = RIGID_SKILLS.has(b) ? 0 : 1;
        if (aRigid !== bRigid) return aRigid - bRigid;
        return a.localeCompare(b);
      })
      .slice(0, MAX_SKILLS);
  }
}
