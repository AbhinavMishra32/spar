# Practice AI

Practice AI is a macOS-first personalized coding gym. A single Training Agent chooses evidence-driven exercises, observes complete attempts, and maintains a durable learner model that survives every session.

## Architecture

- `apps/desktop`: Electron, React, secure preload bridge, utility-process agent and execution runtimes.
- `apps/api`: authenticated Fastify backend for canonical learning history and checkpoint synchronization.
- `packages/domain`: shared domain contracts and validation.
- `packages/database`: PostgreSQL schema and migrations.
- `packages/provider`: provider-neutral streaming and tool-call normalization adapted from Construct.

The renderer is sandboxed and cannot access Node.js. The main process owns permissions and persistence coordination. The Training Agent and untrusted programs run in separate utility processes.

## Development

```bash
corepack pnpm install
corepack pnpm dev
```

Copy `.env.example` to `.env` for cloud sync. The desktop app remains usable offline and syncs local checkpoints after authentication.

