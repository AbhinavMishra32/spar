import type { AuthService } from "./auth.js";
import type { LocalStore } from "./store.js";

export class CloudSyncService {
  private timer: NodeJS.Timeout | null=null; private running=false; private retryAfter=0;
  constructor(private readonly store:LocalStore,private readonly auth:AuthService,private readonly origin:string,private readonly onState:(state:"offline"|"pending"|"synced")=>void,private readonly request:typeof fetch=fetch){}
  start(){this.timer=setInterval(()=>void this.flush(),5_000);void this.flush();}
  stop(){if(this.timer)clearInterval(this.timer);this.timer=null;}
  async flush(){
    if(this.running)return;
    if(Date.now()<this.retryAfter){this.onState("offline");return;}
    try{
      const token=await this.auth.accessToken();
      if(!token){this.onState("offline");return;}
      const items=this.store.pendingSync();
      if(!items.length){this.retryAfter=0;this.onState(this.store.hasDeferredSync()?"pending":"synced");return;}
      this.running=true;this.onState("pending");
      const acknowledged:string[]=[];
      let deferred=false;
      for(let index=0;index<items.length;index++){
        const item=items[index]!;
        if(deferred&&this.store.isSyncDeferred(item.id))continue;
        const payload=JSON.parse(item.payload) as Record<string,unknown>;
        const batch=[item];
        /* Both APIs accept event arrays. Preserve outbox order and batch only
           consecutive events from the same run or attempt. */
        if((item.kind==="agent-trace-event"&&typeof payload.runId==="string")||(item.kind==="attempt-event"&&typeof payload.attemptId==="string")){
          const limit=item.kind==="agent-trace-event"?64:250;
          while(batch.length<limit&&index+1<items.length){
            const next=items[index+1]!;
            if(next.kind!==item.kind||(deferred&&this.store.isSyncDeferred(next.id)))break;
            const event=JSON.parse(next.payload) as Record<string,unknown>;
            if(item.kind==="agent-trace-event"?event.runId!==payload.runId:event.attemptId!==payload.attemptId||event.sequence!==Number((JSON.parse(batch.at(-1)!.payload) as Record<string,unknown>).sequence)+1)break;
            batch.push(next);index++;
          }
        }
        const target=route(item.kind,payload);
        if(!target){acknowledged.push(item.id);continue;}
        if(batch.length>1){
          const events=batch.map((row)=>JSON.parse(row.payload));
          target.body=item.kind==="attempt-event"?{attemptId:payload.attemptId,expectedSequence:payload.sequence,events}:{events};
        }
        const response=await this.request(`${this.origin}${target.path}`,{
          method:target.method,
          headers:{authorization:`Bearer ${token}`,"content-type":"application/json","idempotency-key":item.id},
          body:JSON.stringify(target.body),
          /* A background convenience must never own the app indefinitely. This
             also covers a host that resolves but accepts no traffic. */
          signal:AbortSignal.timeout(10_000),
        });
        if(response.ok){acknowledged.push(...batch.map((row)=>row.id));continue;}
        if(response.status===401||response.status>=500)throw new Error(response.status===401?"Authentication expired":`Cloud unavailable (${response.status})`);
        /* A missing parent makes every checkpoint, message, and attempt below
           it fail too. Defer that family for an hour, then retry it; no local
           record is discarded, and unrelated work can continue syncing. */
        if(response.status===404){
          const until=new Date(Date.now()+60*60_000).toISOString();
          if(item.kind==="attempt-event"&&typeof payload.attemptId==="string")this.store.deferSyncMissingAttempt(payload.attemptId,until);
          else if(typeof payload.sessionId==="string")this.store.deferSyncMissingSession(payload.sessionId,until);
          else if(typeof payload.runId==="string")this.store.deferSyncMissingRun(payload.runId,until);
          else this.store.deferSync(item.id,until);
          deferred=true;
          continue;
        }
        /* Other 4xx responses still belong to the individual record. */
        this.store.markSyncFailed(item.id);
      }
      this.store.acknowledgeSync(acknowledged);this.retryAfter=0;
      this.onState(this.store.pendingSync(1).length||this.store.hasDeferredSync()?"pending":"synced");
    }catch{
      /* Keep every unacknowledged record and retry later. The timer still ticks
         so recovery is automatic, but an outage is probed once per 30 seconds,
         not once per five seconds for every row in the queue. */
      this.retryAfter=Date.now()+30_000;this.onState("offline");
    }finally{this.running=false;}
  }
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
  if(kind==="agent-run-start")return{path:`/v1/telemetry/runs/${value.id}`,method:"PUT",body:value};
  if(kind==="agent-trace-event")return{path:`/v1/telemetry/runs/${value.runId}/events`,method:"POST",body:{events:[value]}};
  if(kind==="agent-run-finish")return{path:`/v1/telemetry/runs/${value.id}`,method:"PATCH",body:value};
  return null;
}
