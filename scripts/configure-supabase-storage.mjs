import { spawnSync } from "node:child_process";
import { ensureLocalEnvironment, readLocalEnvironment, updateLocalEnvironment } from "./lib.mjs";

ensureLocalEnvironment();
const environment=readLocalEnvironment();
const projectRef=environment.SUPABASE_PROJECT_REF;
if(!projectRef)throw new Error("SUPABASE_PROJECT_REF is missing. Link or create the Supabase project first.");
const result=spawnSync("corepack",["pnpm","exec","supabase","projects","api-keys","--project-ref",projectRef,"--reveal","--output","json"],{encoding:"utf8",env:process.env});
if(result.status!==0){process.stderr.write(result.stderr);process.exit(result.status??1);}
const keys=JSON.parse(result.stdout);
const secret=keys.find((key)=>key.type==="secret")?.api_key??keys.find((key)=>key.name==="service_role")?.api_key;
if(!secret)throw new Error("Supabase did not return a server-side secret key.");
updateLocalEnvironment({SUPABASE_URL:`https://${projectRef}.supabase.co`,SUPABASE_SECRET_KEY:secret,OBJECT_STORAGE_BUCKET:environment.OBJECT_STORAGE_BUCKET||"pracai"});
console.log("Configured the Supabase Storage server key in .env.local without exposing it to the renderer.");
