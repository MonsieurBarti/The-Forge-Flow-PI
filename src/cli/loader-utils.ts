import { readFileSync } from "node:fs";
import { join } from "node:path";

export function getVersion(root: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
    return (pkg.version as string) || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function checkNodeVersion(minMajor: number): void {
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (nodeMajor < minMajor) {
    const red = "\x1b[31m";
    const bold = "\x1b[1m";
    const dim = "\x1b[2m";
    const reset = "\x1b[0m";
    process.stderr.write(
      `\n${red}${bold}Error:${reset} tff requires Node.js >= ${minMajor}.0.0\n` +
        `       You are running Node.js ${process.versions.node}\n\n` +
        `${dim}Install a supported version:${reset}\n` +
        `  nvm install ${minMajor}   ${dim}# if using nvm${reset}\n` +
        `  fnm install ${minMajor}   ${dim}# if using fnm${reset}\n` +
        `  brew install node@${minMajor} ${dim}# macOS Homebrew${reset}\n\n`,
    );
    process.exit(1);
  }
}
