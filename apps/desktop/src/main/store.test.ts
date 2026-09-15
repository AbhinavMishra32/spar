import { afterEach,describe,expect,it,vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { ABILITY_STALE_AFTER_DAYS, LocalStore, validatedHiddenCaseCount } from "./store.js";
import type { QuestionDesign } from "@spar/domain";

const design=(title:string):QuestionDesign=>({title,language:"javascript",kind:"function",statement:"Implement the target behavior while preserving the declared invariant through every transition.",starterFiles:{"src/index.js":"export function solve(){ throw new Error(\"implement\") }"},referenceFiles:{"src/index.js":"export function solve(){ return true }"},visibleTests:{"tests/visible.test.js":"// visible"},hiddenTests:{"tests/hidden.test.js":"// hidden"},knownIncorrectFiles:[{"src/index.js":"export function solve(){ return false }"}],runCommand:"node --test",accidentalDifficulty:[],expectedFailureSignatures:["returns before restoring the invariant"]});

describe("validated hidden case count",()=>{
  it("reads the structured count from new validation reports",()=>{
    expect(validatedHiddenCaseCount({caseCounts:{visible:5,hidden:30}})).toBe(30);
  });

  it("recovers the count for challenges saved before structured counts",()=>{
    expect(validatedHiddenCaseCount({checks:[
      {name:"case volume",detail:"35 cases executed against the reference"},
      {name:"curated visible cases",detail:"5 named visible cases state the contract"},
    ]})).toBe(30);
  });

  it("carries the measured count into live and reopened challenge details",()=>{
    const store=new LocalStore(":memory:");
    try{
      const{sessionId}=store.createSession("Practise arrays");
      store.setTrainingTarget(sessionId,{ability:"Array traversal",specificGap:"Stop at the boundary",desiredEvidence:"Stops at the first invalid value",avoidTesting:[]});
      const question=store.createQuestion(sessionId,design("Stop at the boundary"),{caseCounts:{visible:5,hidden:30}});
      expect(store.readSession(sessionId)?.question?.hiddenTestCount).toBe(30);
      expect(store.challengeRecord(question.id)?.hiddenTestCount).toBe(30);
    }finally{store.close();}
  });
});

it("persists the authored complexity capability with the challenge",()=>{
  const store=new LocalStore(":memory:");
  try{
    const{sessionId}=store.createSession("Practise array traversal");
    store.setTrainingTarget(sessionId,{ability:"Array traversal",specificGap:"Bound the scan",desiredEvidence:"Uses one bounded pass",avoidTesting:[]});
    const question=store.createQuestion(sessionId,{...design("Bound the scan"),requiresComplexityAnalysis:true},{valid:true});
    expect(store.submissionBundle(question.attemptId)?.design.requiresComplexityAnalysis).toBe(true);
    expect(store.readChallenge(question.id)?.design.requiresComplexityAnalysis).toBe(true);
  }finally{store.close();}
});

it("persists the device theme across store reloads",()=>{const directory=mkdtempSync(path.join(tmpdir(),"spar-theme-"));const database=path.join(directory,"state.sqlite3");try{const first=new LocalStore(database);first.setSetting("theme","dark");first.close();const reopened=new LocalStore(database);try{expect(reopened.getSetting("theme","system")).toBe("dark");}finally{reopened.close();}}finally{rmSync(directory,{recursive:true,force:true});}});

it("migrates legacy sessions into one living Track instead of one Track each",()=>{const directory=mkdtempSync(path.join(tmpdir(),"spar-track-migration-"));const database=path.join(directory,"state.sqlite3");try{const before=new LocalStore(database);before.createSession("Practise arrays");before.createSession("Trace the JavaScript runtime");before.close();const legacy=new Database(database);legacy.prepare("UPDATE sessions SET track_id=NULL").run();legacy.prepare("DELETE FROM tracks").run();legacy.prepare("DELETE FROM settings WHERE key='active-track-id'").run();legacy.close();const migrated=new LocalStore(database);try{expect(migrated.listTracks()).toEqual([expect.objectContaining({title:"General practice"})]);const trackIds=new Set(migrated.listSessions().map((session)=>session.trackId));expect(trackIds.size).toBe(1);expect(trackIds.has(migrated.activeTrack()?.id??"")).toBe(true);}finally{migrated.close();}}finally{rmSync(directory,{recursive:true,force:true});}});

it("collapses the one-Track-per-session prototype into a workspace",()=>{const directory=mkdtempSync(path.join(tmpdir(),"spar-track-v2-migration-"));const database=path.join(directory,"state.sqlite3");try{const before=new LocalStore(database);const first=before.createSession("Practise arrays");const second=before.createSession("Trace the JavaScript runtime");before.close();const legacy=new Database(database);const sessions=legacy.prepare("SELECT id,title,original_goal,created_at,updated_at FROM sessions ORDER BY created_at").all() as Array<{id:string;title:string;original_goal:string;created_at:string;updated_at:string}>;legacy.prepare("DELETE FROM settings WHERE key='track-workspace-migration-v2'").run();legacy.prepare("DELETE FROM tracks").run();const insert=legacy.prepare("INSERT INTO tracks (id,title,goal,status,emphasis,priorities,investigating,monitoring,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)");const attach=legacy.prepare("UPDATE sessions SET track_id=? WHERE id=?");for(const session of sessions){const id=randomUUID();insert.run(id,session.title.slice(0,80),session.original_goal,"active","[]","[]","[]","[]",session.created_at,session.updated_at);attach.run(id,session.id);}legacy.close();const migrated=new LocalStore(database);try{expect(migrated.listTracks()).toEqual([expect.objectContaining({title:"General practice"})]);expect(new Set(migrated.listSessions().map((session)=>session.trackId)).size).toBe(1);expect(migrated.listSessions().map((session)=>session.id)).toEqual(expect.arrayContaining([first.sessionId,second.sessionId]));}finally{migrated.close();}}finally{rmSync(directory,{recursive:true,force:true});}});

it("clears learner data without erasing device preferences",()=>{const store=new LocalStore(":memory:");try{store.setSetting("theme","dark");const {sessionId}=store.createSession("Practise JavaScript arrays");store.setTrainingTarget(sessionId,{ability:"Arrays",specificGap:"Filter values",desiredEvidence:"Uses filter",avoidTesting:[]});store.createQuestion(sessionId,design("Filter values"),{valid:true});store.clearAccountData();expect(store.listSessions()).toEqual([]);expect(store.listAbilities()).toEqual([]);expect(store.getSetting("theme","system")).toBe("dark");}finally{store.close();}});

it("keeps the onboarding profile out of the next account",()=>{const store=new LocalStore(":memory:");try{const profile={name:"Abhinav",experience:"working" as const,focus:["Async and concurrency"],weakness:"I never know what needs awaiting.",language:"typescript" as const,completedAt:new Date().toISOString()};store.saveProfile(profile);expect(store.getProfile()).toEqual(profile);store.setPreferredLanguage("cpp");expect(store.getProfile()?.language).toBe("cpp");
  // Sign-out wipes account state, and the profile is account state: leaving it
  // behind would skip onboarding for whoever signs in next, on their predecessor's answers.
  store.clearAccountData();expect(store.getProfile()).toBeNull();}finally{store.close();}});

describe("target progress",()=>{
  /* The counting exists because one real session ran thirteen challenges against
     a single target while the ability never left "developing", and nothing in
     the agent's context said so. */
  it("counts what the active target has cost, and what has happened since the ability moved",()=>{
    const store=new LocalStore(":memory:");
    try{
      const {sessionId}=store.createSession("practice python hashmap");
      const target=store.setTrainingTarget(sessionId,{ability:"Frequency counting",specificGap:"Building and updating a count map",desiredEvidence:"Returns a completed frequency map unaided",avoidTesting:["parsing"]});
      expect(store.targetProgress(sessionId)).toMatchObject({challengesSet:0,challengesSinceAbilityChanged:0,abilityTitle:"Frequency counting"});

      /* The outcome lives in the event log, not on the attempt row —
         `completeAttempt` only closes the attempt — so grading is recorded the
         way the runner records it. */
      const grade=(attemptId:string,outcome:"passed"|"failed")=>{store.appendNextEvent({id:randomUUID(),attemptId,type:"attempt_completed",occurredAt:new Date().toISOString(),payload:{outcome},source:"system",schemaVersion:1});store.completeAttempt(attemptId,outcome);};
      const first=store.createQuestion(sessionId,design("Count Value Frequencies"),{valid:true});
      grade(first.attemptId,"passed");
      const second=store.createQuestion(sessionId,design("Group Words By First Letter"),{valid:true});
      grade(second.attemptId,"failed");
      expect(store.targetProgress(sessionId)).toMatchObject({challengesSet:2,passed:1,failed:1});

      /* Writing the ability is the only thing that says a challenge taught
         anybody anything, so the count of challenges since restarts there. */
      store.updateAbility({abilityId:target.abilityId,markdown:"# Frequency counting\n\nBuilds the map; the missing-key case is still shaky.",evidenceEventIds:[]});
      expect(store.targetProgress(sessionId)?.challengesSinceAbilityChanged).toBe(0);

      store.createQuestion(sessionId,design("Count Email Domains"),{valid:true});
      const progress=store.targetProgress(sessionId);
      expect(progress).toMatchObject({challengesSet:3,challengesSinceAbilityChanged:1});
      /* The target itself rides along, so the position is readable without
         cross-referencing another field of the context. */
      expect(progress?.desiredEvidence).toBe("Returns a completed frequency map unaided");
    }finally{store.close();}
  });

  it("has nothing to say before a target is set",()=>{
    const store=new LocalStore(":memory:");
    try{
      const {sessionId}=store.createSession("wanna learn linked list");
      expect(store.targetProgress(sessionId)).toBeNull();
    }finally{store.close();}
  });
});

describe("local learning state",()=>{it("persists an evidence-bearing two-question adaptive chain",()=>{const store=new LocalStore(":memory:");try{const {sessionId}=store.createSession("Learn invariant-driven algorithms deeply");store.setObjective(sessionId,"Distinguish recognizing an invariant from restoring it repeatedly.");const first=store.setTrainingTarget(sessionId,{ability:"Invariant restoration",specificGap:"Repeated restoration after one mutation",desiredEvidence:"Uses a loop until validity returns",avoidTesting:["parsing"]});const q1=store.createQuestion(sessionId,design("Restore the window"),{valid:true});const remark=randomUUID();store.appendEvent({id:remark,attemptId:q1.attemptId,sequence:1,type:"learner_remark",occurredAt:new Date().toISOString(),payload:{body:"I know the invariant but I only repaired it once."},source:"learner",schemaVersion:1});
/* Cited, not merely written beside: confidence follows the linked evidence, so
   an update with nothing behind it has nothing to be confident about. This
   chain claims to be evidence-bearing, so it cites the remark — and the remark
   is a learner saying something, which grades nothing either way. The status
   stays `uncertain` because that is exactly what one neutral observation
   supports; under the old count-of-events rule it read as `developing`, which
   was the ledger promoting a sentence about a feeling. */
store.updateAbility({abilityId:first.abilityId,markdown:"# Invariant restoration\n\nRecognizes the invariant; repeated restoration remains uncertain.",evidenceEventIds:[remark]});store.completeAttempt(q1.attemptId,"passed");store.setTrainingTarget(sessionId,{ability:"Invariant restoration",specificGap:"Transfer repeated restoration to an event stream",desiredEvidence:"Restores validity independently in a new representation",avoidTesting:["advanced syntax"]});store.createQuestion(sessionId,design("Repair the event stream"),{valid:true});const detail=store.readSession(sessionId);expect(detail?.summary.questionTitles).toHaveLength(2);expect(detail?.summary.completedQuestions).toBe(1);expect(detail?.question?.title).toBe("Repair the event stream");expect(store.readAbility(first.abilityId)).toMatchObject({version:1,status:"uncertain"});expect(store.readAttempt(q1.attemptId)).toEqual(expect.arrayContaining([expect.objectContaining({type:"learner_remark"})]));}finally{store.close();}});});

/* One intake row per session, and the answered branch used to win for any later
   question — so the second thing a session ever asked was swallowed and the
   first one's answer handed back in its place. The agent read a reply to
   something it had not asked, asked again, and the learner watched it spin with
   nothing on screen to answer. */
it("asks a second question instead of replaying the answer to the first",()=>{
  const store=new LocalStore(":memory:");
  try{
    const{sessionId}=store.createSession("Sliding window in Python");
    const placement={questions:[{header:"Starting point",question:"Which best describes your sliding-window experience?",options:[{label:"New to it"},{label:"Comfortable"}],multiple:false,custom:true}]};
    store.setPendingIntake(sessionId,placement);
    store.answerIntake(sessionId,"New to it");

    // The same question again is the repeat ask after an answer: it gets the answer.
    const repeat=store.setPendingIntake(sessionId,placement);
    expect(repeat.status).toBe("answered");
    expect(repeat.answer).toBe("New to it");

    // A different question is a new question.
    const fresh={questions:[{header:"Quick Python check",question:"For values = [1, 2, 4] and k = 2, what should the result be?",options:[{label:"[1.5, 3.0]"},{label:"[1.5, 3.0, 2.0]"}],multiple:false,custom:true}]};
    const asked=store.setPendingIntake(sessionId,fresh);
    expect(asked.status).toBe("pending");
    expect(store.readSession(sessionId)?.pendingLearnerQuestion?.questions[0]?.header).toBe("Quick Python check");
    store.answerIntake(sessionId,"[1.5, 3.0]");
    expect(store.answeredIntake(sessionId)).toBe("[1.5, 3.0]");
  }finally{store.close();}
});

/* The conversation rewinds; the record does not. */
it("cuts the conversation at an edited message and leaves the record standing",()=>{
  const store=new LocalStore(":memory:");
  try{
    const{sessionId}=store.createSession("Binary search");
    const first=store.addMessage(sessionId,"learner","teach me binary serch")!;
    store.addMessage(sessionId,"agent","Here is a challenge.");
    store.addMessage(sessionId,"learner","actually make it harder");
    const target=store.setTrainingTarget(sessionId,{ability:"Binary search bounds",specificGap:"Off-by-one on the upper bound",desiredEvidence:"Correct bounds",avoidTesting:[]});
    store.createQuestion(sessionId,{...design("Find the insert point"),difficulty:"developing"},{valid:true});

    const rewound=store.rewindToMessage(sessionId,first.id);
    expect(rewound).toEqual({body:"teach me binary serch",removed:3});
    expect(store.readSession(sessionId)?.messages).toHaveLength(0);
    // Published work is the record, not the conversation, and stays where it is.
    expect(store.readSession(sessionId)?.question?.abilityId).toBe(target.abilityId);
  }finally{store.close();}
});

it("refuses to rewind to anything but one of the learner's own messages",()=>{
  const store=new LocalStore(":memory:");
  try{
    const{sessionId}=store.createSession("Graphs");
    store.addMessage(sessionId,"learner","hello");
    const reply=store.addMessage(sessionId,"agent","Hello back.")!;
    expect(store.rewindToMessage(sessionId,reply.id)).toBeNull();
    expect(store.rewindToMessage(sessionId,randomUUID())).toBeNull();
    expect(store.readSession(sessionId)?.messages).toHaveLength(2);
  }finally{store.close();}
});

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
  it("gives a Track its own language, so a Python goal is not written in the profile's language",()=>{const store=new LocalStore(":memory:");try{
    /* The failure this replaces: a Track whose goal said "practice python
       hashmap" produced a TypeScript challenge, because the only language in the
       agent's context was the global profile's. */
    const python=store.createTrack("practice python hashmap","Python Hashmaps","python");
    expect(store.listTracks().find((track)=>track.id===python.track.id)?.language).toBe("python");

    // A Track that names none follows the profile, which is what null means.
    const unset=store.createTrack("Get better at algorithms generally","General");
    expect(store.listTracks().find((track)=>track.id===unset.track.id)?.language).toBeNull();

    /* "in python man!" has to outlive the turn it was said in. The agent resolves
       it into a language on a compiled challenge and the host writes it here, so
       the next turn's context already carries it. */
    store.updateTrack(unset.track.id,{language:"python"});
    expect(store.listTracks().find((track)=>track.id===unset.track.id)?.language).toBe("python");

    // Updating anything else leaves it alone.
    store.updateTrack(unset.track.id,{title:"Renamed"});
    expect(store.listTracks().find((track)=>track.id===unset.track.id)?.language).toBe("python");
  }finally{store.close();}});

  it("keeps baseline calibration out of Tracks and ordinary session navigation",()=>{const store=new LocalStore(":memory:");try{
    const training=store.createTrack("Become reliable at backend problem solving","Backend Problem Solving");
    const baseline=store.createBaselineSession();
    expect(store.listTracks()).toEqual([expect.objectContaining({id:training.track.id})]);
    expect(store.activeTrack()?.id).toBe(training.track.id);
    expect(store.readSession(baseline.sessionId)?.summary).toMatchObject({context:"baseline",trackId:null,title:"Baseline"});
    expect(store.getBaseline()).toMatchObject({status:"in-progress",sessionId:baseline.sessionId});
    expect(store.createBaselineSession()).toEqual(baseline);
  }finally{store.close();}});

  it("keeps baseline evidence outside every Track learner model across restarts",()=>{const directory=mkdtempSync(path.join(tmpdir(),"spar-baseline-model-"));const database=path.join(directory,"state.sqlite3");try{
    const first=new LocalStore(database);const track=first.createTrack("Prepare for algorithmic interviews");const baseline=first.createBaselineSession();const target=first.setTrainingTarget(baseline.sessionId,{ability:"Problem decomposition",specificGap:"Split an unfamiliar task into testable steps",desiredEvidence:"Defines the state before coding",avoidTesting:[]});first.ensureAbility(target.abilityId,target.abilityTitle,null);expect(first.listAbilities(track.track.id)).toEqual([]);first.close();
    const reopened=new LocalStore(database);try{expect(reopened.activeTrack()?.id).toBe(track.track.id);expect(reopened.listAbilities(track.track.id)).toEqual([]);expect(reopened.readAbility(target.abilityId)).toMatchObject({id:target.abilityId,title:"Problem decomposition"});}finally{reopened.close();}
  }finally{rmSync(directory,{recursive:true,force:true});}});

  it("keeps sessions and learner models isolated by Track workspace",()=>{const store=new LocalStore(":memory:");try{
    const typescript=store.createTrack("Become extremely strong at TypeScript and understand the language deeply");
    const interviews=store.createTrack("Prepare seriously for algorithmic interviews");
    const target=store.setTrainingTarget(typescript.sessionId,{ability:"Invariant restoration",specificGap:"Restore validity after every mutation",desiredEvidence:"Uses a loop until valid",avoidTesting:[]});
    store.ensureAbility(target.abilityId,target.abilityTitle);
    expect(store.listTracks()).toHaveLength(2);
    expect(store.activeTrack()?.id).toBe(interviews.track.id);
    expect(store.abilityStates()).toEqual([]);
    store.setActiveTrack(typescript.track.id);
    expect(store.abilityStates()[0]?.abilityId).toBe(target.abilityId);
    const interviewTarget=store.setTrainingTarget(interviews.sessionId,{ability:"Invariant restoration",specificGap:"Restore a different invariant",desiredEvidence:"Restores independently",avoidTesting:[]});
    store.ensureAbility(interviewTarget.abilityId,interviewTarget.abilityTitle);
    expect(interviewTarget.abilityId).not.toBe(target.abilityId);
    expect(store.listAbilities(typescript.track.id).map((ability)=>ability.id)).toEqual([target.abilityId]);
    expect(store.listAbilities(interviews.track.id).map((ability)=>ability.id)).toEqual([interviewTarget.abilityId]);
  }finally{store.close();}});

  it("turns linked attempts into confidence without treating one event as mastery",()=>{const store=new LocalStore(":memory:");try{
    const {sessionId}=store.createSession("Practise variable windows");
    const target=store.setTrainingTarget(sessionId,{ability:"Variable-window restoration",specificGap:"Repeat restoration",desiredEvidence:"Shrinks until every condition is valid",avoidTesting:[]});
    store.ensureAbility(target.abilityId,target.abilityTitle);
    const question=store.createQuestion(sessionId,design("Restore repeatedly"),{valid:true});
    const event=store.appendNextEvent({id:randomUUID(),attemptId:question.attemptId,type:"submission_evaluated",occurredAt:new Date().toISOString(),payload:{outcome:"passed"},source:"system",schemaVersion:1});
    store.updateAbility({abilityId:target.abilityId,markdown:"# Variable-window restoration\n\nDirect execution worked once; transfer is untested.",summary:"Direct execution worked once; transfer is untested.",status:"developing",evidenceEventIds:[event.id]});
    /* `developing` is the agent's word and `proficiency` is no longer a lookup
       on it — one clean pass reads well but reads thinly, and the confidence
       beside it is what says so. Asserted as a band rather than a pinned float:
       the claim is "one event is not mastery", not a particular decimal. */
    expect(store.abilityStates()[0]).toMatchObject({evidenceCount:1,trainingStatus:"training"});
    expect(store.abilityStates()[0]!.proficiency).toBeGreaterThan(0.6);
    expect(store.abilityStates()[0]!.proficiency).toBeLessThan(0.75);
    expect(store.abilityStates()[0]!.confidence).toBeLessThan(0.5);
    expect(store.learnerProgress().rating.provisional).toBe(true);
  }finally{store.close();}});

  /* The rating, as a rating: earned against challenges of known difficulty
     rather than recomputed from what the ledger believes. These three properties
     are the ones the previous scheme could not hold. */
  describe("the rating a challenge moves",()=>{
    const graded=(store:LocalStore,sessionId:string,title:string,outcome:"passed"|"abandoned")=>{
      const question=store.createQuestion(sessionId,design(title),{valid:true});
      if(outcome==="passed"){store.appendNextEvent({id:randomUUID(),attemptId:question.attemptId,type:"attempt_completed",occurredAt:new Date().toISOString(),payload:{outcome:"passed"},source:"system",schemaVersion:1});store.completeAttempt(question.attemptId,"passed");}
      else store.abandonAttempt(question.attemptId,"Out of ideas");
      return question;
    };
    const rated=(store:LocalStore)=>{const {sessionId}=store.createSession("Get good at windows");store.setTrainingTarget(sessionId,{ability:"Windows",specificGap:"Shrinking until valid",desiredEvidence:"Shrinks repeatedly",avoidTesting:[]});return sessionId;};

    it("rises on a solve and falls when the learner gives up",()=>{const store=new LocalStore(":memory:");try{
      const sessionId=rated(store);
      const start=store.learnerProgress().rating.rating;
      graded(store,sessionId,"Shrink until valid","passed");
      const afterSolve=store.learnerProgress().rating.rating;
      expect(afterSolve).toBeGreaterThan(start);
      graded(store,sessionId,"Shrink again","abandoned");
      expect(store.learnerProgress().rating.rating).toBeLessThan(afterSolve);
    }finally{store.close();}});

    /* The number the user caught: fourteen solves of Spar's own drills read as a
       2044, because the item was priced from the learner's rating and so rose
       with it. A run of identical challenges has to converge. */
    it("converges over a long run of identical challenges instead of climbing without bound",()=>{const store=new LocalStore(":memory:");try{
      const sessionId=rated(store);
      for(let solve=0;solve<25;solve+=1)graded(store,sessionId,`Shrink ${solve}`,"passed");
      const history=store.learnerProgress().ratingHistory;
      expect(store.learnerProgress().rating.rating).toBeLessThan(2000);
      /* The tail of an unbroken run moves far less than its head: that is the
         deviation narrowing, and it is what a bounded estimate looks like. */
      const early=history[2]!.rating-history[1]!.rating;
      const late=history[history.length-1]!.rating-history[history.length-2]!.rating;
      expect(late).toBeLessThan(early/4);
    }finally{store.close();}});

    it("pays for a challenge once, however many times it is finished",()=>{const store=new LocalStore(":memory:");try{
      const sessionId=rated(store);
      const question=graded(store,sessionId,"Shrink until valid","passed");
      const paid=store.learnerProgress().ratingHistory.length;
      /* The review rejected the solve and sent it back. The pass that closed it
         has already moved the rating; solving it again is the same challenge. */
      store.reopenAttempt(question.attemptId,"Solved by scanning rather than by window");
      store.appendNextEvent({id:randomUUID(),attemptId:question.attemptId,type:"attempt_completed",occurredAt:new Date().toISOString(),payload:{outcome:"passed"},source:"system",schemaVersion:1});
      store.completeAttempt(question.attemptId,"passed");
      expect(store.learnerProgress().ratingHistory).toHaveLength(paid);
    }finally{store.close();}});

    it("does not rate a challenge the agent replaced",()=>{const store=new LocalStore(":memory:");try{
      const sessionId=rated(store);
      const question=store.createQuestion(sessionId,design("Shrink until valid"),{valid:true});
      const before=store.learnerProgress().ratingHistory.length;
      store.abandonAttempt(question.attemptId,"Mispitched","agent","replaced");
      expect(store.learnerProgress().ratingHistory).toHaveLength(before);
    }finally{store.close();}});
  });

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
    /* The half of the loop that was missing: what was written down has to be
       findable again, or the second attempt can never be joined to the first. */
    expect(store.patternsForAbility(target.abilityId)).toMatchObject([{title:"Boundary assumptions",status:"pattern",evidenceCount:2}]);
    const memory=store.searchLearnerMemory("boundary initialization assumptions",4);
    expect(memory.patterns.map((item)=>item.title)).toEqual(["Boundary assumptions"]);
    expect(memory.evidence.map((item)=>item.eventId)).toEqual([secondEvidence.id,firstEvidence.id]);
    expect(memory.evidence[0]).toMatchObject({polarity:"contradictory",abilityTitle:"Boundary-case reasoning"});
    /* A query about something else must not drag the ledger's only pattern in.
       An almost-empty memory answers nearly any search if the search is loose. */
    expect(store.searchLearnerMemory("graph traversal",4).patterns).toEqual([]);
  }finally{store.close();}});

  /* The rule this replaces counted linked events and promoted on three of them,
     whichever way they had gone — so a learner could fail the same thing four
     times and the ledger would call it independent, then a rating built on that
     word would report it as a number somebody had measured. */
  it("does not promote an ability on the volume of evidence against it",()=>{const store=new LocalStore(":memory:");try{
    const {sessionId}=store.createSession("Practise variable windows");
    const target=store.setTrainingTarget(sessionId,{ability:"Variable-window restoration",specificGap:"Repeated shrinking",desiredEvidence:"Restores across several shrinks",avoidTesting:[]});
    store.ensureAbility(target.abilityId,target.abilityTitle);
    const failures=[0,1,2,3].map(()=>{const question=store.createQuestion(sessionId,design(`Shrink until valid ${randomUUID().slice(0,8)}`),{valid:true});const event=store.appendNextEvent({id:randomUUID(),attemptId:question.attemptId,type:"submission_evaluated",occurredAt:new Date().toISOString(),payload:{outcome:"failed"},source:"system",schemaVersion:1});store.completeAttempt(question.attemptId,"failed");return event.id;});
    store.updateAbility({abilityId:target.abilityId,markdown:"# Variable-window restoration\n\nFour attempts, none of them restoring more than once.",evidenceEventIds:failures});
    expect(store.readAbility(target.abilityId)).toMatchObject({status:"developing"});
    const state=store.abilityStates()[0]!;
    expect(state.evidenceCount).toBe(4);
    /* Plenty of observation, all of it pointing the other way: confident, and
       confidently low. Those two numbers moving independently is the point. */
    expect(state.confidence).toBeGreaterThan(0.6);
    expect(state.proficiency).toBeLessThan(0.3);
  }finally{store.close();}});

  it("says so when the document claims more than the evidence under it supports",()=>{const store=new LocalStore(":memory:");try{
    const {sessionId}=store.createSession("Practise variable windows");
    const target=store.setTrainingTarget(sessionId,{ability:"Variable-window restoration",specificGap:"Repeated shrinking",desiredEvidence:"Restores across several shrinks",avoidTesting:[]});
    store.ensureAbility(target.abilityId,target.abilityTitle);
    const graded=(outcome:"passed"|"failed")=>{const question=store.createQuestion(sessionId,design(`Shrink ${randomUUID().slice(0,8)}`),{valid:true});const event=store.appendNextEvent({id:randomUUID(),attemptId:question.attemptId,type:"submission_evaluated",occurredAt:new Date().toISOString(),payload:{outcome},source:"system",schemaVersion:1});store.completeAttempt(question.attemptId,outcome);return event.id;};
    /* The agent's word, and it is honoured: three clean passes and it says
       independent, so independent is what the document says. */
    store.updateAbility({abilityId:target.abilityId,markdown:"# Variable-window restoration\n\nRestores repeatedly and unaided.",status:"independent",evidenceEventIds:[graded("passed"),graded("passed"),graded("passed")]});
    expect(store.readAbility(target.abilityId)).toMatchObject({status:"independent"});
    expect(store.abilityStates()[0]!.proficiency).toBeGreaterThan(0.6);
    expect(store.listNotices().some((notice)=>notice.title.includes("stopped backing"))).toBe(false);

    /* Now the evidence turns and the agent keeps its position. Spar does not
       overrule it — the status still reads independent — it files the
       disagreement, which is the thing that used to be unrepresentable. */
    store.updateAbility({abilityId:target.abilityId,markdown:"# Variable-window restoration\n\nStill filed as reliable.",status:"independent",evidenceEventIds:[graded("failed"),graded("failed"),graded("failed"),graded("failed"),graded("failed")]});
    expect(store.readAbility(target.abilityId)).toMatchObject({status:"independent"});
    expect(store.abilityStates()[0]!.proficiency).toBeLessThan(0.6);
    expect(store.listNotices().map((notice)=>notice.title)).toContain("The evidence for Variable-window restoration has stopped backing it");
    /* Filed on the crossing, not on every write, so it is a change of state
       rather than a standing complaint. */
    store.updateAbility({abilityId:target.abilityId,markdown:"# Variable-window restoration\n\nUnchanged.",status:"independent",evidenceEventIds:[]});
    expect(store.listNotices().filter((notice)=>notice.title.includes("stopped backing"))).toHaveLength(1);
  }finally{store.close();}});

  it("lets an earned ability go stale when nothing has checked it for a long time",()=>{const store=new LocalStore(":memory:");try{
    const {sessionId}=store.createSession("Practise variable windows");
    const target=store.setTrainingTarget(sessionId,{ability:"Variable-window restoration",specificGap:"Repeated shrinking",desiredEvidence:"Restores the invariant across several shrinks",avoidTesting:[]});
    const question=store.createQuestion(sessionId,design("Shrink until valid"),{valid:true});
    const events=[0,1,2].map(()=>store.appendNextEvent({id:randomUUID(),attemptId:question.attemptId,type:"submission_evaluated",occurredAt:new Date().toISOString(),payload:{outcome:"passed"},source:"system",schemaVersion:1}));
    store.updateAbility({abilityId:target.abilityId,markdown:"# Variable-window restoration\n\nShrinks until the property holds again.",evidenceEventIds:events.map((event)=>event.id)});
    expect(store.readAbility(target.abilityId)).toMatchObject({status:"independent"});
    /* Today changes nothing; the cutoff is what changes something. Passing the
       clock in beats waiting 45 days for the test to be meaningful. */
    expect(store.decayAbilities()).toEqual([]);
    const later=new Date(Date.now()+(ABILITY_STALE_AFTER_DAYS+1)*86_400_000);
    const before=store.readAbility(target.abilityId) as {updated_at:string};
    expect(store.decayAbilities(later)).toEqual([target.abilityId]);
    const after=store.readAbility(target.abilityId) as {status:string;version:number;updated_at:string;earned_at:string|null};
    expect(after.status).toBe("stale");
    /* Nobody wrote anything, so nothing about the document moved. `updated_at`
       especially: targetProgress counts challenges set since it last changed. */
    expect(after.version).toBe(1);
    expect(after.updated_at).toBe(before.updated_at);
    expect(after.earned_at).not.toBeNull();
    expect(store.listNotices().map((notice)=>notice.title)).toContain("Variable-window restoration has not been checked recently");
    /* Idempotent: the ability is no longer independent, so a second pass finds
       nothing and the learner is not told again on every launch. */
    expect(store.decayAbilities(later)).toEqual([]);
  }finally{store.close();}});

  it("compacts and restores Track-owned adaptive projections",()=>{const source=new LocalStore(":memory:");const restored=new LocalStore(":memory:");try{
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

/**
 * The ability write and the challenge that follows it, inside one millisecond.
 *
 * This is the CI machine, and it is the reason the number was wrong there and
 * right on every laptop it was written on. `targetProgress` asks which of the
 * two came first by comparing ISO timestamps, and ISO timestamps stop at the
 * millisecond — so on hardware quick enough to do both inside one, the tie read
 * as "the challenge came first" and the count of challenges since the ability
 * last changed came back zero.
 *
 * Freezing the clock is the honest version of that machine: every wall-clock
 * reading is now identical, which is the worst case rather than a rare one. The
 * ordering has to come from the sequence of writes instead.
 */
describe("target progress with a clock that does not move",()=>{
  afterEach(()=>{vi.useRealTimers();});

  it("counts a challenge set after an ability update in the same millisecond",()=>{
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-13T12:00:00.000Z"));
    const store=new LocalStore(":memory:");
    try{
      const {sessionId}=store.createSession("practice python hashmap");
      const target=store.setTrainingTarget(sessionId,{ability:"Frequency counting",specificGap:"Building and updating a count map",desiredEvidence:"Returns a completed frequency map unaided",avoidTesting:["parsing"]});
      store.createQuestion(sessionId,design("Count Value Frequencies"),{valid:true});
      store.updateAbility({abilityId:target.abilityId,markdown:"# Frequency counting\n\nBuilds the map.",evidenceEventIds:[]});
      /* Nothing has been set since the update yet, and the challenge before it
         must not drift to the wrong side of the tie either. */
      expect(store.targetProgress(sessionId)?.challengesSinceAbilityChanged).toBe(0);
      store.createQuestion(sessionId,design("Count Email Domains"),{valid:true});
      expect(store.targetProgress(sessionId)?.challengesSinceAbilityChanged).toBe(1);
    }finally{store.close();}
  });
});

describe("the shelf",()=>{
  const hit={title:"Two Sum",source:"leetcode" as const,slug:"two-sum",difficulty:"easy" as const,displayId:"1",sourceRating:null,concepts:["hashing"],sourceName:"LeetCode"};

  it("keeps the moment a problem was first put aside",()=>{
    const store=new LocalStore(":memory:");
    try{
      const first=store.setProblemSaved("leetcode:two-sum",true,hit);
      expect(first).toHaveLength(1);
      /* Pressing the bookmark on something already saved must not quietly move it
         to the top of a shelf ordered by when things were filed. */
      const again=store.setProblemSaved("leetcode:two-sum",true,hit);
      expect(again).toHaveLength(1);
      expect(again[0]!.savedAt).toBe(first[0]!.savedAt);
    }finally{store.close();}
  });

  it("newest first, and empty once everything is taken off",()=>{
    const store=new LocalStore(":memory:");
    try{
      store.setProblemSaved("spar:one",true);
      store.setProblemSaved("leetcode:two-sum",true,hit);
      expect(store.listSavedProblems().map((row)=>row.key)).toEqual(["leetcode:two-sum","spar:one"]);
      expect(store.setProblemSaved("leetcode:two-sum",false)).toEqual([{key:"spar:one",savedAt:expect.any(String),snapshot:null}]);
      expect(store.setProblemSaved("spar:one",false)).toEqual([]);
    }finally{store.close();}
  });

  /* A challenge Spar wrote is already in `questions`, so a copy of it here could
     only ever disagree with the row every other surface reads. */
  it("keeps no copy of a challenge the device already holds",()=>{
    const store=new LocalStore(":memory:");
    try{
      expect(store.setProblemSaved("spar:one",true)[0]!.snapshot).toBeNull();
    }finally{store.close();}
  });

  /* Filing, and a shelf that will not open because one card on it is unreadable
     is worse than a shelf missing that card. */
  it("drops a row it can no longer read rather than failing the whole shelf",()=>{
    const file=path.join(mkdtempSync(path.join(tmpdir(),"spar-shelf-")),"spar.db");
    const store=new LocalStore(file);
    try{
      store.setProblemSaved("leetcode:two-sum",true,hit);
      store.setProblemSaved("spar:one",true);
      const raw=new Database(file);
      raw.prepare("UPDATE saved_problems SET snapshot=? WHERE key=?").run('{"title":"Two Sum"}',"leetcode:two-sum");
      raw.close();
      const reopened=new LocalStore(file);
      try{
        expect(reopened.listSavedProblems().map((row)=>row.key)).toEqual(["spar:one"]);
      }finally{reopened.close();}
    }finally{store.close();rmSync(path.dirname(file),{recursive:true,force:true});}
  });
});

it("deletes a Track and its owned history while preserving other Tracks and baseline", () => {
  const store = new LocalStore(":memory:");
  try {
    const keep = store.createTrack("Practise graph algorithms");
    const baseline = store.createBaselineSession();
    const removed = store.createTrack("Practise recursive algorithms");
    const extra = store.createSession("More recursion practice", removed.track.id);
    const target = store.setTrainingTarget(removed.sessionId, { ability: "Recursion", specificGap: "Base cases", desiredEvidence: "States the base case", avoidTesting: [] });
    store.updateAbility({ abilityId: target.abilityId, markdown: "# Recursion\n\nPractise base cases.", evidenceEventIds: [] });
    const question = store.createQuestion(removed.sessionId, design("Sum a tree"), { valid: true });
    expect(store.deleteTrack(removed.track.id)).toBe(true);
    expect(store.listTracks().map((track) => track.id)).toEqual([keep.track.id]);
    expect(store.activeTrack()?.id).toBe(keep.track.id);
    expect(store.readSession(removed.sessionId)).toBeNull();
    expect(store.readSession(extra.sessionId)).toBeNull();
    expect(store.readAttempt(question.attemptId)).toEqual([]);
    expect(store.listAbilities(removed.track.id)).toEqual([]);
    expect(store.readSession(keep.sessionId)).not.toBeNull();
    expect(store.readSession(baseline.sessionId)).not.toBeNull();
    expect(store.cloudLearningState().tracks.map((track) => track.id)).toEqual([keep.track.id]);
    expect(store.pendingSync().filter((item) => item.kind === "session-delete")).toHaveLength(2);
    expect(store.deleteTrack(removed.track.id)).toBe(false);
    expect(store.deleteTrack(keep.track.id)).toBe(true);
    expect(store.activeTrack()).toBeNull();
    expect(store.listTracks()).toEqual([]);
    expect(store.readSession(baseline.sessionId)).not.toBeNull();
  } finally { store.close(); }
});
