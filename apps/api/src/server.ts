import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { createDatabase } from "@pracai/database";
import { envSchema } from "./env.js";
import { installAuth } from "./auth.js";
import { installRoutes } from "./routes.js";
import { ObjectStorage } from "./storage.js";

export async function createServer(environment=process.env){const env=envSchema.parse(environment);const app=Fastify({logger:{level:env.NODE_ENV==="production"?"info":"debug"},requestIdHeader:"x-request-id",trustProxy:true});const database=createDatabase(env.DATABASE_URL);await app.register(cors,{origin:false});await app.register(jwt,{secret:env.AUTH_SECRET});installAuth(app,database.db);installRoutes(app,database.db,new ObjectStorage(env));app.addHook("onClose",()=>database.close());return {app,env};}
if(process.env.NODE_ENV!=="test")createServer().then(({app,env})=>app.listen({port:env.PORT,host:"127.0.0.1"})).catch((error)=>{console.error(error);process.exitCode=1;});
