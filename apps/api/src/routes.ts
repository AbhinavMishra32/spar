import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { appendEventsRequestSchema, learnerProfileSchema, sessionCheckpointSchema } from "@spar/domain";
import { abilityDocumentVersions, abilityDocuments, abilityEvidenceLinks, agentMessages, attemptEvents, attempts, challengeArtifacts, learnerConcepts, questions, sessionCheckpoints, sessions, trainingTargets, userSettings } from "@spar/database";
/* `conceptNodes` is deliberately not imported any more — see the note in the
   abilities route about the fabricated concept row that used to live there. */
import type { Database } from "@spar/database";
import { requireUser } from "./auth.js";
import type { ObjectStorage } from "./storage.js";

/** How many sessions one restore call will assemble. A restore is a fan-out of
 *  joins per session and the function has 30 seconds, so the device asks for
 *  them in batches and gets to report progress between them. */
const RESTORE_BATCH = 10;
const uuidPattern = /^[0-9a-f-]{36}$/i;

export function installRoutes(app: FastifyInstance, db: Database, storage?: ObjectStorage) {
  app.get("/health", async () => ({ ok: true }));

  /* ---- The learner's profile ---------------------------------------------
     What they told Spar at onboarding, and the answer to "has this account ever
     been onboarded". It lives here rather than only on the device because the
     device is wiped on sign-out by design: without a server copy, signing out
     and back in asked someone the same seven questions again, and a second
     machine asked them from scratch.

     Homed in `user_settings.settings` under one key rather than in a table of
     its own — it is one small document per account, and the jsonb bag is
     already there for exactly this. */
  app.get("/v1/profile", async (request) => {
    const user = await requireUser(request);
    const row = await db.select({ settings: userSettings.settings }).from(userSettings).where(eq(userSettings.userId, user.id)).limit(1);
    const parsed = learnerProfileSchema.safeParse(row[0]?.settings?.profile);
    /* A profile that no longer parses is a profile from a future or broken
       build. Answering `null` would send the learner back through intake and
       overwrite it, so the failure is reported instead. */
    if (row[0]?.settings?.profile !== undefined && !parsed.success) throw Object.assign(new Error("Stored profile could not be read"), { statusCode: 409 });
    return { profile: parsed.success ? parsed.data : null };
  });
  app.put("/v1/profile", async (request, reply) => {
    const user = await requireUser(request);
    const parsed = learnerProfileSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid profile" });
    const now = new Date();
    await db.insert(userSettings).values({ userId: user.id, settings: { profile: parsed.data }, createdAt: now, updatedAt: now })
      /* Merged rather than replaced, so a future setting stored beside the
         profile is not erased by someone editing their name. */
      .onConflictDoUpdate({ target: userSettings.userId, set: { settings: sql`${userSettings.settings} || ${JSON.stringify({ profile: parsed.data })}::jsonb`, updatedAt: now } });
    return reply.code(204).send();
  });
  /* The adaptive model is a versioned derived document. Raw attempts continue
     to use their append-only tables; keeping this projection together makes a
     cross-device restore atomic and prevents half-restored policy decisions. */
  app.put("/v1/learning-state", async (request, reply) => {
    const user = await requireUser(request);
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || (body as { version?: unknown }).version !== 1)
      return reply.code(400).send({ error: "Invalid learning state" });
    const now = new Date();
    await db.insert(userSettings).values({ userId: user.id, settings: { learningState: body }, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: userSettings.userId, set: { settings: sql`${userSettings.settings} || ${JSON.stringify({ learningState: body })}::jsonb`, updatedAt: now } });
    return reply.code(204).send();
  });
  app.get("/v1/sessions", async (request) => { const user=await requireUser(request); return db.select().from(sessions).where(eq(sessions.userId,user.id)).orderBy(desc(sessions.updatedAt)); });
  app.get("/v1/challenges",async(request)=>{const user=await requireUser(request);return db.select({id:questions.id,sessionId:questions.sessionId,ordinal:questions.ordinal,title:questions.title,language:questions.language,difficulty:questions.difficulty,status:questions.status,replacesQuestionId:questions.replacesQuestionId,createdAt:questions.createdAt,updatedAt:questions.updatedAt}).from(questions).innerJoin(sessions,eq(questions.sessionId,sessions.id)).where(eq(sessions.userId,user.id)).orderBy(desc(questions.updatedAt));});
  app.get("/v1/abilities",async(request)=>{const user=await requireUser(request);return db.select({id:abilityDocuments.id,status:abilityDocuments.status,currentVersion:abilityDocuments.currentVersion,lastObservedAt:abilityDocuments.lastObservedAt,updatedAt:abilityDocuments.updatedAt}).from(abilityDocuments).where(eq(abilityDocuments.userId,user.id)).orderBy(desc(abilityDocuments.updatedAt));});
  app.post("/v1/sessions", async (request,reply) => { const user=await requireUser(request); const body=request.body as {id?:unknown;goal?:unknown;title?:unknown};const goal=String(body.goal??"").trim(); if(goal.length<3)return reply.code(400).send({error:"Goal is required"}); const supplied=typeof body.id==="string"&&/^[0-9a-f-]{36}$/i.test(body.id)?body.id:null;const id=supplied??randomUUID(); await db.insert(sessions).values({id,userId:user.id,title:String(body.title??goal).slice(0,80),originalGoal:goal}).onConflictDoNothing(); return reply.code(201).send({id}); });
  /* Renaming and deleting are pushed from the device outbox, so both are written
     to be safe to replay: a delete that arrives twice is still a 204, and the
     cascade takes the session's challenges, attempts and checkpoints with it. */
  /* A partial patch, not a rename. Renaming was all this did, and pinning,
     archiving and the session's status were device-only as a result — so a
     session pinned on a laptop was unpinned everywhere else. Any subset of the
     fields may arrive; a body carrying only `title` behaves exactly as before,
     which is what an older desktop build still sends. */
  app.patch("/v1/sessions/:id",async(request,reply)=>{
    const user=await requireUser(request);
    const id=String((request.params as {id:string}).id);
    const body=request.body as {title?:unknown;pinnedAt?:unknown;archivedAt?:unknown;currentFocus?:unknown;status?:unknown};
    const patch:Partial<typeof sessions.$inferInsert>={};
    if(body.title!==undefined){const title=String(body.title??"").trim().slice(0,80);if(!title)return reply.code(400).send({error:"Title is required"});patch.title=title;}
    /* Null is meaningful on both of these — it is how unpinning and unarchiving
       are said — so `undefined` is the only value that means "leave alone". */
    if(body.pinnedAt!==undefined)patch.pinnedAt=body.pinnedAt===null?null:new Date(String(body.pinnedAt));
    if(body.archivedAt!==undefined)patch.archivedAt=body.archivedAt===null?null:new Date(String(body.archivedAt));
    if(Array.isArray(body.currentFocus))patch.currentFocus=body.currentFocus.map(String).slice(0,12);
    if(typeof body.status==="string"&&["planning","active","paused","completed"].includes(body.status))patch.status=body.status as typeof sessions.$inferInsert.status;
    if(!Object.keys(patch).length)return reply.code(400).send({error:"Nothing to update"});
    const updated=await db.update(sessions).set({...patch,updatedAt:new Date()}).where(and(eq(sessions.id,id),eq(sessions.userId,user.id))).returning({id:sessions.id});
    if(!updated[0])return reply.code(404).send({error:"Session not found"});
    return reply.code(204).send();
  });
  app.delete("/v1/sessions/:id",async(request,reply)=>{const user=await requireUser(request);const id=String((request.params as {id:string}).id);const owned=await db.select({id:sessions.id}).from(sessions).where(and(eq(sessions.id,id),eq(sessions.userId,user.id))).limit(1);if(!owned[0])return reply.code(204).send();await db.transaction(async(tx)=>{
    /* An ability document is written from evidence but is not owned by it: the
       document and its versions survive, and only the citation to the attempt
       event goes. Removed first, because that link is the one reference into the
       session's events that the cascade does not carry. */
    await tx.execute(sql`delete from ability_evidence_links where attempt_event_id in (select e.id from attempt_events e join attempts a on a.id=e.attempt_id join questions q on q.id=a.question_id where q.session_id=${id})`);
    await tx.delete(sessions).where(eq(sessions.id,id));
  });return reply.code(204).send();});
  app.post("/v1/challenges",async(request,reply)=>{const user=await requireUser(request);const body=request.body as Record<string,unknown>;const sessionId=String(body.sessionId??"");const questionId=String(body.questionId??"");const attemptId=String(body.attemptId??"");const design=(body.design&&typeof body.design==="object"?body.design:{}) as Record<string,unknown>;const target=(body.target&&typeof body.target==="object"?body.target:{}) as Record<string,unknown>;if(!/^[0-9a-f-]{36}$/i.test(sessionId)||!/^[0-9a-f-]{36}$/i.test(questionId)||!/^[0-9a-f-]{36}$/i.test(attemptId))return reply.code(400).send({error:"Invalid challenge identity"});const owned=await db.select({id:sessions.id}).from(sessions).where(and(eq(sessions.id,sessionId),eq(sessions.userId,user.id))).limit(1);if(!owned[0])return reply.code(404).send({error:"Session not found"});const title=String(design.title??"").trim();if(title.length<3)return reply.code(400).send({error:"Challenge title is required"});const artifactId=randomUUID();const createdAt=new Date(String(body.createdAt??new Date().toISOString()));const ordinalRow=await db.select({value:sql<number>`coalesce(max(${questions.ordinal}),0)+1`}).from(questions).where(eq(questions.sessionId,sessionId));const ordinal=Number(ordinalRow[0]?.value??1);const targetId=String(target.id??randomUUID());const manifest=design;const hash=createHash("sha256").update(JSON.stringify(manifest)).digest("hex");await db.transaction(async(tx)=>{await tx.insert(trainingTargets).values({id:targetId,sessionId,abilityDocumentId:typeof target.abilityId==="string"?target.abilityId:null,action:String(target.action??"practise"),specificGap:String(target.specificGap??"Adaptive challenge"),desiredEvidence:String(target.desiredEvidence??"A deterministic attempt"),avoidTesting:Array.isArray(target.avoidTesting)?target.avoidTesting.map(String):[]}).onConflictDoNothing();await tx.insert(challengeArtifacts).values({id:artifactId,userId:user.id,objectKey:`inline:${questionId}`,contentHash:hash,manifest,validatedAt:createdAt,validationReport:(body.report&&typeof body.report==="object"?body.report:{}) as Record<string,unknown>}).onConflictDoNothing();await tx.insert(questions).values({id:questionId,sessionId,trainingTargetId:targetId,ordinal,title,statement:String(design.statement??""),language:String(design.language??"javascript"),kind:String(design.kind??"function"),difficulty:String(design.difficulty??"developing"),status:"active",challengeArtifactId:artifactId,replacesQuestionId:typeof body.replacesQuestionId==="string"?body.replacesQuestionId:null,engineVersion:"local-compiler-v1",
    /* Where the problem came from, and what it is about. Both were dropped on
       the floor before: a restored challenge could not say it was LeetCode's
       rather than Spar's, and carried no concept tags, which left it invisible
       to every rollup that reads them. */
    sourceRef:body.source&&typeof body.source==="object"?body.source as Record<string,unknown>:null,
    concepts:Array.isArray(body.concepts)?body.concepts.flatMap((tag)=>{const value=tag as {slug?:unknown;role?:unknown};return typeof value?.slug==="string"?[{slug:value.slug,role:String(value.role??"primary")}]:[];}):[],
    createdAt,updatedAt:createdAt}).onConflictDoNothing();await tx.insert(attempts).values({id:attemptId,questionId,userId:user.id,status:"active",latestEventSequence:0,startedAt:createdAt,createdAt,updatedAt:createdAt}).onConflictDoNothing();await tx.insert(attemptEvents).values({id:randomUUID(),attemptId,sequence:0,type:"attempt_started",source:"system",payload:{questionId,...(body.replacesQuestionId?{replacesQuestionId:body.replacesQuestionId}:{})},schemaVersion:1,occurredAt:createdAt}).onConflictDoNothing();if(typeof body.replacesQuestionId==="string")await tx.update(questions).set({status:"abandoned",updatedAt:createdAt}).where(eq(questions.id,body.replacesQuestionId));});return reply.code(201).send({id:questionId,attemptId});});
  app.post("/v1/abilities",async(request,reply)=>{const user=await requireUser(request);const body=request.body as Record<string,unknown>;const id=String(body.id??"");const title=String(body.title??"").trim();const markdown=String(body.markdown??"");const version=Number(body.version??0);const status=String(body.status??"uncertain");if(!/^[0-9a-f-]{36}$/i.test(id)||title.length<2||markdown.length<20||!Number.isInteger(version)||version<1)return reply.code(400).send({error:"Invalid ability version"});const updatedAt=new Date(String(body.updatedAt??new Date().toISOString()));
    /* The device has been sending all four of these since abilities grew past a
       markdown blob; the server discarded them, so a restored ability lost its
       one-line claim, its drills and the moment it was earned. */
    const summary=String(body.summary??"").slice(0,400);
    const practice=Array.isArray(body.practice)?body.practice.map(String).slice(0,12):[];
    const earnedAt=typeof body.earnedAt==="string"?new Date(body.earnedAt):null;
    const conceptSlugs=Array.isArray(body.concepts)?body.concepts.map(String).slice(0,24):[];
    /* No fabricated `concept_nodes` row any more. One was invented per ability
       purely to satisfy a not-null `concept_id`, which filled the shared
       taxonomy with per-learner junk nobody could query. `conceptSlugs` carries
       the real tags and the column is nullable. */
    await db.transaction(async(tx)=>{await tx.insert(abilityDocuments).values({id,userId:user.id,conceptId:null,title,summary,practice,earnedAt,conceptSlugs,status,currentVersion:version,searchText:`${title}\n${markdown}`,lastObservedAt:null,createdAt:updatedAt,updatedAt}).onConflictDoUpdate({target:abilityDocuments.id,set:{title,summary,practice,earnedAt,conceptSlugs,status,currentVersion:version,searchText:`${title}\n${markdown}`,updatedAt}});await tx.insert(abilityDocumentVersions).values({id:randomUUID(),abilityDocumentId:id,version,markdown,reason:version===1?"Introduced by Spar":"Updated from attempt evidence",createdAt:updatedAt}).onConflictDoNothing();const versionRow=await tx.select({id:abilityDocumentVersions.id}).from(abilityDocumentVersions).where(and(eq(abilityDocumentVersions.abilityDocumentId,id),eq(abilityDocumentVersions.version,version))).limit(1);const requested=Array.isArray(body.evidenceEventIds)?body.evidenceEventIds.map(String).filter((value)=>/^[0-9a-f-]{36}$/i.test(value)):[];if(versionRow[0]&&requested.length){const owned=await tx.select({id:attemptEvents.id}).from(attemptEvents).innerJoin(attempts,eq(attemptEvents.attemptId,attempts.id)).where(and(eq(attempts.userId,user.id),inArray(attemptEvents.id,requested)));if(owned.length)await tx.insert(abilityEvidenceLinks).values(owned.map((event)=>({abilityDocumentVersionId:versionRow[0]!.id,attemptEventId:event.id,description:"Linked by Spar from deterministic attempt evidence."}))).onConflictDoNothing();}});return reply.code(201).send({id,version});});
  app.get("/v1/sessions/:id/checkpoints/latest", async (request,reply)=>{const user=await requireUser(request);const id=String((request.params as {id:string}).id);const row=await db.select().from(sessionCheckpoints).where(and(eq(sessionCheckpoints.sessionId,id),eq(sessionCheckpoints.userId,user.id))).orderBy(desc(sessionCheckpoints.version)).limit(1);return row[0]?.payload??reply.code(404).send({error:"Checkpoint not found"});});
  app.put("/v1/sessions/:id/checkpoints/:version", async(request,reply)=>{const user=await requireUser(request);const checkpoint=sessionCheckpointSchema.parse(request.body);const id=String((request.params as {id:string}).id);if(checkpoint.sessionId!==id)return reply.code(400).send({error:"Session mismatch"});const owned=await db.select({id:sessions.id}).from(sessions).where(and(eq(sessions.id,id),eq(sessions.userId,user.id))).limit(1);if(!owned[0])return reply.code(404).send({error:"Session not found"});await db.insert(sessionCheckpoints).values({id:checkpoint.id,sessionId:id,userId:user.id,version:checkpoint.version,eventSequence:checkpoint.eventSequence,payload:checkpoint}).onConflictDoNothing();return reply.code(204).send();});
  app.post("/v1/attempts/:id/events", async(request,reply)=>{const user=await requireUser(request);const value=appendEventsRequestSchema.parse(request.body);const attempt=await db.select().from(attempts).where(and(eq(attempts.id,value.attemptId),eq(attempts.userId,user.id))).limit(1);if(!attempt[0])return reply.code(404).send({error:"Attempt not found"});if(value.expectedSequence!==attempt[0].latestEventSequence+1)return reply.code(409).send({error:"Event sequence conflict",latestSequence:attempt[0].latestEventSequence});await db.transaction(async(tx)=>{await tx.insert(attemptEvents).values(value.events.map(e=>({id:e.id,attemptId:e.attemptId,sequence:e.sequence,type:e.type,source:e.source,payload:e.payload,schemaVersion:e.schemaVersion,occurredAt:new Date(e.occurredAt)}))).onConflictDoNothing();await tx.update(attempts).set({latestEventSequence:value.events.at(-1)!.sequence,updatedAt:new Date()}).where(eq(attempts.id,value.attemptId));});return reply.code(202).send({acceptedThrough:value.events.at(-1)!.sequence});});
  /* ---- The transcript and the learner's own vocabulary --------------------
     Both are pushed from the device outbox in batches and both are replayable:
     an id that has already landed is left alone rather than rewritten. */
  app.post("/v1/agent-messages",async(request,reply)=>{
    const user=await requireUser(request);
    const body=request.body as {sessionId?:unknown;messages?:unknown};
    const sessionId=String(body.sessionId??"");
    if(!uuidPattern.test(sessionId))return reply.code(400).send({error:"Invalid session identity"});
    const owned=await db.select({id:sessions.id}).from(sessions).where(and(eq(sessions.id,sessionId),eq(sessions.userId,user.id))).limit(1);
    if(!owned[0])return reply.code(404).send({error:"Session not found"});
    const rows=(Array.isArray(body.messages)?body.messages:[]).flatMap((value)=>{
      const message=value as {id?:unknown;role?:unknown;body?:unknown;activity?:unknown;createdAt?:unknown};
      if(typeof message?.id!=="string"||!uuidPattern.test(message.id))return [];
      return [{id:message.id,sessionId,role:String(message.role??"agent"),body:String(message.body??""),activity:Array.isArray(message.activity)?message.activity:[],createdAt:new Date(String(message.createdAt??new Date().toISOString()))}];
    });
    if(!rows.length)return reply.code(400).send({error:"No messages to store"});
    await db.insert(agentMessages).values(rows).onConflictDoNothing();
    return reply.code(202).send({stored:rows.length});
  });
  app.post("/v1/concepts",async(request,reply)=>{
    const user=await requireUser(request);
    const body=request.body as {concepts?:unknown};
    const now=new Date();
    const rows=(Array.isArray(body.concepts)?body.concepts:[]).flatMap((value)=>{
      const concept=value as {slug?:unknown;title?:unknown;kind?:unknown;parentSlug?:unknown;description?:unknown};
      if(typeof concept?.slug!=="string"||!concept.slug)return [];
      return [{userId:user.id,slug:concept.slug.slice(0,120),title:String(concept.title??concept.slug).slice(0,160),kind:String(concept.kind??"topic"),parentSlug:typeof concept.parentSlug==="string"?concept.parentSlug:null,description:String(concept.description??""),createdAt:now,updatedAt:now}];
    });
    if(!rows.length)return reply.code(400).send({error:"No concepts to store"});
    await db.insert(learnerConcepts).values(rows).onConflictDoNothing();
    return reply.code(202).send({stored:rows.length});
  });

  /* ---- Restore -------------------------------------------------------------
     The pull half of sync, and the reason an account means anything on a second
     machine. Two calls rather than one: the manifest is small and answers "who
     is this and what do they have", and the sessions come in batches so a heavy
     account neither blows the function's 30 seconds nor leaves the device unable
     to report progress.

     Nothing here mutates. A restore that is interrupted is retried from the
     manifest, and the device decides what it still needs. */
  app.get("/v1/restore/manifest",async(request)=>{
    const user=await requireUser(request);
    const [settings,concepts,abilityRows,sessionRows]=await Promise.all([
      db.select({settings:userSettings.settings}).from(userSettings).where(eq(userSettings.userId,user.id)).limit(1),
      db.select({slug:learnerConcepts.slug,title:learnerConcepts.title,kind:learnerConcepts.kind,parentSlug:learnerConcepts.parentSlug,description:learnerConcepts.description}).from(learnerConcepts).where(eq(learnerConcepts.userId,user.id)),
      db.select({id:abilityDocuments.id,title:abilityDocuments.title,summary:abilityDocuments.summary,practice:abilityDocuments.practice,earnedAt:abilityDocuments.earnedAt,conceptSlugs:abilityDocuments.conceptSlugs,status:abilityDocuments.status,version:abilityDocuments.currentVersion,updatedAt:abilityDocuments.updatedAt}).from(abilityDocuments).where(eq(abilityDocuments.userId,user.id)),
      db.select({id:sessions.id,updatedAt:sessions.updatedAt}).from(sessions).where(eq(sessions.userId,user.id)).orderBy(desc(sessions.updatedAt)),
    ]);
    /* The markdown lives on the version row, so the current one is fetched
       alongside — an ability without its document restores as a title. */
    const ids=abilityRows.map((row)=>row.id);
    const versions=ids.length?await db.select({abilityDocumentId:abilityDocumentVersions.abilityDocumentId,version:abilityDocumentVersions.version,markdown:abilityDocumentVersions.markdown}).from(abilityDocumentVersions).where(inArray(abilityDocumentVersions.abilityDocumentId,ids)):[];
    const markdownFor=new Map(versions.map((row)=>[`${row.abilityDocumentId}:${row.version}`,row.markdown]));
    const profile=learnerProfileSchema.safeParse(settings[0]?.settings?.profile);
    return {
      profile:profile.success?profile.data:null,
      learningState:settings[0]?.settings?.learningState??null,
      concepts,
      abilities:abilityRows.map((row)=>({...row,markdown:markdownFor.get(`${row.id}:${row.version}`)??""})),
      sessions:sessionRows,
    };
  });
  app.get("/v1/restore/sessions",async(request,reply)=>{
    const user=await requireUser(request);
    const requested=String((request.query as {ids?:unknown}).ids??"").split(",").map((value)=>value.trim()).filter((value)=>uuidPattern.test(value));
    if(!requested.length)return reply.code(400).send({error:"No sessions requested"});
    if(requested.length>RESTORE_BATCH)return reply.code(400).send({error:`Ask for at most ${RESTORE_BATCH} sessions at a time`});
    /* Ownership is settled once, here, and every query below is scoped to what
       came back — so a request naming somebody else's session ids gets an empty
       answer rather than their work. */
    const owned=await db.select().from(sessions).where(and(eq(sessions.userId,user.id),inArray(sessions.id,requested)));
    if(!owned.length)return {sessions:[]};
    const ids=owned.map((row)=>row.id);
    const [targets,questionRows,attemptRows,messages,checkpoints]=await Promise.all([
      db.select().from(trainingTargets).where(inArray(trainingTargets.sessionId,ids)),
      db.select({question:questions,manifest:challengeArtifacts.manifest,report:challengeArtifacts.validationReport}).from(questions).leftJoin(challengeArtifacts,eq(questions.challengeArtifactId,challengeArtifacts.id)).where(inArray(questions.sessionId,ids)).orderBy(asc(questions.ordinal)),
      db.select({attempt:attempts,sessionId:questions.sessionId}).from(attempts).innerJoin(questions,eq(attempts.questionId,questions.id)).where(inArray(questions.sessionId,ids)),
      db.select().from(agentMessages).where(inArray(agentMessages.sessionId,ids)).orderBy(asc(agentMessages.createdAt)),
      db.select({sessionId:sessionCheckpoints.sessionId,version:sessionCheckpoints.version,payload:sessionCheckpoints.payload}).from(sessionCheckpoints).where(inArray(sessionCheckpoints.sessionId,ids)).orderBy(desc(sessionCheckpoints.version)),
    ]);
    const attemptIds=attemptRows.map((row)=>row.attempt.id);
    const events=attemptIds.length?await db.select().from(attemptEvents).where(inArray(attemptEvents.attemptId,attemptIds)).orderBy(asc(attemptEvents.sequence)):[];
    const bySession=<T>(rows:T[],key:(row:T)=>string)=>{
      const map=new Map<string,T[]>();
      for(const row of rows){const id=key(row);const held=map.get(id);if(held)held.push(row);else map.set(id,[row]);}
      return map;
    };
    const targetsBy=bySession(targets,(row)=>row.sessionId);
    const questionsBy=bySession(questionRows,(row)=>row.question.sessionId);
    const attemptsBy=bySession(attemptRows,(row)=>row.sessionId);
    const messagesBy=bySession(messages,(row)=>row.sessionId);
    const eventsBy=bySession(events,(row)=>row.attemptId);
    /* Ordered by version descending above, so the first one seen per session is
       the latest — which is the only one a restore wants. */
    const latestCheckpoint=new Map<string,unknown>();
    for(const row of checkpoints)if(!latestCheckpoint.has(row.sessionId))latestCheckpoint.set(row.sessionId,row.payload);
    return {
      sessions:owned.map((session)=>({
        session,
        targets:targetsBy.get(session.id)??[],
        questions:(questionsBy.get(session.id)??[]).map((row)=>({...row.question,design:row.manifest??null,report:row.report??null})),
        attempts:(attemptsBy.get(session.id)??[]).map((row)=>({...row.attempt,events:eventsBy.get(row.attempt.id)??[]})),
        messages:messagesBy.get(session.id)??[],
        checkpoint:latestCheckpoint.get(session.id)??null,
      })),
    };
  });

  app.post("/v1/storage/upload",async(request,reply)=>{const user=await requireUser(request);if(!storage)return reply.code(503).send({error:"Object storage unavailable"});const body=request.body as {kind?:string;id?:string;contentType?:string};if(!["workspace","challenge"].includes(String(body.kind))||!body.id)return reply.code(400).send({error:"Invalid artifact"});const key=`users/${user.id}/${body.kind}/${body.id}`;return{key,url:await storage.uploadUrl(key,body.contentType)};});
}
