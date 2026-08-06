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
| `DATABASE_URL` | Neon. **Use the pooled connection string**, not the direct one — see below |
| `AUTH_SECRET` | 32+ characters. Reuse the one already signing your tokens, or every existing session is invalidated |
| `AUTH_BASE_URL` | The origin the desktop app calls, e.g. `https://spar-api.vercel.app`. Better Auth checks requests against it |
| `RESEND_API_KEY` | Required in production. Sends the verification and password-reset codes — see below |
| `EMAIL_FROM` | The sender, e.g. `Spar <no-reply@yourdomain.com>`. Must be an address on a domain verified with Resend |
| `SUPABASE_URL` and `SUPABASE_SECRET_KEY` | For Supabase Storage. Storage only — the database is Neon |
| `OBJECT_STORAGE_*` | Instead of the Supabase pair, if using another S3-compatible provider |

**Email.** Creating an account asks for a six-digit code, and so does resetting a
password, so a deployment that cannot send email cannot let anyone in — the API
refuses to start in production without `RESEND_API_KEY` and `EMAIL_FROM`. Resend's
free plan sends 3,000 messages a month, 100 a day, which is a great deal more
sign-ups than a self-hosted Spar is going to have. Create a key at
[resend.com/api-keys](https://resend.com/api-keys) with **Sending access** only,
and verify the domain you send from at
[resend.com/domains](https://resend.com/domains) — an unverified domain can only
send to the address that owns the Resend account, which is fine while you are the
only learner and a silent failure the moment you are not.

Running from source with no key set is supported and needs no provider: the code
is written to the API's own log instead of being sent, and confirming an address
becomes optional. That is a development affordance, not a mode to deploy.

Add them interactively so no secret is typed into a shell that records history:

```bash
vercel env add DATABASE_URL production --cwd apps/api
```

**The pooled connection string matters.** Every serverless instance opens its own
connections, and there can be hundreds of instances; the direct Postgres endpoint
runs out of connections long before the traffic justifies it. Use the pooled host —
on Neon that is the one with `-pooler` in it, which is PgBouncer in transaction
mode. `createDatabase` already caps the pool at one connection when it detects a
serverless runtime and disables prepared statements, which that pooler rejects.
The same two settings are what Supabase's port-`6543` pooler wants, so nothing in
the client changes if you host Postgres somewhere else.

Keep the **direct** (non-pooled) URL for migrations. `drizzle-kit` runs DDL, which
wants a real session rather than a transaction-scoped one.

### Migrate before you deploy

The function does not run migrations at boot — nothing should, on a platform that
may start a hundred instances at once — so they are applied from your own machine
with `DATABASE_URL` in `.env.local` pointed at the direct endpoint:

```bash
corepack pnpm db:migrate
```

Order matters, and only in one direction. Spar's migrations are additive, so an
already-deployed function against a freshly migrated database is fine; a newly
deployed function against a database that has *not* been migrated answers 500 on
every route that touches a new column. Migrate first.

Then deploy:

```bash
vercel deploy --prod --cwd apps/api
```

Two settings on the Vercel project are worth checking once:

- **Deployment Protection must be off for production.** It is an authentication
  wall in front of the deployment, and the desktop app has no way through it — the
  requests fail before they reach Fastify.
- **`AUTH_BASE_URL` must be the stable production URL**, not a per-deployment one.
  Better Auth checks requests against it, and every preview deployment has a
  different host. This is a chicken-and-egg on the first deploy: deploy once to
  learn the URL, set the variable, deploy again.

One limitation to know rather than fix: Better Auth's rate limiter is in-memory,
so on a serverless platform it is per-instance rather than global. The caps in
`apps/api/src/auth.ts` are therefore softer in practice than they read. Moving the
limiter's state into Postgres is the fix when it matters.

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
