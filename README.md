# Practice AI

Practice AI is a macOS-first personalized coding gym. A single Training Agent chooses evidence-driven exercises, observes complete attempts, and maintains a durable learner model that survives every session.

## Architecture

- `apps/desktop`: Electron, React, secure preload bridge, utility-process agent and execution runtimes.
- `apps/api`: authenticated Fastify backend for canonical learning history and checkpoint synchronization.
- `packages/domain`: shared domain contracts and validation.
- `packages/database`: PostgreSQL schema and migrations.
- `packages/provider`: provider-neutral streaming and tool-call normalization adapted from Construct.

The renderer is sandboxed and cannot access Node.js. The main process owns permissions and persistence coordination. The Training Agent and untrusted programs run in separate utility processes.

## Run locally, store data in the cloud

The development machine runs only the Electron application and API process. PostgreSQL, vector search, and workspace artifacts use managed cloud services; Docker is not required.

### First run

Create a Supabase project, enable the `vector` extension, and enable its Storage S3 protocol. Then run:

```bash
corepack pnpm install
corepack pnpm dev
```

On the first run, bootstrap asks for the Supabase PostgreSQL connection URL and Storage S3 credentials. It then:

1. generates a local authentication secret;
2. writes credentials to the git-ignored `.env.local` with mode `0600`;
3. enables pgvector and applies the committed Drizzle migrations;
4. creates or verifies the artifact bucket;
5. launches the API and Electron application through Turborepo.

Future launches need only:

```bash
corepack pnpm dev
```

Useful commands:

```bash
corepack pnpm cloud:configure  # replace cloud credentials
corepack pnpm cloud:verify     # test DB, migration, and object storage access
corepack pnpm db:studio        # inspect managed PostgreSQL
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

Supabase is recommended because one project provides PostgreSQL with pgvector and an S3-compatible storage endpoint. The application remains provider-neutral: `cloud:configure` accepts any PostgreSQL database with pgvector and any S3-compatible object store.

The desktop retains only active execution state, checkpoints, and its synchronization outbox locally. Canonical learning history and generated repository snapshots remain in the cloud.
