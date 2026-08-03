import { describe,expect,it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalStore } from "./store.js";
import type { QuestionDesign } from "@spar/domain";

const design=(title:string):QuestionDesign=>({title,language:"javascript",kind:"function",statement:"Implement the target behavior while preserving the declared invariant through every transition.",starterFiles:{"src/index.js":"export function solve(){ throw new Error(\"implement\") }"},referenceFiles:{"src/index.js":"export function solve(){ return true }"},visibleTests:{"tests/visible.test.js":"// visible"},hiddenTests:{"tests/hidden.test.js":"// hidden"},knownIncorrectFiles:[{"src/index.js":"export function solve(){ return false }"}],runCommand:"node --test",accidentalDifficulty:[],expectedFailureSignatures:["returns before restoring the invariant"]});

it("persists the device theme across store reloads",()=>{const directory=mkdtempSync(path.join(tmpdir(),"spar-theme-"));const database=path.join(directory,"state.sqlite3");try{const first=new LocalStore(database);first.setSetting("theme","dark");first.close();const reopened=new LocalStore(database);try{expect(reopened.getSetting("theme","system")).toBe("dark");}finally{reopened.close();}}finally{rmSync(directory,{recursive:true,force:true});}});

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

it("durably pauses an evidence-empty session for placement",()=>{const store=new LocalStore(":memory:");try{const{sessionId}=store.createSession("Understand the Node.js event loop");expect(store.hasLearnerEvidence()).toBe(false);const intake={questions:[{header:"Experience",question:"How comfortable are you with callbacks and Promises?",options:[{label:"New",description:"I have not used them."},{label:"Some",description:"I have seen them in small programs."}],multiple:false,custom:true}]};store.setPendingIntake(sessionId,intake);expect(store.readSession(sessionId)?.pendingLearnerQuestion?.questions[0]?.question).toContain("Promises");store.answerIntake(sessionId,"I have not used Promises yet.");expect(store.readSession(sessionId)?.pendingLearnerQuestion).toBeNull();expect(store.answeredIntake(sessionId)).toBe("I have not used Promises yet.");expect(store.setPendingIntake(sessionId,intake).status).toBe("answered");expect(store.readSession(sessionId)?.pendingLearnerQuestion).toBeNull();const target=store.setTrainingTarget(sessionId,{ability:"Function-call sequencing",specificGap:"Follow ordinary calls before asynchronous scheduling",desiredEvidence:"Predicts direct calls",avoidTesting:["Promises","timers"]});store.createQuestion(sessionId,{...design("Trace direct calls"),difficulty:"foundation"},{valid:true});const detail=store.readSession(sessionId);expect(detail?.question?.difficulty).toBe("foundation");expect(detail?.question?.abilityId).toBe(target.abilityId);}finally{store.close();}});

it("allocates live attempt sequences inside the authoritative transaction",()=>{const store=new LocalStore(":memory:");try{const{sessionId}=store.createSession("Practise JavaScript");store.setTrainingTarget(sessionId,{ability:"Control flow",specificGap:"Trace branches",desiredEvidence:"Explains the selected branch",avoidTesting:[]});const question=store.createQuestion(sessionId,design("Trace a branch"),{valid:true});const base={attemptId:question.attemptId,occurredAt:new Date().toISOString(),source:"learner" as const,schemaVersion:1 as const};const first=store.appendNextEvent({...base,id:randomUUID(),type:"file_changed",payload:{path:"src/index.js"}});const second=store.appendNextEvent({...base,id:randomUUID(),type:"learner_remark",payload:{body:"I expect the first branch."}});expect([first.sequence,second.sequence]).toEqual([1,2]);expect(store.readSession(sessionId)?.question?.latestEventSequence).toBe(2);expect(store.readAttempt(question.attemptId)).toEqual(expect.arrayContaining([expect.objectContaining({sequence:1,type:"file_changed"}),expect.objectContaining({sequence:2,type:"learner_remark"})]));}finally{store.close();}});

it("does not treat unrelated history as evidence for a new goal",()=>{const store=new LocalStore(":memory:");try{const{sessionId}=store.createSession("Practise interval scheduling");const target=store.setTrainingTarget(sessionId,{ability:"Greedy interval scheduling",specificGap:"Endpoint compatibility",desiredEvidence:"Selects a maximum compatible sequence",avoidTesting:[]});store.updateAbility({abilityId:target.abilityId,markdown:"# Greedy interval scheduling\n\nSelects intervals by earliest finish time.",evidenceEventIds:[]});expect(store.hasRelevantLearnerEvidence("greedy interval scheduling interview")).toBe(true);expect(store.hasRelevantLearnerEvidence("prepare for an AI engineer interview in five days")).toBe(false);}finally{store.close();}});

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
  const tool=(tool:string,label:string,detail:string)=>({kind:"tool" as const,tool,label,detail,ok:true,text:"",seconds:0});
  store.addMessage(sessionId,"agent","Here is what I found.",[
    {kind:"reasoning",tool:"",label:"",detail:"",ok:true,text:"The shrink case is the one that keeps breaking.",seconds:7},
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
