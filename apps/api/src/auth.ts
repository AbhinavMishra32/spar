import { betterAuth } from "better-auth";
import { bearer, emailOTP } from "better-auth/plugins";
import { fromNodeHeaders } from "better-auth/node";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import type { Database } from "@spar/database";
import { authAccounts, authSessions, authVerifications, users } from "@spar/database";
import type { Env } from "./env.js";
import { codeMessage, type Mailer } from "./mailer.js";
import { hashPassword, verifyPassword } from "./password.js";

export type AuthUser = { id: string; email: string; displayName: string };
export type SparAuth = ReturnType<typeof createAuth>;

declare module "fastify" {
  interface FastifyInstance {
    /** The Better Auth instance behind `/v1/auth`. Decorated onto the app so that
     *  `requireUser` stays a free function every route can reach for. */
    sparAuth: SparAuth;
  }
}

/** How long a code lasts. Long enough to switch to a mail client, find the
 *  message and come back; short enough that a code read over someone's shoulder
 *  is worth nothing by the time they could use it. */
const CODE_TTL_SECONDS = 10 * 60;

/** Spar's authentication, which is Better Auth configured against the tables in
 *  `@spar/database` and the mailer beside this file.
 *
 *  Three decisions are worth knowing before reading the config:
 *
 *  - **Codes, not links.** Every email carries six digits rather than a URL. The
 *    client is a desktop window, so a link would have to bounce through a browser
 *    and back over a custom protocol — three moving parts and an OS handler
 *    registration to return someone to a window that never closed. A code is
 *    typed into the window that asked for it.
 *  - **Bearer tokens, not cookies.** The Electron main process holds the session
 *    token in the OS keychain and sends it as `Authorization: Bearer`. Nothing in
 *    Spar is a browser, so there is no cookie jar to rely on.
 *  - **The old scrypt hasher, kept.** Better Auth is handed the same `hash` and
 *    `verify` the hand-rolled routes used, so the hashes copied across in
 *    migration 0004 are still valid and nobody has to reset a password to follow
 *    us onto a new library. */
export function createAuth(db: Database, env: Env, mailer: Mailer) {
  /* A deployment with no email provider cannot ask for a code, so it cannot
     require one either — see `createMailer`. Production always has one. */
  const verificationRequired = mailer.configured;
  return betterAuth({
    appName: "Spar",
    secret: env.AUTH_SECRET,
    baseURL: env.AUTH_BASE_URL ?? `http://127.0.0.1:${env.PORT}`,
    /* Kept where the hand-written routes answered, so an older desktop build that
       still posts to /v1/auth/password/* gets its 404 from the same prefix rather
       than a confusing 200 from a different one. */
    basePath: "/v1/auth",
    database: drizzleAdapter(db, {
      provider: "pg",
      /* Better Auth's four models onto Spar's tables. `user` is Spar's own
         `users` — the table every other foreign key points at — which is what
         lets one row be both the learner and the account. */
      schema: { user: users, account: authAccounts, session: authSessions, verification: authVerifications },
    }),
    /* Every id column in the schema is a uuid, so Better Auth is asked for uuids
       rather than its own shorter random strings. */
    advanced: { database: { generateId: "uuid" } },
    user: { fields: { name: "displayName", image: "avatarUrl" } },
    emailAndPassword: {
      enabled: true,
      /* The same bounds the desktop form checks before it posts. */
      minPasswordLength: 8,
      maxPasswordLength: 200,
      /* With a mailer, no session is handed out until the code is typed, so the
         window goes create → code → signed in. Without one, the account is signed
         in the moment it exists. */
      requireEmailVerification: verificationRequired,
      autoSignIn: !verificationRequired,
      /* Someone resetting a password is either locked out or afraid they have been
         broken into. Both readings mean every other device should lose its
         session over it. */
      revokeSessionsOnPasswordReset: true,
      password: { hash: hashPassword, verify: ({ password, hash }) => verifyPassword(password, hash) },
    },
    emailVerification: { sendOnSignUp: verificationRequired, autoSignInAfterVerification: true },
    session: {
      /* A month, refreshed a day at a time. This is an app people leave installed:
         the fifteen-minute token this replaces signed the window out again by
         every lunch break, and had no refresh to cover it. */
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    /* Guessing a six-digit code is a question of how many guesses you are allowed,
       and asking for codes is a way to send mail from someone else's domain, so
       both are capped well under the default. Signing in is capped because a
       password is only as private as the number of attempts it survives. */
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 8 },
        "/email-otp/send-verification-otp": { window: 300, max: 4 },
        "/email-otp/verify-email": { window: 300, max: 10 },
        "/email-otp/reset-password": { window: 300, max: 10 },
        "/sign-in/email-otp": { window: 300, max: 10 },
      },
    },
    /* Off by default in Better Auth, and staying off explicitly: nothing else in
       Spar phones home, and an auth library is the last place to start. */
    telemetry: { enabled: false },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: CODE_TTL_SECONDS,
        /* Five wrong guesses burns the code, not the account: a mistyping learner
           asks for another, and an attacker gets five tries at a code they cannot
           read. */
        allowedAttempts: 5,
        /* Hashed at rest. A live code is a credential, and a read-only leak of
           this table should not be a way into any account. */
        storeOTP: "hashed",
        /* Signing in with a code is for accounts that already exist. Creating one
           from a typo in the email field is not a sign-up flow. */
        disableSignUp: true,
        sendVerificationOnSignUp: verificationRequired,
        /* Verification is the code all the way through — otherwise Better Auth
           sends its own link email for sign-up and a code for everything else,
           and the window has to explain both. */
        overrideDefaultEmailVerification: true,
        async sendVerificationOTP({ email, otp, type }) {
          await mailer.send(codeMessage(email, otp, type, CODE_TTL_SECONDS / 60));
        },
      }),
      bearer(),
    ],
  });
}

