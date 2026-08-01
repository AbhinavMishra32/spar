import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import type { Database } from "@spar/database";
import { users } from "@spar/database";
import { hashPassword, verifyPassword } from "./password.js";

export type AuthUser = { id: string; email: string; displayName: string };

declare module "@fastify/jwt" { interface FastifyJWT { payload: { sub: string; email: string; name: string }; user: { sub: string; email: string; name: string } } }

export function installAuth(app: FastifyInstance, db: Database) {
  app.post("/v1/auth/password/sign-up", async (request, reply) => {
    const input = readPasswordInput(request, reply); if (!input) return;
    const existing = (await db.select().from(users).where(eq(users.email, input.email)).limit(1))[0];
    if (existing?.passwordHash) return reply.code(409).send({ error: "An account already exists for this email" });
    const passwordHash = await hashPassword(input.password);
    let user = existing;
    if (user) {
      await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));
      user = { ...user, passwordHash };
    } else {
      const id = randomUUID(); const displayName = input.email.split("@")[0] ?? "Learner";
      await db.insert(users).values({ id, email: input.email, passwordHash, displayName });
      user = { id, email: input.email, passwordHash, displayName, avatarUrl: null, createdAt: new Date(), updatedAt: new Date() };
    }
    return issueToken(reply, user);
  });

  app.post("/v1/auth/password/sign-in", async (request, reply) => {
    const input = readPasswordInput(request, reply); if (!input) return;
    const user = (await db.select().from(users).where(eq(users.email, input.email)).limit(1))[0];
    if (!user?.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) return reply.code(401).send({ error: "Invalid email or password" });
    return issueToken(reply, user);
  });

}

export async function requireUser(request: FastifyRequest): Promise<AuthUser> { await request.jwtVerify(); return { id: request.user.sub, email: request.user.email, displayName: request.user.name }; }

async function issueToken(reply: FastifyReply, user: { id: string; email: string; displayName: string | null }) {
  const account = { id: user.id, email: user.email, displayName: user.displayName ?? "Learner" };
  return { accessToken: await reply.jwtSign({ sub: user.id, email: user.email, name: account.displayName }, { expiresIn: "15m" }), account };
}

function readPasswordInput(request: FastifyRequest, reply: FastifyReply) {
  const body = (request.body ?? {}) as Record<string, unknown>; const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""; const password = typeof body.password === "string" ? body.password : "";
  if (!/^\S+@\S+\.\S+$/.test(email)) { void reply.code(400).send({ error: "A valid email is required" }); return null; }
  if (password.length < 8 || password.length > 200) { void reply.code(400).send({ error: "Password must be between 8 and 200 characters" }); return null; }
  return { email, password };
}
