![The Forge Flow](https://raw.githubusercontent.com/MonsieurBarti/The-Forge-Flow-CC/refs/heads/main/assets/forge-banner.png)

# The Forge Flow PI

TFF-PI is a workflow orchestration extension for the PI coding agent that manages the full AI-driven software development lifecycle -- from discussion through execution, review, and shipping. Built with hexagonal architecture and Domain-Driven Design, it provides structured phases, domain events, and guard-based transitions to keep every slice of work on track.

## Prerequisites

- **Node.js** >= 22
- **PI coding agent SDK**:
  - `@mariozechner/pi-ai`
  - `@mariozechner/pi-coding-agent`
  - `@mariozechner/pi-tui`

## Installation

```bash
npm install @the-forge-flow/pi
```

Register TFF-PI as a PI extension in your project configuration. The extension hooks into the PI coding agent session and exposes workflow commands as tools the agent can invoke.

## Architecture

TFF-PI follows a strict hexagonal (ports-and-adapters) architecture with inward-only dependencies:

```
┌─────────────────────────────────────────────────┐
│                 CLI / PI SDK                     │  Composition root, overlay UI
├─────────────────────────────────────────────────┤
│              Application Layer                   │  Use cases, coordinators
├─────────────────────────────────────────────────┤
│                Domain Layer                      │  Aggregates, VOs, events, ports
├─────────────────────────────────────────────────┤
│            Infrastructure Layer                  │  Adapters, repos, PI tools
└─────────────────────────────────────────────────┘
```

### Bounded Contexts

| Context | Description |
|---------|-------------|
| **project** | Project initialization and filesystem scaffolding |
| **milestone** | Milestone lifecycle management (open/close) |
| **slice** | Slice status transitions through the workflow phases |
| **task** | Task decomposition and wave detection |
| **workflow** | Phase state machine, transition guards, and artifact I/O |
| **execution** | Agent dispatch, journaling, metrics, and worktree management |
| **review** | Code review, verification, shipping, and milestone completion |
| **settings** | Model routing, autonomy configuration, and hotkeys |
| **kernel** | Shared DDD building blocks: `AggregateRoot`, `Entity`, `ValueObject`, `DomainEvent`, `Result<T,E>` |

See [detailed design specs](docs/) for comprehensive architecture documentation.

## Usage

| Command | Description |
|---------|-------------|
| `/tff:new` | Initialize a new TFF project with vision, requirements, and first milestone |
| `/tff:status` | Show current position in the lifecycle with next step suggestion |
| `/tff:discuss` | Brainstorm and scope a slice |
| `/tff:plan` | Plan a slice with task decomposition |
| `/tff:execute` | Execute a slice with wave-based parallelism and TDD |
| `/tff:verify` | Verify acceptance criteria |
| `/tff:ship` | Create a slice PR with code review and security audit |
| `/tff:complete-milestone` | Create milestone PR, review, and merge to main |

## Contributing

1. Fork the repo and create a feature branch.
2. Follow conventional commit format: `type(scope): description`.
3. Run tests: `npm test`.
4. Run linter: `npm run lint`.
5. Respect hexagon boundaries -- domain never imports from infrastructure or CLI. Use barrel imports (`index.ts`) for cross-hexagon access.

## License

MIT -- see [LICENSE](LICENSE) for details.
