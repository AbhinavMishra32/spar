import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "../src/server.js";

/* The Vercel entry point. Vercel gives a function a request and a response and
   owns the socket, so the Fastify app is built once per warm instance and each
   request is injected into its own HTTP handler rather than served off a port.
 *
 * Booting is memoised on the module scope, which is where a warm instance keeps
 * state: a cold start pays for the database client and the JWT setup once, and
 * every request after that reuses them. A failed boot is not cached, so a
 * missing environment variable does not wedge the instance for its lifetime. */
let booting: Promise<Awaited<ReturnType<typeof createServer>>> | null = null;

function boot() {
  if (!booting) {
    booting = createServer().catch((error) => {
      booting = null;
      throw error;
    });
  }
  return booting;
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  try {
    const { app } = await boot();
    await app.ready();
    app.server.emit("request", request, response);
  } catch (error) {
    // Before `app` exists there is no Fastify error handler to fall back on, and
    // the reason is almost always configuration, so say which one plainly rather
    // than letting the platform report an opaque crash.
    console.error("Spar API failed to start:", error);
    response.statusCode = 500;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "The API is not configured correctly." }));
  }
}
