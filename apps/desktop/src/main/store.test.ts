import { describe,expect,it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { LocalStore } from "./store.js";
import type { QuestionDesign } from "@spar/domain";

const design=(title:string):QuestionDesign=>({title,language:"javascript",kind:"function",statement:"Implement the target behavior while preserving the declared invariant through every transition.",starterFiles:{"src/index.js":"export function solve(){ throw new Error(\"implement\") }"},referenceFiles:{"src/index.js":"export function solve(){ return true }"},visibleTests:{"tests/visible.test.js":"// visible"},hiddenTests:{"tests/hidden.test.js":"// hidden"},knownIncorrectFiles:[{"src/index.js":"export function solve(){ return false }"}],runCommand:"node --test",accidentalDifficulty:[],expectedFailureSignatures:["returns before restoring the invariant"]});

it("persists the device theme across store reloads",()=>{const directory=mkdtempSync(path.join(tmpdir(),"spar-theme-"));const database=path.join(directory,"state.sqlite3");try{const first=new LocalStore(database);first.setSetting("theme","dark");first.close();const reopened=new LocalStore(database);try{expect(reopened.getSetting("theme","system")).toBe("dark");}finally{reopened.close();}}finally{rmSync(directory,{recursive:true,force:true});}});

it("migrates legacy sessions into one living Track instead of one Track each",()=>{const directory=mkdtempSync(path.join(tmpdir(),"spar-track-migration-"));const database=path.join(directory,"state.sqlite3");try{const before=new LocalStore(database);before.createSession("Practise arrays");before.createSession("Trace the JavaScript runtime");before.close();const legacy=new Database(database);legacy.prepare("UPDATE sessions SET track_id=NULL").run();legacy.prepare("DELETE FROM tracks").run();legacy.prepare("DELETE FROM settings WHERE key='active-track-id'").run();legacy.close();const migrated=new LocalStore(database);try{expect(migrated.listTracks()).toEqual([expect.objectContaining({title:"General practice"})]);const trackIds=new Set(migrated.listSessions().map((session)=>session.trackId));expect(trackIds.size).toBe(1);expect(trackIds.has(migrated.activeTrack()?.id??"")).toBe(true);}finally{migrated.close();}}finally{rmSync(directory,{recursive:true,force:true});}});

it("clears learner data without erasing device preferences",()=>{const store=new LocalStore(":memory:");try{store.setSetting("theme","dark");const {sessionId}=store.createSession("Practise JavaScript arrays");store.setTrainingTarget(sessionId,{ability:"Arrays",specificGap:"Filter values",desiredEvidence:"Uses filter",avoidTesting:[]});store.createQuestion(sessionId,design("Filter values"),{valid:true});store.clearAccountData();expect(store.listSessions()).toEqual([]);expect(store.listAbilities()).toEqual([]);expect(store.getSetting("theme","system")).toBe("dark");}finally{store.close();}});

it("keeps the onboarding profile out of the next account",()=>{const store=new LocalStore(":memory:");try{const profile={name:"Abhinav",experience:"working" as const,focus:["Async and concurrency"],weakness:"I never know what needs awaiting.",language:"typescript" as const,completedAt:new Date().toISOString()};store.saveProfile(profile);expect(store.getProfile()).toEqual(profile);store.setPreferredLanguage("cpp");expect(store.getProfile()?.language).toBe("cpp");
  // Sign-out wipes account state, and the profile is account state: leaving it
  // behind would skip onboarding for whoever signs in next, on their predecessor's answers.
  store.clearAccountData();expect(store.getProfile()).toBeNull();}finally{store.close();}});

describe("local learning state",()=>{it("persists an evidence-bearing two-question adaptive chain",()=>{const store=new LocalStore(":memory:");try{const {sessionId}=store.createSession("Learn invariant-driven algorithms deeply");store.setObjective(sessionId,"Distinguish recognizing an invariant from restoring it repeatedly.");const first=store.setTrainingTarget(sessionId,{ability:"Invariant restoration",specificGap:"Repeated restoration after one mutation",desiredEvidence:"Uses a loop until validity returns",avoidTesting:["parsing"]});const q1=store.createQuestion(sessionId,design("Restore the window"),{valid:true});const remark=randomUUID();store.appendEvent({id:remark,attemptId:q1.attemptId,sequence:1,type:"learner_remark",occurredAt:new Date().toISOString(),payload:{body:"I know the invariant but I only repaired it once."},source:"learner",schemaVersion:1});
/* Cited, not merely written beside: confidence follows the number of linked
   evidence events, so an update with nothing behind it correctly stays
   uncertain. This chain claims to be evidence-bearing, so it cites the remark. */
store.updateAbility({abilityId:first.abilityId,markdown:"# Invariant restoration\n\nRecognizes the invariant; repeated restoration remains uncertain.",evidenceEventIds:[remark]});store.completeAttempt(q1.attemptId,"passed");store.setTrainingTarget(sessionId,{ability:"Invariant restoration",specificGap:"Transfer repeated restoration to an event stream",desiredEvidence:"Restores validity independently in a new representation",avoidTesting:["advanced syntax"]});store.createQuestion(sessionId,design("Repair the event stream"),{valid:true});const detail=store.readSession(sessionId);expect(detail?.summary.questionTitles).toHaveLength(2);expect(detail?.summary.completedQuestions).toBe(1);expect(detail?.question?.title).toBe("Repair the event stream");expect(store.readAbility(first.abilityId)).toMatchObject({version:1,status:"developing"});expect(store.readAttempt(q1.attemptId)).toEqual(expect.arrayContaining([expect.objectContaining({type:"learner_remark"})]));}finally{store.close();}});});

it("durably pauses an evidence-empty session for placement",()=>{const store=new LocalStore(":memory:");try{const{sessionId}=store.createSession("Understand the Node.js event loop");expect(store.hasLearnerEvidence()).toBe(false);const intake={questions:[{header:"Experience",question:"How comfortable are you with callbacks and Promises?",options:[{label:"New — I have not used them"},{label:"Some — I have seen them in small programs"}],multiple:false,custom:true}]};store.setPendingIntake(sessionId,intake);expect(store.readSession(sessionId)?.pendingLearnerQuestion?.questions[0]?.question).toContain("Promises");store.answerIntake(sessionId,"I have not used Promises yet.");expect(store.readSession(sessionId)?.pendingLearnerQuestion).toBeNull();expect(store.answeredIntake(sessionId)).toBe("I have not used Promises yet.");expect(store.setPendingIntake(sessionId,intake).status).toBe("answered");expect(store.readSession(sessionId)?.pendingLearnerQuestion).toBeNull();const target=store.setTrainingTarget(sessionId,{ability:"Function-call sequencing",specificGap:"Follow ordinary calls before asynchronous scheduling",desiredEvidence:"Predicts direct calls",avoidTesting:["Promises","timers"]});store.createQuestion(sessionId,{...design("Trace direct calls"),difficulty:"foundation"},{valid:true});const detail=store.readSession(sessionId);expect(detail?.question?.difficulty).toBe("foundation");expect(detail?.question?.abilityId).toBe(target.abilityId);}finally{store.close();}});

it("allocates live attempt sequences inside the authoritative transaction",()=>{const store=new LocalStore(":memory:");try{const{sessionId}=store.createSession("Practise JavaScript");store.setTrainingTarget(sessionId,{ability:"Control flow",specificGap:"Trace branches",desiredEvidence:"Explains the selected branch",avoidTesting:[]});const question=store.createQuestion(sessionId,design("Trace a branch"),{valid:true});const base={attemptId:question.attemptId,occurredAt:new Date().toISOString(),source:"learner" as const,schemaVersion:1 as const};const first=store.appendNextEvent({...base,id:randomUUID(),type:"file_changed",payload:{path:"src/index.js"}});const second=store.appendNextEvent({...base,id:randomUUID(),type:"learner_remark",payload:{body:"I expect the first branch."}});expect([first.sequence,second.sequence]).toEqual([1,2]);expect(store.readSession(sessionId)?.question?.latestEventSequence).toBe(2);expect(store.readAttempt(question.attemptId)).toEqual(expect.arrayContaining([expect.objectContaining({sequence:1,type:"file_changed"}),expect.objectContaining({sequence:2,type:"learner_remark"})]));}finally{store.close();}});

it("starts a synced evidence boundary when an attempt is reset",()=>{const store=new LocalStore(":memory:");try{const{sessionId}=store.createSession("Practise JavaScript");store.setTrainingTarget(sessionId,{ability:"Control flow",specificGap:"Trace branches",desiredEvidence:"Explains the selected branch",avoidTesting:[]});const question=store.createQuestion(sessionId,design("Trace a branch"),{valid:true});store.appendNextEvent({id:randomUUID(),attemptId:question.attemptId,type:"learner_remark",occurredAt:new Date(Date.now()-1_000).toISOString(),payload:{body:"private-before-reset clue"},source:"learner",schemaVersion:1});store.appendNextEvent({id:randomUUID(),attemptId:question.attemptId,type:"test_run",occurredAt:new Date(Date.now()-500).toISOString(),payload:{scope:"visible",passed:false},source:"runner",schemaVersion:1});const reset=store.resetAttempt(sessionId,question.attemptId);store.appendNextEvent({id:randomUUID(),attemptId:question.attemptId,type:"learner_remark",occurredAt:new Date().toISOString(),payload:{body:"visible-after-reset clue"},source:"learner",schemaVersion:1});const visible=store.readAttempt(question.attemptId);expect(visible.map((event)=>event.sequence)).toEqual([reset.sequence,reset.sequence+1]);expect(visible[0]).toMatchObject({type:"attempt_started",payload:{reset:true}});expect(JSON.stringify(visible)).not.toContain("private-before-reset");expect(store.searchAttempts("private-before-reset",5)).toEqual([]);expect(store.searchAttempts("visible-after-reset",5)).toHaveLength(1);expect(store.listChallenges()[0]?.testRunCount).toBe(0);expect(store.readSession(sessionId)?.question?.attemptStartedAt).toBe(reset.occurredAt);expect(store.pendingSync().some((item)=>item.kind==="attempt-event"&&item.payload.includes(reset.id))).toBe(true);}finally{store.close();}});

it("does not treat unrelated history as evidence for a new goal",()=>{const store=new LocalStore(":memory:");try{const{sessionId}=store.createSession("Practise interval scheduling");const target=store.setTrainingTarget(sessionId,{ability:"Greedy interval scheduling",specificGap:"Endpoint compatibility",desiredEvidence:"Selects a maximum compatible sequence",avoidTesting:[]});store.updateAbility({abilityId:target.abilityId,markdown:"# Greedy interval scheduling\n\nSelects intervals by earliest finish time.",evidenceEventIds:["observed-greedy-choice"]});expect(store.hasRelevantLearnerEvidence("greedy interval scheduling interview")).toBe(true);expect(store.hasRelevantLearnerEvidence("prepare for an AI engineer interview in five days")).toBe(false);}finally{store.close();}});

it("routes cold start from topical evidence rather than language or named prerequisites",()=>{const store=new LocalStore(":memory:");try{const{sessionId}=store.createSession("Practise C++ arrays");store.setTrainingTarget(sessionId,{ability:"Array traversal",specificGap:"Visit each value once",desiredEvidence:"Uses one direct pass",avoidTesting:[]});const question=store.createQuestion(sessionId,{...design("Count array values"),language:"cpp"},{valid:true});expect(store.hasRelevantLearnerEvidence("Teach me arrays in C++")).toBe(false);store.appendNextEvent({id:randomUUID(),attemptId:question.attemptId,type:"file_changed",occurredAt:new Date().toISOString(),payload:{path:"src/solution.cpp"},source:"learner",schemaVersion:1});expect(store.hasRelevantLearnerEvidence("Teach me arrays in C++")).toBe(true);expect(store.hasRelevantLearnerEvidence("Teach me disjoint-set union for DSA from scratch in C++")).toBe(false);expect(store.hasRelevantLearnerEvidence("Teach me dynamic programming from scratch; I know loops and arrays but have never written a recurrence or memo table")).toBe(false);}finally{store.close();}});

it("makes an unconsumed training target idempotent",()=>{const store=new LocalStore(":memory:");try{const{sessionId}=store.createSession("Learn model evaluation");const input={ability:"Model evaluation",specificGap:"Separate ranking from calibration",desiredEvidence:"Chooses the metric matching the decision",avoidTesting:["framework syntax"]};const first=store.setTrainingTarget(sessionId,input);const second=store.setTrainingTarget(sessionId,input);expect(second.id).toBe(first.id);expect(store.readSession(sessionId)?.summary.currentFocus).toEqual(["Model evaluation"]);}finally{store.close();}});

it("rolls back an incomplete planning draft without touching messages",()=>{const store=new LocalStore(":memory:");try{const{sessionId}=store.createSession("Prepare for an AI engineer interview");store.addMessage(sessionId,"learner","I have five days.");store.setObjective(sessionId,"Draft objective that never reached a playable question");store.setTrainingTarget(sessionId,{ability:"Unrelated stale target",specificGap:"Draft gap",desiredEvidence:"Draft evidence",avoidTesting:[]});expect(store.resetIncompletePlanning(sessionId)).toBe(true);const detail=store.readSession(sessionId);expect(detail?.summary.objective).toBe("Investigating your prior evidence and defining the first training target.");expect(detail?.summary.currentFocus).toEqual([]);expect(detail?.messages).toHaveLength(1);expect(store.latestTarget(sessionId)).toBeUndefined();}finally{store.close();}});

it("preserves challenge test history and links an adaptive replacement",()=>{const store=new LocalStore(":memory:");try{const{sessionId}=store.createSession("Practise loops");store.setTrainingTarget(sessionId,{ability:"Loop control",specificGap:"Count matching values",desiredEvidence:"Uses one direct loop",avoidTesting:[]});const first=store.createQuestion(sessionId,design("Count values"),{valid:true});store.appendNextEvent({id:randomUUID(),attemptId:first.attemptId,type:"test_run",occurredAt:new Date().toISOString(),payload:{scope:"visible",passed:false,exitCode:1},source:"runner",schemaVersion:1});store.setTrainingTarget(sessionId,{ability:"Loop control",specificGap:"Count positive values",desiredEvidence:"Uses one condition inside a loop",avoidTesting:[]});const second=store.replaceQuestion(sessionId,design("Count positive values"),{valid:true},"The first challenge was too difficult.");const history=store.listChallenges();expect(second.ordinal).toBe(2);expect(history).toEqual(expect.arrayContaining([expect.objectContaining({id:first.id,testRunCount:1,replacedByQuestionId:second.id,lastOutcome:"replaced"}),expect.objectContaining({id:second.id,replacesQuestionId:first.id})]));expect(store.readChallenge(first.id)).toMatchObject({design:{title:"Count values"},attempts:[{events:expect.arrayContaining([expect.objectContaining({type:"test_run"})])}]});}finally{store.close();}});

it("files a session away without disturbing what was last worked on",()=>{const store=new LocalStore(":memory:");try{const first=store.createSession("Practise dynamic programming");store.createSession("Practise graph traversal");const before=store.listSessions().map((session)=>session.updatedAt).sort();store.renameSession(first.sessionId,"  Dynamic programming  ");store.setSessionPinned(first.sessionId,true);const listed=store.listSessions();
  // Pinned to the top, renamed, and every last-touched time exactly as it was:
  // tidying the list is not work on the goal, and bumping it would shuffle what
  // the learner just organized straight back down.
  expect(listed[0]).toMatchObject({id:first.sessionId,title:"Dynamic programming"});expect(listed.map((session)=>session.updatedAt).sort()).toEqual(before);
  store.setSessionArchived(first.sessionId,true);expect(store.listSessions().find((session)=>session.id===first.sessionId)).toMatchObject({pinnedAt:null,archivedAt:expect.any(String)});
  store.setSessionArchived(first.sessionId,false);expect(store.listSessions().find((session)=>session.id===first.sessionId)?.archivedAt).toBeNull();
  expect(store.pendingSync().map((item)=>item.kind)).toContain("session-rename");}finally{store.close();}});

it("takes a deleted session's evidence with it and keeps the ability it taught",()=>{const store=new LocalStore(":memory:");try{const{sessionId}=store.createSession("Practise recursion");const target=store.setTrainingTarget(sessionId,{ability:"Recursion",specificGap:"Base cases",desiredEvidence:"States the base case before recurring",avoidTesting:[]});const question=store.createQuestion(sessionId,design("Sum a tree"),{valid:true});store.updateAbility({abilityId:target.abilityId,markdown:"# Recursion\n\nStates the base case before recurring.",evidenceEventIds:[]});store.addMessage(sessionId,"learner","Where should I start?");expect(store.deleteSession(sessionId)).toBe(true);expect(store.listSessions()).toEqual([]);expect(store.readSession(sessionId)).toBeNull();expect(store.readAttempt(question.attemptId)).toEqual([]);expect(store.listChallenges()).toEqual([]);
  // What Spar learned about the learner is not the session's to take with it.
  expect(store.listAbilities()).toHaveLength(1);expect(store.pendingSync().map((item)=>item.kind)).toContain("session-delete");
  // A turn that outlived the row it was writing for, and a second delete of the
  // same session, both have to be survivable rather than throwing.
  expect(store.addMessage(sessionId,"agent","An answer that arrived too late")).toBeNull();expect(store.deleteSession(sessionId)).toBe(false);}finally{store.close();}});

/** Two graded challenges under one area: a passed one tagged with two-pointers and
 *  a failed one tagged with the in-place pass. The whole point of the rollups is
 *  that the area shows both while each sub-concept keeps its own verdict. */
function taggedHistory(store:LocalStore){
  const {sessionId}=store.createSession("Get reliably good at array passes");
  const target=store.setTrainingTarget(sessionId,{ability:"Array passes",specificGap:"Rewriting a sequence while reading it",desiredEvidence:"Keeps the read and write positions distinct",avoidTesting:[]});
  // Setting a target introduces the ability it names, exactly as the training
  // tool does — without the row, the target points at an ability that has no
  // document behind it and the ledger cannot show what the session was for.
  store.ensureAbility(target.abilityId,target.abilityTitle);
  const passed=store.createQuestion(sessionId,design("Meet in the middle"),{valid:true},{concepts:[{slug:"two-pointers",role:"primary"},{slug:"index-arithmetic",role:"supporting"}]});
  store.appendNextEvent({id:randomUUID(),attemptId:passed.attemptId,type:"attempt_completed",occurredAt:new Date().toISOString(),payload:{outcome:"passed"},source:"system",schemaVersion:1});
  store.completeAttempt(passed.attemptId,"passed");
  const failed=store.createQuestion(sessionId,design("Compact in place"),{valid:true},{concepts:[{slug:"in-place-mutation",role:"primary"}]});
  store.appendNextEvent({id:randomUUID(),attemptId:failed.attemptId,type:"test_run",occurredAt:new Date().toISOString(),payload:{passed:false},source:"runner",schemaVersion:1});
  const evidence=store.appendNextEvent({id:randomUUID(),attemptId:failed.attemptId,type:"attempt_completed",occurredAt:new Date().toISOString(),payload:{outcome:"failed"},source:"system",schemaVersion:1});
  store.completeAttempt(failed.attemptId,"failed");
  return {sessionId,abilityId:target.abilityId,passed,failed,evidence};
}

it("rolls a sub-concept's evidence into its area without averaging the finding away",()=>{const store=new LocalStore(":memory:");try{
  taggedHistory(store);
  const concepts=new Map(store.listConcepts().map((concept)=>[concept.slug,concept]));
  // The area sees both challenges; each sub-concept sees only its own.
  expect(concepts.get("arrays")).toMatchObject({challengeCount:2,passedCount:1,failedCount:1});
  expect(concepts.get("two-pointers")).toMatchObject({challengeCount:1,passedCount:1,failedCount:0});
  expect(concepts.get("in-place-mutation")).toMatchObject({challengeCount:1,passedCount:0,failedCount:1});
  // Which is the whole point: "arrays" reads uneven, and the specific pass that
  // is failing is still nameable underneath it.
  const report=store.conceptEvidenceReport("arrays")[0]!;
  expect(report.standing).toBe("uneven");
  expect(report.subConcepts.find((child)=>child.slug==="in-place-mutation")?.standing).toBe("shaky");
  expect(report.subConcepts.find((child)=>child.slug==="two-pointers")?.standing).toBe("steady");
  // A concept nobody has been tested on is absent from the learner's list, but
  // still reachable in the vocabulary the agent chooses tags from.
  expect(concepts.has("cycle-detection")).toBe(false);
  expect(store.conceptGraph("linked list cycles").map((concept)=>concept.slug)).toContain("cycle-detection");
}finally{store.close();}});

it("counts a challenge once for its area however many of that area's concepts it carries",()=>{const store=new LocalStore(":memory:");try{
  const {sessionId}=store.createSession("Practise windows");
  store.setTrainingTarget(sessionId,{ability:"Windows",specificGap:"Shrinking until valid",desiredEvidence:"Shrinks repeatedly",avoidTesting:[]});
  const question=store.createQuestion(sessionId,design("Shrink until valid"),{valid:true},{concepts:[{slug:"window-invariant-restoration",role:"primary"},{slug:"window-shrink-condition",role:"supporting"},{slug:"variable-window",role:"supporting"}]});
  store.appendNextEvent({id:randomUUID(),attemptId:question.attemptId,type:"attempt_completed",occurredAt:new Date().toISOString(),payload:{outcome:"passed"},source:"system",schemaVersion:1});
  store.completeAttempt(question.attemptId,"passed");
  const area=store.listConcepts().find((concept)=>concept.slug==="sliding-window");
  expect(area).toMatchObject({challengeCount:1,passedCount:1});
  // Tagged primary on a sub-concept, so the area inherits the strongest role
  // rather than filing its own challenge as merely supporting.
  expect(store.conceptChallenges("sliding-window")[0]?.role).toBe("primary");
}finally{store.close();}});

it("names a concept the taxonomy never anticipated instead of refusing the tag",()=>{const store=new LocalStore(":memory:");try{
  const {sessionId}=store.createSession("Practise WebGPU compute shaders");
  store.setTrainingTarget(sessionId,{ability:"Compute shaders",specificGap:"Workgroup sizing",desiredEvidence:"Sizes a workgroup",avoidTesting:[]});
  store.createQuestion(sessionId,design("Size a workgroup"),{valid:true},{concepts:[{slug:"Workgroup Sizing",title:"Workgroup sizing",kind:"engineering",parentSlug:"gpu-compute",role:"primary"}]});
  const invented=store.listConcepts().find((concept)=>concept.slug==="workgroup-sizing");
  // Normalized on the way in, and filed under an area created for it, so the
  // next turn finds one concept rather than three spellings of it.
  expect(invented).toMatchObject({title:"Workgroup sizing",parentSlug:"gpu-compute",challengeCount:1});
  expect(store.listConcepts().find((concept)=>concept.slug==="gpu-compute")?.challengeCount).toBe(1);
  // Invented vocabulary names what this learner was working on, so it does not
  // survive to the next account. The shipped taxonomy does.
  store.clearAccountData();
  expect(store.conceptGraph("workgroup sizing").map((concept)=>concept.slug)).not.toContain("workgroup-sizing");
  expect(store.conceptGraph("two pointers").map((concept)=>concept.slug)).toContain("two-pointers");
}finally{store.close();}});

it("earns an ability from evidence and keeps the date it was earned",()=>{const store=new LocalStore(":memory:");try{
  const history=taggedHistory(store);
  const forming=store.upsertAbility({title:"Two-pointer passes",markdown:"# Two-pointer passes\n\nIntroduced as a hypothesis from the stated goal.",evidenceEventIds:[]});
  // Introduced is not earned. Nothing has been observed yet, so it says so.
  expect(forming).toMatchObject({status:"uncertain",earnedAt:null});
  const earned=store.upsertAbility({title:"Two-pointer passes",markdown:"# Two-pointer passes\n\nHolds two indices under a rule.",summary:"You can hold two indices under a rule instead of scanning twice.",evidenceEventIds:[history.evidence.id],concepts:[{slug:"two-pointers"},{slug:"index-arithmetic"}],practice:["I want to try two pointers on a linked list instead of an array."]});
  expect(earned).toMatchObject({status:"developing",summary:"You can hold two indices under a rule instead of scanning twice."});
  expect(earned.earnedAt).not.toBeNull();
  expect(earned.concepts.map((concept)=>concept.slug).sort()).toEqual(["index-arithmetic","two-pointers"]);
  // Later versions revise the document; the moment it was earned is not revised.
  const revised=store.upsertAbility({title:"Two-pointer passes",markdown:"# Two-pointer passes\n\nRevised after another attempt.",evidenceEventIds:[]});
  expect(revised.earnedAt).toBe(earned.earnedAt);
  expect(revised.version).toBe(3);
  // The ability reaches challenge history through the target it was set from.
  const detail=store.readAbilityDetail(history.abilityId);
  expect(detail?.evidence.map((item)=>item.outcome).sort()).toEqual(["failed","passed"]);
  // And the concepts it claims are what pull it into the concept sheet.
  expect(store.conceptDetail("two-pointers")?.abilities.map((ability)=>ability.title)).toEqual(["Two-pointer passes"]);
}finally{store.close();}});

it("carries a challenge's concepts on its history row, primary first",()=>{const store=new LocalStore(":memory:");try{
  taggedHistory(store);
  const row=store.listChallenges().find((challenge)=>challenge.title==="Meet in the middle")!;
  expect(row.concepts.map((concept)=>concept.slug)).toEqual(["two-pointers","index-arithmetic"]);
  expect(row.concepts[0]).toMatchObject({role:"primary",parentTitle:"Arrays & sequences"});
  // Tagged, therefore searchable: the words never appear in the title.
  expect(store.searchChallenges("two pointers",5).map((challenge)=>challenge.title)).toContain("Meet in the middle");
}finally{store.close();}});

/* A finished turn used to collapse to its last sentence: the tool steps lived
   only in the live stream, and the renderer dropped that the moment the turn
   ended. They are stored with the reply now, including for a turn whose whole
   answer was a challenge rather than a sentence. */
it("keeps a turn's activity with the reply it produced",()=>{const store=new LocalStore(":memory:");try{
  const{sessionId}=store.createSession("Practise sliding windows");
  const tool=(tool:string,label:string,detail:string)=>({kind:"tool" as const,tool,label,actionTitle:"",detail,ok:true,text:"",seconds:0,input:"",output:""});
  store.addMessage(sessionId,"agent","Here is what I found.",[
    {kind:"reasoning",tool:"",label:"",actionTitle:"",detail:"",ok:true,text:"The shrink case is the one that keeps breaking.",seconds:7,input:"",output:""},
    tool("replay_attempt","full log · case history","34m on it · 5 runs"),
    tool("search_concept_evidence","window-invariant-restoration","1 result"),
  ]);
  // No reply at all, which is what an attempt-complete turn produces.
  store.addMessage(sessionId,"agent","",[tool("create_question","Restore the window","status playable")]);

  const messages=store.readSession(sessionId)?.messages??[];
  // Order is preserved, and the thinking is stored beside the calls it led to.
  expect(messages[0]?.activity.map((step)=>step.kind)).toEqual(["reasoning","tool","tool"]);
  expect(messages[0]?.activity[0]?.text).toContain("shrink case");
  expect(messages[0]?.activity[0]?.seconds).toBe(7);
  expect(messages[0]?.activity.map((step)=>step.tool)).toEqual(["","replay_attempt","search_concept_evidence"]);
  expect(messages[0]?.activity[1]?.detail).toBe("34m on it · 5 runs");
  expect(messages[1]?.body).toBe("");
  expect(messages[1]?.activity).toHaveLength(1);
  // A learner message carries none, and reads back as an empty list rather than undefined.
  store.addMessage(sessionId,"learner","thanks");
  expect(store.readSession(sessionId)?.messages.at(-1)?.activity).toEqual([]);
}finally{store.close();}});

/* ---- Restore --------------------------------------------------------------
   The pull half of sync. These tests exist because the two ways this can go
   wrong are both silent: a restore that enqueues turns a fresh device into a
   machine that uploads the account back to itself in a loop, and a restore that
   overwrites is a learner losing offline work to a staler cloud copy. */

const restoredSession = (id: string, updatedAt: string) => ({
  session: { id, title: "Sliding windows", originalGoal: "Get good at sliding windows", objective: "Restore the invariant every time", status: "active", totalSeconds: 1_200, currentFocus: ["Invariant restoration"], pinnedAt: null, archivedAt: null, createdAt: updatedAt, updatedAt },
  targets: [{ id: randomUUID(), abilityDocumentId: null, action: "practise", specificGap: "Repeated restoration", desiredEvidence: "Loops until valid", avoidTesting: [], createdAt: updatedAt }],
  questions: [] as never[],
  attempts: [] as never[],
  messages: [{ id: randomUUID(), role: "agent", body: "Let us start with the window.", activity: [], createdAt: updatedAt }],
  checkpoint: null,
});

it("restores an account from the cloud without queueing it straight back",()=>{const store=new LocalStore(":memory:");try{
  const profile={name:"Abhinav",experience:"working" as const,focus:["Async and concurrency"],weakness:"I never know what needs awaiting.",language:"typescript" as const,completedAt:new Date().toISOString()};
  const abilityId=randomUUID();
  const updatedAt=new Date().toISOString();
  store.restoreAccount({
    profile,
    concepts:[{slug:"window-invariant-restoration",title:"Window invariant restoration",kind:"skill",parentSlug:null,description:"Restoring a window's invariant after a mutation."}],
    abilities:[{id:abilityId,title:"Invariant restoration",markdown:"# Invariant restoration\n\nRecognizes the invariant.",summary:"Spots the invariant, repairs it once.",practice:["Restore after two mutations"],earnedAt:updatedAt,conceptSlugs:["window-invariant-restoration"],status:"developing",version:2,updatedAt,evidenceEventIds:[]}],
  });
  const sessionId=randomUUID();
  store.restoreSessions([restoredSession(sessionId,updatedAt)]);

  // The account is on the device, in the shapes the app reads back.
  expect(store.getProfile()).toEqual(profile);
  expect(store.listSessions().map((session)=>session.id)).toEqual([sessionId]);
  expect(store.readAbility(abilityId)).toMatchObject({version:2,status:"developing",summary:"Spots the invariant, repairs it once."});
  expect(store.readSession(sessionId)?.messages.map((message)=>message.body)).toEqual(["Let us start with the window."]);
  expect(store.readSession(sessionId)?.summary.totalSeconds).toBe(1_200);

  /* The point of the whole exercise. Every insert path in LocalStore enqueues,
     which is right when the learner caused the write and catastrophic when the
     cloud did — the device would push all of it back and do it again on the next
     launch. */
  expect(store.pendingSync()).toEqual([]);
}finally{store.close();}});

it("does not let a restore overwrite work done on this device",()=>{const store=new LocalStore(":memory:");try{
  const {sessionId}=store.createSession("Practise sliding windows");
  store.renameSession(sessionId,"My own title");
  // The cloud's copy of the same session, as it was before the rename.
  store.restoreSessions([restoredSession(sessionId,new Date(Date.now()-60_000).toISOString())]);
  expect(store.listSessions()[0]?.title).toBe("My own title");
  // And the device's own pending work is still queued to go up.
  expect(store.pendingSync().map((item)=>item.kind)).toContain("session-rename");
}finally{store.close();}});

/* A device that already holds the session at or past the cloud's version must not
   spend a round trip re-fetching it. This is what makes a reinstall on an account
   with months of history cost one manifest rather than every session in it. */
it("knows which sessions it can skip fetching",()=>{const store=new LocalStore(":memory:");try{
  const {sessionId}=store.createSession("Practise sliding windows");
  const mine=store.listSessions()[0]!.updatedAt;
  expect(store.sessionIsCurrent(sessionId,mine)).toBe(true);
  expect(store.sessionIsCurrent(sessionId,new Date(Date.parse(mine)-1_000).toISOString())).toBe(true);
  expect(store.sessionIsCurrent(sessionId,new Date(Date.parse(mine)+1_000).toISOString())).toBe(false);
  expect(store.sessionIsCurrent(randomUUID(),mine)).toBe(false);
}finally{store.close();}});

/* The profile is what the onboarding gate reads, so it is the one row whose
   sync direction decides whether a returning learner is asked their name again. */
it("pushes the onboarding profile so another machine can skip intake",()=>{const store=new LocalStore(":memory:");try{
  store.saveProfile({name:"Abhinav",experience:"senior",focus:[],weakness:"",language:"cpp",completedAt:new Date().toISOString()});
  expect(store.pendingSync().map((item)=>item.kind)).toContain("profile-save");
}finally{store.close();}});

describe("adaptive product state",()=>{
  it("keeps baseline calibration out of Tracks and ordinary session navigation",()=>{const store=new LocalStore(":memory:");try{
    const training=store.createTrack("Become reliable at backend problem solving","Backend Problem Solving");
    const baseline=store.createBaselineSession();
    expect(store.listTracks()).toEqual([expect.objectContaining({id:training.track.id})]);
    expect(store.activeTrack()?.id).toBe(training.track.id);
    expect(store.readSession(baseline.sessionId)?.summary).toMatchObject({context:"baseline",trackId:null,title:"Baseline"});
    expect(store.getBaseline()).toMatchObject({status:"in-progress",sessionId:baseline.sessionId});
    expect(store.createBaselineSession()).toEqual(baseline);
  }finally{store.close();}});

  it("keeps Tracks separate from the one global learner model",()=>{const store=new LocalStore(":memory:");try{
    const typescript=store.createTrack("Become extremely strong at TypeScript and understand the language deeply");
    const interviews=store.createTrack("Prepare seriously for algorithmic interviews");
    const target=store.setTrainingTarget(typescript.sessionId,{ability:"Invariant restoration",specificGap:"Restore validity after every mutation",desiredEvidence:"Uses a loop until valid",avoidTesting:[]});
    store.ensureAbility(target.abilityId,target.abilityTitle);
    expect(store.listTracks()).toHaveLength(2);
    expect(store.activeTrack()?.id).toBe(interviews.track.id);
    expect(store.abilityStates()).toEqual([expect.objectContaining({abilityId:target.abilityId,trainingStatus:"unknown"})]);
    store.setActiveTrack(typescript.track.id);
    expect(store.abilityStates()[0]?.abilityId).toBe(target.abilityId);
  }finally{store.close();}});

  it("turns linked attempts into confidence without treating one event as mastery",()=>{const store=new LocalStore(":memory:");try{
    const {sessionId}=store.createSession("Practise variable windows");
    const target=store.setTrainingTarget(sessionId,{ability:"Variable-window restoration",specificGap:"Repeat restoration",desiredEvidence:"Shrinks until every condition is valid",avoidTesting:[]});
    store.ensureAbility(target.abilityId,target.abilityTitle);
    const question=store.createQuestion(sessionId,design("Restore repeatedly"),{valid:true});
    const event=store.appendNextEvent({id:randomUUID(),attemptId:question.attemptId,type:"submission_evaluated",occurredAt:new Date().toISOString(),payload:{outcome:"passed"},source:"system",schemaVersion:1});
    store.updateAbility({abilityId:target.abilityId,markdown:"# Variable-window restoration\n\nDirect execution worked once; transfer is untested.",summary:"Direct execution worked once; transfer is untested.",status:"developing",evidenceEventIds:[event.id]});
    expect(store.abilityStates()[0]).toMatchObject({evidenceCount:1,trainingStatus:"training",proficiency:0.55});
    expect(store.abilityStates()[0]!.confidence).toBeLessThan(0.5);
    expect(store.learnerProgress().rating.provisional).toBe(true);
  }finally{store.close();}});

  it("persists baseline, training mode and an inspectable Today decision",()=>{const store=new LocalStore(":memory:");try{
    const created=store.createTrack("Climb Codeforces while keeping practice targeted","Codeforces Climb");
    const target=store.setTrainingTarget(created.sessionId,{ability:"Graph recognition",specificGap:"Recognize implicit graph structure",desiredEvidence:"Models states and transitions independently",avoidTesting:["advanced syntax"],action:"diagnose"});
    store.ensureAbility(target.abilityId,target.abilityTitle);
    store.createQuestion(created.sessionId,design("Hidden transit map"),{valid:true});
    store.setBaseline({status:"in-progress",confidence:0.3,directEvidenceCount:1});
    store.setTrainingMode({kind:"focus",focus:"Graphs"});
    const today=store.todayRecommendation();
    expect(today).toMatchObject({trackTitle:"Codeforces Climb",challengeTitle:"Hidden transit map",abilityTitle:"Graph recognition",intent:"diagnose",mode:{kind:"focus",focus:"Graphs"}});
    expect(store.getBaseline()).toMatchObject({status:"in-progress",directEvidenceCount:1});
    expect(store.learningEngineSnapshot()).toMatchObject({model:{schemaVersion:4},activeTrack:{id:created.track.id}});
  }finally{store.close();}});

  it("requires independent attempts before promoting an observation to a pattern",()=>{const store=new LocalStore(":memory:");try{
    const {sessionId}=store.createSession("Improve boundary-case reasoning");
    const target=store.setTrainingTarget(sessionId,{ability:"Boundary-case reasoning",specificGap:"Empty and singleton inputs",desiredEvidence:"Handles boundaries before the main loop",avoidTesting:[]});
    store.ensureAbility(target.abilityId,target.abilityTitle);
    const first=store.createQuestion(sessionId,design("Empty sequence"),{valid:true});
    const firstEvidence=store.appendNextEvent({id:randomUUID(),attemptId:first.attemptId,type:"submission_evaluated",occurredAt:new Date().toISOString(),payload:{outcome:"failed"},source:"system",schemaVersion:1});
    store.updateAbility({abilityId:target.abilityId,markdown:"# Boundary-case reasoning\n\nAn empty-input miss happened once.",evidenceEventIds:[firstEvidence.id],evidence:[{eventId:firstEvidence.id,statement:"The empty input bypassed the intended initialization.",polarity:"contradictory",independence:"independent",strength:0.7}],pattern:{title:"Boundary assumptions",description:"Initialization assumes at least one item.",status:"pattern",evidenceEventIds:[firstEvidence.id]}});
    expect(store.listPatterns()[0]?.status).toBe("hypothesis");
    store.completeAttempt(first.attemptId,"failed");
    store.setTrainingTarget(sessionId,{ability:"Boundary-case reasoning",specificGap:"Zero-length state",desiredEvidence:"Separates empty state from the ordinary transition",avoidTesting:[]});
    const second=store.createQuestion(sessionId,design("Empty event stream"),{valid:true});
    const secondEvidence=store.appendNextEvent({id:randomUUID(),attemptId:second.attemptId,type:"submission_evaluated",occurredAt:new Date().toISOString(),payload:{outcome:"failed"},source:"system",schemaVersion:1});
    store.updateAbility({abilityId:target.abilityId,markdown:"# Boundary-case reasoning\n\nThe same assumption appeared in a different structure.",evidenceEventIds:[secondEvidence.id],evidence:[{eventId:secondEvidence.id,statement:"The empty stream repeated the non-empty initialization assumption.",polarity:"contradictory",independence:"independent",strength:0.8}],pattern:{title:"Boundary assumptions",description:"Initialization repeatedly assumes at least one item.",status:"pattern",evidenceEventIds:[firstEvidence.id,secondEvidence.id]}});
    expect(store.listPatterns()[0]).toMatchObject({status:"pattern",evidenceCount:2});
  }finally{store.close();}});

  it("compacts and restores the account-wide adaptive projection",()=>{const source=new LocalStore(":memory:");const restored=new LocalStore(":memory:");try{
    const created=source.createTrack("Become deeply fluent in the TypeScript type system","TypeScript Depth");
    const target=source.setTrainingTarget(created.sessionId,{ability:"Generic constraint design",specificGap:"Constrain inference without widening",desiredEvidence:"Preserves the caller's narrow type",avoidTesting:[]});
    source.ensureAbility(target.abilityId,target.abilityTitle);
    source.setBaseline({status:"in-progress",confidence:0.4,directEvidenceCount:1});
    source.setTrainingMode({kind:"focus",focus:"TypeScript"});
    // Several adaptive writes still produce one latest projection. Attempt
    // events remain separate rows and are deliberately not compacted this way.
    expect(source.pendingSync().filter((item)=>item.kind==="learning-state")).toHaveLength(1);

    const ability=source.listAbilities()[0]!;
    restored.restoreAccount({profile:null,concepts:[],abilities:[{id:ability.id,title:ability.title,markdown:ability.markdown,summary:ability.summary,practice:ability.practice,earnedAt:ability.earnedAt,conceptSlugs:[],status:ability.status,version:ability.version,updatedAt:ability.updatedAt,evidenceEventIds:[]}]});
    restored.restoreLearningState(source.cloudLearningState());
    expect(restored.listTracks()).toEqual([expect.objectContaining({title:"TypeScript Depth"})]);
    expect(restored.activeTrack()?.id).toBe(created.track.id);
    expect(restored.getBaseline()).toMatchObject({status:"in-progress",directEvidenceCount:1});
    expect(restored.getTrainingMode()).toEqual({kind:"focus",focus:"TypeScript"});
    expect(restored.abilityStates()).toEqual([expect.objectContaining({abilityId:target.abilityId,trainingStatus:"unknown"})]);
    expect(restored.pendingSync()).toEqual([]);
  }finally{source.close();restored.close();}});

  it("keeps local adaptive work when the cloud projection is older",()=>{const store=new LocalStore(":memory:");try{
    const local=store.createTrack("Prepare seriously for systems interviews","Systems Interview Preparation");
    store.restoreLearningState({version:1,tracks:[{id:randomUUID(),title:"Old cloud track",goal:"Old goal",status:"active",emphasis:[],priorities:[],investigating:[],monitoring:[],createdAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-01T00:00:00.000Z"}]});
    expect(store.activeTrack()?.id).toBe(local.track.id);
    expect(store.listTracks().map((track)=>track.title)).not.toContain("Old cloud track");
  }finally{store.close();}});
});