/** Mounts Better Auth's own handler under `/v1/auth/*`.
 *
 *  Fastify has parsed the body by the time a handler runs and Better Auth wants a
 *  web `Request`, so the body is re-serialised on the way through. That is the
 *  whole of the adapter; everything else is headers, copied in both directions so
 *  that `set-auth-token` reaches the desktop app. */
export function installAuth(app: FastifyInstance, auth: SparAuth) {
  app.decorate("sparAuth", auth);
  app.route({
    method: ["GET", "POST"],
    url: "/v1/auth/*",
    async handler(request, reply) {
      const url = new URL(request.url, auth.options.baseURL ?? `http://${request.headers.host ?? "127.0.0.1"}`);
      const response = await auth.handler(
        new Request(url, {
          method: request.method,
          headers: fromNodeHeaders(request.raw.headers),
          ...(request.method === "GET" || request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        }),
      );
      /* Better Auth answers a failure it could not classify with a 500 and an
         empty body, which reaches the desktop app as "something went wrong" and
         reaches the log as nothing at all. The reason is on the server — a
         database that has not run its migrations, a mail provider refusing a
         key — so it is said here, where it can be read. */
      if (response.status >= 500) request.log.error({ authPath: url.pathname }, "Better Auth failed to handle a request");
      reply.status(response.status);
      response.headers.forEach((value, key) => void reply.header(key, value));
      return reply.send(response.body ? await response.text() : null);
    },
  });
}

/** The account behind a request, or a 401. Every route in `routes.ts` opens with
 *  it, and it is the only thing that reads the bearer token. */
export async function requireUser(request: FastifyRequest): Promise<AuthUser> {
  const session = await request.server.sparAuth.api.getSession({ headers: fromNodeHeaders(request.raw.headers) });
  if (!session) throw unauthorized();
  return { id: session.user.id, email: session.user.email, displayName: session.user.name ?? session.user.email.split("@")[0] ?? "Learner" };
}

/** Deleting the account. Better Auth has its own flow for this, built around
 *  emailing a confirmation link; Spar asks in the window instead, and the learner
 *  is already signed in by the time they can, so the row goes and every table
 *  that references it cascades — credentials and sessions included. */
export function installAccountRoutes(app: FastifyInstance, db: Database) {
  app.delete("/v1/account", async (request, reply) => {
    const user = await requireUser(request);
    await db.delete(users).where(eq(users.id, user.id));
    return reply.code(204).send();
  });
}

function unauthorized() {
  const error = new Error("Sign in to continue") as Error & { statusCode: number };
  error.statusCode = 401;
  return error;
}
