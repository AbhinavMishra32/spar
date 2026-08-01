import { envSchema } from "./env.js";
import { ObjectStorage } from "./storage.js";

const env = envSchema.parse(process.env);
await new ObjectStorage(env).ensureBucket();
console.log(`Private bucket ${env.OBJECT_STORAGE_BUCKET} is available.`);
