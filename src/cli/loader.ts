#!/usr/bin/env node

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkNodeVersion, getVersion } from "./loader-utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..", "..");

const version = getVersion(packageRoot);
const firstArg = process.argv[2];

// --- Fast-path: --version ---

if (firstArg === "--version" || firstArg === "-v") {
  process.stdout.write(`${version}\n`);
  process.exit(0);
}

// --- Fast-path: --help ---

if (firstArg === "--help" || firstArg === "-h") {
  const { printHelp } = await import("./help-text.js");
  printHelp(version);
  process.exit(0);
}

// --- Node version check ---

checkNodeVersion(22);

// --- Environment setup ---

process.title = "tff";
process.env.PI_PACKAGE_DIR = packageRoot;

// --- Heavy bootstrap: delegate to PI SDK's main() ---

const extensionPath = join(__dirname, "main.js");
const { main } = await import("@mariozechner/pi-coding-agent");
await main(["--extension", extensionPath, ...process.argv.slice(2)]);
