import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { envSchema } from "./env.js";

const env=envSchema.parse(process.env);
if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY)throw new Error("Supabase REST credentials are required for the managed-storage round trip.");
const client=createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const key=`_health/${randomUUID()}.txt`;
const expected=`spar-storage-check:${randomUUID()}`;
try{
  const uploaded=await client.storage.from(env.OBJECT_STORAGE_BUCKET).upload(key,expected,{contentType:"text/plain",upsert:false});
  if(uploaded.error)throw uploaded.error;
  const downloaded=await client.storage.from(env.OBJECT_STORAGE_BUCKET).download(key);
  if(downloaded.error)throw downloaded.error;
  const actual=await downloaded.data.text();
  if(actual!==expected)throw new Error("Supabase Storage round trip returned different bytes.");
  console.log("Supabase Storage upload/download round trip passed.");
}finally{
  const removed=await client.storage.from(env.OBJECT_STORAGE_BUCKET).remove([key]);
  if(removed.error)console.warn(`Health-check object cleanup failed: ${removed.error.message}`);
}
