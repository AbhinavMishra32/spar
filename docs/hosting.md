# Hosting the Spar API

The desktop app keeps your working state locally and talks to the Spar API for
your account and the canonical copy of your learning history. That API has to run
somewhere. This document covers the hosted option — Vercel — and how a build
learns where to find it.

## What the app talks to, and how it decides

`apps/desktop/src/main/apiOrigin.ts` resolves the origin in this order:

1. **`SPAR_API_ORIGIN`** in the environment, if set. This is the self-hosting
   escape hatch and always wins.
2. **The origin stamped into the build.** Release builds carry the deployed
   origin in their packaged `package.json`, written by electron-builder's
   `extraMetadata`. This is deliberately not an environment variable: a packaged
   app does not inherit the environment of the machine that built it, so a value
   set only in CI would be undefined by the time anyone ran the app.
3. **`http://localhost:4318`**, for development and for anyone running the API
   themselves.

To stamp a release, set the `SPAR_HOSTED_API_ORIGIN` repository variable — not a
secret; it is a public URL and secrets are unavailable to some workflow contexts:

```bash
gh variable set SPAR_HOSTED_API_ORIGIN --body "https://your-deployment.vercel.app"
```

The release workflow passes it to electron-builder. A release cut without it falls
back to localhost rather than to a dead URL, and `apiOriginIsUnconfigured()`
reports that state so sign-in can explain itself instead of showing a refused
connection.

## Deploying to Vercel

The API is a Fastify app. `apps/api/api/index.ts` is the Vercel entry point: it
builds the Fastify instance once per warm instance and injects each request into
it, rather than binding a port. `apps/api/src/server.ts` skips its own `listen`
when `VERCEL` is set, so importing it under Vercel does not try to own a socket.

Create the project once, from `apps/api` as the root directory:

```bash
vercel link --cwd apps/api
```

`apps/api/vercel.json` already carries the install and build commands, which run
from the repository root so the pnpm workspace resolves and `@spar/domain` and
`@spar/database` are built before the API.

### Environment variables

Set these on the Vercel project before the first deploy. The function fails
closed with a clear message if any are missing, rather than serving broken
requests:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | **Use the pooled connection string**, not the direct one — see below |
| `AUTH_SECRET` | 32+ characters. Reuse the one already signing your tokens, or every existing session is invalidated |
| `SUPABASE_URL` and `SUPABASE_SECRET_KEY` | For Supabase Storage |
| `OBJECT_STORAGE_*` | Instead of the Supabase pair, if using another S3-compatible provider |

Add them interactively so no secret is typed into a shell that records history:

```bash
vercel env add DATABASE_URL production --cwd apps/api
```

**The pooled connection string matters.** Every serverless instance opens its own
connections, and there can be hundreds of instances; the direct Postgres endpoint
runs out of connections long before the traffic justifies it. Use Supabase's
transaction-mode pooler (port `6543`). `createDatabase` already caps the pool at
one connection when it detects a serverless runtime and disables prepared
statements, which that pooler rejects.

Then deploy:

```bash
vercel deploy --prod --cwd apps/api
```

Confirm it is live before pointing a release at it:

```bash
curl https://your-deployment.vercel.app/health
```

That should answer `{"ok":true}`.

## Self-hosting instead

Nothing about the app requires the hosted path. `corepack pnpm dev` runs the API
on `localhost:4318`, which is where an unstamped build looks by default, and a
build stamped with a hosted origin can still be pointed elsewhere:

```bash
SPAR_API_ORIGIN=https://spar.internal.example.com open -a Spar
```
