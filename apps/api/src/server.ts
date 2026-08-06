import Fastify from "fastify";
import cors from "@fastify/cors";
import { createDatabase } from "@spar/database";
import { envSchema } from "./env.js";
import { createAuth, installAccountRoutes, installAuth } from "./auth.js";
import { createMailer } from "./mailer.js";
import { installRoutes } from "./routes.js";
import { ObjectStorage } from "./storage.js";

export async function createServer(environment=process.env){const env=envSchema.parse(environment);const app=Fastify({logger:{level:env.NODE_ENV==="production"?"info":"debug"},requestIdHeader:"x-request-id",trustProxy:true});const database=createDatabase(env.DATABASE_URL);await app.register(cors,{origin:false});
/* The mailer is built before the auth config because the auth config reads it:
   whether an account has to confirm its address depends on whether this
   deployment can send it a code. */
const mailer=createMailer(env,(message)=>app.log.info(message));installAuth(app,createAuth(database.db,env,mailer));installAccountRoutes(app,database.db);installRoutes(app,database.db,new ObjectStorage(env));app.addHook("onClose",()=>database.close());return {app,env};}
/* Binding a port is for running this process ourselves. Under Vercel the platform
   owns the socket and hands each request to the function in `api/index.ts`, so
   importing this module must not start a listener — it would bind, fail, or hold
   the invocation open depending on the runtime's mood. */
const selfHosted = process.env.NODE_ENV !== "test" && !process.env.VERCEL;
if (selfHosted) createServer().then(({app,env})=>app.listen({port:env.PORT,host:process.env.HOST ?? "127.0.0.1"})).catch((error)=>{console.error(error);process.exitCode=1;});
