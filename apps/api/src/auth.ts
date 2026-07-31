import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq, gt } from "drizzle-orm";
import type { Database } from "@pracai/database";
import { authAccounts, users } from "@pracai/database";

type Pending = { code: string; state: string; challenge: string; userId: string; expiresAt: number };
const pending = new Map<string, Pending>();
export type AuthUser = { id: string; email: string; displayName: string };

declare module "@fastify/jwt" { interface FastifyJWT { payload: { sub: string; email: string; name: string }; user: { sub: string; email: string; name: string } } }

export function installAuth(app: FastifyInstance, db: Database) {
  app.get("/v1/auth/:provider/start", async (request, reply) => {
    const { provider } = request.params as { provider: string }; const query = request.query as Record<string,string>;
    if (!query.state || !query.code_challenge || !query.redirect_uri) return reply.code(400).send({ error: "PKCE state, challenge, and redirect URI are required" });
    const state=query.state; const challenge=query.code_challenge; const redirectUri=query.redirect_uri;
    if (provider === "email") {
      const email = String(query.email ?? "").trim().toLowerCase(); if (!/^\S+@\S+\.\S+$/.test(email)) return reply.code(400).send({ error: "A valid email is required" });
      const user = await findOrCreateUser(db, "email", email, email, email.split("@")[0] ?? "Learner");
      const code = randomBytes(32).toString("base64url"); pending.set(code, { code, state, challenge, userId: user.id, expiresAt: Date.now()+300_000 });
      return reply.type("text/html").send(`<!doctype html><title>Return to Practice AI</title><style>body{font:14px -apple-system;padding:60px;text-align:center;background:#f4f4f1;color:#253029}a{display:inline-block;background:#2f6955;color:white;padding:11px 18px;border-radius:8px;text-decoration:none}</style><h1>Email verified</h1><p>Continue in the desktop application.</p><a href="${escapeHtml(redirectUri)}?code=${code}&state=${encodeURIComponent(state)}">Open Practice AI</a>`);
    }
    return reply.code(501).send({ error: `${provider} OAuth requires deployment credentials and callback configuration` });
  });
  app.post("/v1/auth/exchange", async (request, reply) => {
    const body = request.body as Record<string,string>; const code=String(body.code??""); const state=String(body.state??""); const verifier=String(body.verifier??""); const entry = pending.get(code); if (!entry || entry.expiresAt < Date.now() || entry.state !== state || !verifyPkce(verifier, entry.challenge)) return reply.code(401).send({ error: "Invalid or expired authorization code" });
    pending.delete(code); const rows = await db.select().from(users).where(eq(users.id, entry.userId)).limit(1); const user = rows[0]; if (!user) return reply.code(401).send({ error: "Account no longer exists" });
    const account = { id: user.id, email: user.email, displayName: user.displayName ?? "Learner" }; return { accessToken: await reply.jwtSign({ sub: user.id, email: user.email, name: account.displayName }, { expiresIn: "15m" }), account };
  });
}
export async function requireUser(request: FastifyRequest): Promise<AuthUser> { await request.jwtVerify(); return { id: request.user.sub, email: request.user.email, displayName: request.user.name }; }
async function findOrCreateUser(db: Database, provider: string, providerId: string, email: string, displayName: string) { const existing = await db.select({ user: users }).from(authAccounts).innerJoin(users, eq(users.id, authAccounts.userId)).where(and(eq(authAccounts.provider, provider), eq(authAccounts.providerAccountId, providerId))).limit(1); if (existing[0]) return existing[0].user; const id = randomUUID(); await db.transaction(async (tx) => { await tx.insert(users).values({ id, email, displayName }); await tx.insert(authAccounts).values({ userId: id, provider, providerAccountId: providerId }); }); return { id, email, displayName }; }
function verifyPkce(verifier: string, expected: string) { if (!verifier) return false; const actual=createHash("sha256").update(verifier).digest("base64url"); const a=Buffer.from(actual); const b=Buffer.from(expected); return a.length===b.length&&timingSafeEqual(a,b); }
function escapeHtml(value:string){return value.replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]!))}
