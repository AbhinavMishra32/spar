# Spar

Spar is a macOS-first, adaptive coding gym. It turns a learner's goal and attempt history into runnable programming challenges, records evidence from each attempt, and maintains a durable model of what the learner can do.

**Current release:** `v0.0.1`

## What ships in v0.0.1

- Evidence-driven sessions with cold-start placement, explicit training targets, and an evolving Ability Ledger.
- Runnable JavaScript, TypeScript, and C++ challenges in an integrated editor and test-result workspace.
- Deterministic challenge compilation against reference solutions, visible tests, hidden tests, and known-incorrect implementations.
- Deterministic submission evaluation from the isolated runner's exit code—there is no LLM judge.
- Sandboxed Electron renderer with typed preload IPC and separate utility processes for agent orchestration and untrusted code execution.
- Direct email/password authentication and synchronized canonical learning history.
- Configurable model providers, durable System/Light/Dark appearance settings, and animated session transitions.

## The correctness boundary

The Training Agent owns pedagogical proposals: the next skill to practise, the shape of a challenge, and the evidence-backed follow-up. It is not a correctness authority.

A proposed challenge is published only after the deterministic compiler proves that:

1. the reference solution passes visible and hidden tests;
2. known-incorrect implementations pass the intentionally limited visible suite;
3. those incorrect implementations fail the hidden suite; and
4. generated artifacts agree on paths, commands, language, and observable contract.

Learner submissions are evaluated only by executing the committed tests in the runner. Model output cannot turn a failing program into a passing submission or bypass challenge compilation.

## Architecture

```text
Sandboxed React renderer
        │ typed IPC through preload
        ▼
Electron main process ───── local SQLite working state
        │
        ├── Training Agent utility process ── model/provider adapters
        ├── Runner utility process ────────── untrusted program execution
        └── Fastify API ───────────────────── canonical PostgreSQL history
                                             and object storage
```

- `apps/desktop`: Electron shell, React UI, IPC boundary, local persistence, Training Agent, and runner coordination.
- `apps/api`: authenticated Fastify API for canonical learning history and checkpoint synchronization.
- `packages/domain`: shared runtime-validated contracts.
- `packages/training`: deterministic question compiler and validation rules.
- `packages/database`: PostgreSQL/Drizzle schema and migrations.
- `packages/provider`: provider-neutral streaming and tool-call normalization.

The renderer has no direct Node.js access. Electron main owns permissions, secrets, durable local state, and process coordination. Agent orchestration and learner programs execute outside the renderer in separate utility processes.

## Requirements

- macOS
- Node.js 22
- pnpm 10.13.1 through Corepack
- A PostgreSQL database with the `vector` extension
- S3-compatible object storage

Supabase is the recommended managed backend because one project can provide PostgreSQL, pgvector, authentication support, and an S3-compatible storage endpoint. The application remains provider-neutral at the storage boundary.

## Run locally

Clone the repository, install dependencies, and start the bootstrap flow:

```bash
corepack pnpm install
corepack pnpm dev
```

On first run, bootstrap requests the PostgreSQL connection URL and object-storage credentials. It then:

1. generates a local authentication secret;
2. writes credentials to the git-ignored `.env.local` with mode `0600`;
3. enables pgvector and applies the committed Drizzle migrations;
4. creates or verifies the artifact bucket; and
5. launches the API and Electron application through Turborepo.

Subsequent launches need only:

```bash
corepack pnpm dev
```

## Development commands

```bash
corepack pnpm cloud:configure  # replace cloud credentials
corepack pnpm cloud:verify     # verify DB, migrations, and object storage
corepack pnpm db:studio        # inspect managed PostgreSQL
corepack pnpm typecheck        # typecheck every workspace package
corepack pnpm test             # run deterministic unit/integration suites
corepack pnpm build            # build all workspace packages
```

The desktop retains active execution state, checkpoints, and its synchronization outbox locally. Canonical learning history and generated repository snapshots live in the configured cloud services.

## Releases

Official releases are cut from version tags after `main` passes CI. The release workflow rebuilds the application on macOS, signs it with Developer ID, submits it for Apple notarization, and publishes DMG, ZIP, and updater metadata to GitHub. See [`docs/releasing.md`](docs/releasing.md) for the release contract.

`v0.0.1` is the first official Spar release.
