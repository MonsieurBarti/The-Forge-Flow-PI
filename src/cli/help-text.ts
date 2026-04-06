export function printHelp(version: string): void {
  process.stdout.write(`tff v${version} — The Forge Flow PI agent

Usage: tff [options] [message]

Options:
  --version, -v       Print version and exit
  --help, -h          Print this help and exit
  --model <model>     Override the default model
  --print             Non-interactive mode (print response and exit)
  --continue          Resume the most recent session
  --extension <path>  Load an additional PI extension

Environment:
  PI_PACKAGE_DIR      Override the PI SDK package directory
  TFF_CODING_AGENT_DIR  Override the agent config directory (~/.tff/agent/)

Documentation: https://github.com/MonsieurBarti/The-Forge-Flow-PI
`);
}
