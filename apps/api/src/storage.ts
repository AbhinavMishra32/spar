import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./env.js";
export class ObjectStorage {
  private readonly supabase:SupabaseClient|null;
  private readonly s3:S3Client|null;
  /* Built only when one of the two is actually configured — see
     `objectStorageConfigured` in env.ts, which `server.ts` checks before it
     constructs this at all. A caller that reaches this constructor without
     either pair is a bug, not a deployment choice, so it fails loudly rather
     than quietly building an S3 client with no credentials that would only fail
     later, mid-request. */
  constructor(private readonly env:Env){
    this.supabase=env.SUPABASE_URL&&env.SUPABASE_SECRET_KEY?createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}):null;
    if(!this.supabase&&!(env.OBJECT_STORAGE_ENDPOINT&&env.OBJECT_STORAGE_ACCESS_KEY&&env.OBJECT_STORAGE_SECRET_KEY))throw new Error("ObjectStorage constructed with neither Supabase nor S3 configured");
    this.s3=this.supabase?null:new S3Client({endpoint:env.OBJECT_STORAGE_ENDPOINT!,region:env.OBJECT_STORAGE_REGION,forcePathStyle:true,credentials:{accessKeyId:env.OBJECT_STORAGE_ACCESS_KEY!,secretAccessKey:env.OBJECT_STORAGE_SECRET_KEY!}});
  }
  async ensureBucket(){if(this.supabase){const {data}=await this.supabase.storage.getBucket(this.env.OBJECT_STORAGE_BUCKET);if(data)return;const {error}=await this.supabase.storage.createBucket(this.env.OBJECT_STORAGE_BUCKET,{public:false,fileSizeLimit:52_428_800});if(error&&!/already exists/i.test(error.message))throw error;return;}const {HeadBucketCommand,CreateBucketCommand}=await import("@aws-sdk/client-s3");try{await this.s3!.send(new HeadBucketCommand({Bucket:this.env.OBJECT_STORAGE_BUCKET}));}catch{await this.s3!.send(new CreateBucketCommand({Bucket:this.env.OBJECT_STORAGE_BUCKET}));}}
  async uploadUrl(key:string,contentType="application/octet-stream"){if(this.supabase){const {data,error}=await this.supabase.storage.from(this.env.OBJECT_STORAGE_BUCKET).createSignedUploadUrl(key);if(error)throw error;return data.signedUrl;}return getSignedUrl(this.s3!,new PutObjectCommand({Bucket:this.env.OBJECT_STORAGE_BUCKET,Key:key,ContentType:contentType}),{expiresIn:300});}
  async downloadUrl(key:string){if(this.supabase){const {data,error}=await this.supabase.storage.from(this.env.OBJECT_STORAGE_BUCKET).createSignedUrl(key,300);if(error)throw error;return data.signedUrl;}return getSignedUrl(this.s3!,new GetObjectCommand({Bucket:this.env.OBJECT_STORAGE_BUCKET,Key:key}),{expiresIn:300});}
}
