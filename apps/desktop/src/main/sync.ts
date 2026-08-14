import type { AuthService } from "./auth.js";
import type { LocalStore } from "./store.js";

export class CloudSyncService {
  private timer: NodeJS.Timeout | null=null; private running=false;
  constructor(private readonly store:LocalStore,private readonly auth:AuthService,private readonly origin:string,private readonly onState:(state:"offline"|"pending"|"synced")=>void){}
  start(){this.timer=setInterval(()=>void this.flush(),5_000);void this.flush();}
  stop(){if(this.timer)clearInterval(this.timer);this.timer=null;}
  async flush(){if(this.running)return;try{const token=await this.auth.accessToken();if(!token){this.onState("offline");return;}const items=this.store.pendingSync();if(!items.length){this.onState("synced");return;}this.running=true;this.onState("pending");const acknowledged:string[]=[];for(const item of items){const target=route(item.kind,JSON.parse(item.payload) as Record<string,unknown>);if(!target){acknowledged.push(item.id);continue;}const response=await fetch(`${this.origin}${target.path}`,{method:target.method,headers:{authorization:`Bearer ${token}`,"content-type":"application/json","idempotency-key":item.id},body:JSON.stringify(target.body)});if(response.ok){acknowledged.push(item.id);continue;}if(response.status===401)throw new Error("Authentication expired");this.store.markSyncFailed(item.id);}this.store.acknowledgeSync(acknowledged);this.onState(this.store.pendingSync(1).length?"pending":"synced");}catch{this.onState("offline");}finally{this.running=false;}}
}
/** One outbox kind to one request. A kind with no case here is acknowledged and
 *  dropped by `flush`, which is what lets an older row left by a previous build
 *  drain rather than block the queue behind it forever. */
export function route(kind:string,value:Record<string,unknown>):{path:string;method:string;body:unknown}|null{
  if(kind==="session-create")return{path:"/v1/sessions",method:"POST",body:{id:value.sessionId,goal:value.goal,title:value.title}};
  if(kind==="session-rename")return{path:`/v1/sessions/${value.sessionId}`,method:"PATCH",body:{title:value.title}};
  /* Pinning and archiving take the same route as renaming — it is a partial
     patch, so only the keys the outbox recorded are sent, and a null is a real
     value there rather than an omission. */
  if(kind==="session-flags"){const {sessionId,...patch}=value;return{path:`/v1/sessions/${sessionId}`,method:"PATCH",body:patch};}
  if(kind==="session-delete")return{path:`/v1/sessions/${value.sessionId}`,method:"DELETE",body:{}};
  if(kind==="question-create")return{path:"/v1/challenges",method:"POST",body:value};
  if(kind==="ability-upsert")return{path:"/v1/abilities",method:"POST",body:value};
  if(kind==="profile-save")return{path:"/v1/profile",method:"PUT",body:value};
  if(kind==="learning-state")return{path:"/v1/learning-state",method:"PUT",body:value};
  if(kind==="agent-message")return{path:"/v1/agent-messages",method:"POST",body:value};
  if(kind==="concept-create")return{path:"/v1/concepts",method:"POST",body:value};
  if(kind==="checkpoint")return{path:`/v1/sessions/${value.sessionId}/checkpoints/${value.version}`,method:"PUT",body:value};
  if(kind==="attempt-event")return{path:`/v1/attempts/${value.attemptId}/events`,method:"POST",body:{attemptId:value.attemptId,expectedSequence:value.sequence,events:[value]}};
  return null;
}
