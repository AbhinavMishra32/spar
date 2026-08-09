import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { ChallengeCodePreview } from "@spar/domain";
import { challengeFileEntries, codePreview } from "./challengeFiles.js";
import { askUserQuestionRequestSchema, challengeSourceSchema, chooseCheckpoint, conceptSlug, conceptStanding, conceptStrength, conceptTitleFromSlug, learnerProfileSchema, seededConcept, sessionCheckpointSchema, CONCEPT_STANDING_LABEL, CONCEPT_TAXONOMY, agentActivityStepSchema, type AbilityDetail, type AbilityHistorySummary, type AbilityStatus, type AgentActivityStep, type AskUserQuestionInput, type AskUserQuestionRequest, type AttemptEvent, type ChallengeHistorySummary, type ChallengeSource, type ConceptDetail, type ConceptEvidence, type ConceptKind, type ConceptRole, type ConceptSummary, type ConceptTag, type Language, type LearnerProfile, type QuestionDesign, type SessionCheckpoint, type SessionDetail, type SessionSummary, type TrainingTarget } from "@spar/domain";

type SessionRow = { id:string; title:string; original_goal:string; objective:string; status:SessionSummary["status"]; total_seconds:number; updated_at:string; pinned_at:string|null; archived_at:string|null };
const SESSION_COLUMNS="id,title,original_goal,objective,status,total_seconds,updated_at,pinned_at,archived_at";
type QuestionRow = { id:string; session_id:string; training_target_id:string; ordinal:number; title:string; statement:string; language:"javascript"|"typescript"|"cpp"; kind:"function"|"module"|"repair"|"extension"|"repository"; status:"generating"|"validating"|"playable"|"active"|"completed"|"invalid"|"abandoned"; difficulty:"foundation"|"developing"|"proficient"|"advanced"; design:string; replaces_question_id:string|null; source_ref:string|null; created_at:string };
type ConceptRow = { id:string; slug:string; title:string; kind:string; parent_slug:string|null; description:string };

/* ---- What a restore arrives as ------------------------------------------
   The shapes the API's `/v1/restore/*` routes answer with, named here because
   this is the file that writes them to disk. Dates are whatever JSON carried —
   Postgres timestamps serialise as ISO strings, but `iso()` below is defensive
   about it rather than trusting the wire. */
export type RestoredAccount = {
  profile:LearnerProfile|null;
  concepts:Array<{slug:string;title:string;kind:string;parentSlug:string|null;description:string}>;
  abilities:Array<{id:string;title:string;markdown:string;summary:string;practice:string[];earnedAt:string|null;conceptSlugs:string[];status:string;version:number;updatedAt:string;evidenceEventIds?:string[]}>;
};
export type RestoredSession = {
  session:{id:string;title:string;originalGoal:string;objective:string;status:string;totalSeconds:number|null;currentFocus:string[]|null;pinnedAt:string|null;archivedAt:string|null;createdAt:string;updatedAt:string};
  targets:Array<{id:string;abilityDocumentId:string|null;action:string;specificGap:string;desiredEvidence:string;avoidTesting:string[]|null;createdAt:string}>;
  questions:Array<{id:string;trainingTargetId:string;ordinal:number;title:string;statement:string;language:string;kind:string;status:string;difficulty:string;replacesQuestionId:string|null;sourceRef:unknown;concepts:Array<{slug:string;role:string}>|null;createdAt:string;design:unknown;report:unknown}>;
  attempts:Array<{id:string;questionId:string;status:string;latestEventSequence:number;startedAt:string;completedAt:string|null;events:Array<{id:string;sequence:number;type:string;source:string;payload:unknown;schemaVersion:number|null;occurredAt:string}>}>;
  messages:Array<{id:string;role:string;body:string;activity:unknown[]|null;createdAt:string}>;
  checkpoint:unknown;
};
/** One concept tag as the agent hands it over. Only the slug is load-bearing —
 *  the rest fills in a concept Spar has not met before. */
export type ConceptTagInput = { slug:string; title?:string; kind?:string; parentSlug?:string|null; description?:string; role?:string };
/** Every graded challenge under a concept, before it is grouped. One row per
 *  (concept, challenge) pair, which is what makes the rollups countable. */
type TaggedChallengeRow = { concept_id:string; role:string; question_id:string; session_id:string; session_title:string; title:string; language:string; difficulty:string; outcome:ConceptEvidence["outcome"]; attempt_count:number; test_run_count:number; replaced:number; created_at:string; occurred_at:string };

/* The outcome of a challenge, resolved once. `attempt_completed` carries it for
   anything that ended; everything else is still open, including a challenge that
   is mid-compilation. Kept as a named fragment because the challenge list, the
   concept rollups and the ability evidence trail all have to agree on it — three
   copies of this expression would eventually mean three different histories. */
const CHALLENGE_OUTCOME_SQL = `
  SELECT q.id, q.session_id, q.title, q.language, q.difficulty, q.status, q.created_at, q.training_target_id,
    q.replaces_question_id,
    COALESCE(MAX(a.completed_at), q.created_at) updated_at,
    COUNT(DISTINCT a.id) attempt_count,
    (SELECT COUNT(*) FROM attempt_events te JOIN attempts ta ON ta.id=te.attempt_id WHERE ta.question_id=q.id AND te.type='test_run') test_run_count,
    COALESCE((SELECT json_extract(te.payload,'$.outcome') FROM attempt_events te JOIN attempts ta ON ta.id=te.attempt_id WHERE ta.question_id=q.id AND te.type='attempt_completed' ORDER BY te.occurred_at DESC LIMIT 1),'open') outcome
  FROM questions q LEFT JOIN attempts a ON a.question_id=q.id GROUP BY q.id
`;

export class LocalStore {
  private readonly db: Database.Database;
  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, original_goal TEXT NOT NULL, objective TEXT NOT NULL, status TEXT NOT NULL, current_focus TEXT NOT NULL DEFAULT '[]', questions TEXT NOT NULL DEFAULT '[]', total_seconds INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS training_targets (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, ability_id TEXT NOT NULL, ability_title TEXT NOT NULL, specific_gap TEXT NOT NULL, desired_evidence TEXT NOT NULL, avoid_testing TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, training_target_id TEXT NOT NULL REFERENCES training_targets(id), ordinal INTEGER NOT NULL, title TEXT NOT NULL, statement TEXT NOT NULL, language TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, difficulty TEXT NOT NULL, design TEXT NOT NULL, validation_report TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(session_id, ordinal));
      CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, status TEXT NOT NULL, latest_event_sequence INTEGER NOT NULL DEFAULT -1, started_at TEXT NOT NULL, completed_at TEXT);
      CREATE TABLE IF NOT EXISTS agent_messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, role TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS session_intake (session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE, question TEXT NOT NULL, status TEXT NOT NULL, answer TEXT, created_at TEXT NOT NULL, answered_at TEXT);
      CREATE TABLE IF NOT EXISTS session_decisions (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, action TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ability_documents (id TEXT PRIMARY KEY, title TEXT NOT NULL, markdown TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS checkpoints (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, version INTEGER NOT NULL, event_sequence INTEGER NOT NULL, payload TEXT NOT NULL, saved_at TEXT NOT NULL, UNIQUE(session_id, version));
      CREATE TABLE IF NOT EXISTS attempt_events (id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, sequence INTEGER NOT NULL, type TEXT NOT NULL, occurred_at TEXT NOT NULL, payload TEXT NOT NULL, source TEXT NOT NULL, schema_version INTEGER NOT NULL, UNIQUE(attempt_id, sequence));
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_outbox (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS learner_profile (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
      /* The shared vocabulary: what a challenge is about, two levels deep.
         parent_slug rather than a parent id so the seeded taxonomy can be
         inserted in any order, and so a sub-concept the agent invents can name
         its area before that area exists. "seeded" separates the shipped
         vocabulary from concepts the agent introduced for this learner — only
         the latter is theirs, and only the latter goes on sign-out. */
      CREATE TABLE IF NOT EXISTS concepts (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, kind TEXT NOT NULL, parent_slug TEXT, description TEXT NOT NULL DEFAULT '', seeded INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS question_concepts (question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE, concept_id TEXT NOT NULL REFERENCES concepts(id), role TEXT NOT NULL, PRIMARY KEY (question_id, concept_id));
      CREATE TABLE IF NOT EXISTS ability_concepts (ability_id TEXT NOT NULL REFERENCES ability_documents(id) ON DELETE CASCADE, concept_id TEXT NOT NULL REFERENCES concepts(id), PRIMARY KEY (ability_id, concept_id));
      CREATE INDEX IF NOT EXISTS question_concepts_concept_idx ON question_concepts(concept_id);
      CREATE INDEX IF NOT EXISTS concepts_parent_idx ON concepts(parent_slug);
      /* Problems read from a practice source, kept so that opening a challenge,
         re-reading it a week later and working offline do not each cost a round
         trip to somebody else's service. Keyed on (source, region, slug) because
         the same slug is a different problem on the two LeetCodes.

         The payload holds this learner's status at the source, which makes it
         account data rather than a public cache — so it goes on sign-out with
         everything else of theirs. */
      CREATE TABLE IF NOT EXISTS practice_problems (source TEXT NOT NULL, region TEXT NOT NULL, slug TEXT NOT NULL, title TEXT NOT NULL, difficulty TEXT NOT NULL, payload TEXT NOT NULL, cached_at TEXT NOT NULL, PRIMARY KEY (source, region, slug));
      /* What the source says a problem is related to. Its own table rather than a
         field on the payload because it is a graph and gets asked graph
         questions: what is this a variation of, what leads into it, what should
         someone who just failed it try next. */
      CREATE TABLE IF NOT EXISTS practice_problem_links (source TEXT NOT NULL, region TEXT NOT NULL, from_slug TEXT NOT NULL, to_slug TEXT NOT NULL, relation TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', difficulty TEXT, PRIMARY KEY (source, region, from_slug, to_slug, relation));
      CREATE INDEX IF NOT EXISTS practice_problem_links_to_idx ON practice_problem_links(source, region, to_slug);
    `);
    this.ensureColumn("questions", "replaces_question_id", "TEXT");
    /* Where a challenge came from, as one JSON column rather than eight. Null for
       everything Spar wrote, which is every row that existed before this. */
    this.ensureColumn("questions", "source_ref", "TEXT");
    this.ensureColumn("ability_documents", "evidence_ids", "TEXT NOT NULL DEFAULT '[]'");
    /* An ability is something the learner can be told they have, so it carries
       its own one-line claim, the drills for going deeper, and the moment
       evidence first supported it. Before this it was a markdown blob and a
       version number, which is a document rather than an ability. */
    this.ensureColumn("ability_documents", "summary", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("ability_documents", "practice", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn("ability_documents", "earned_at", "TEXT");
    this.seedConcepts();
    // Filing, not activity: a timestamp rather than a flag so the sidebar can
    // order the shelf it produces without a second column to keep in step.
    /* A turn's tool steps, kept with the reply they produced. Without this the
       activity existed only in the live stream and every finished turn collapsed
       to its last sentence. */
    this.ensureColumn("agent_messages", "activity", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn("sessions", "pinned_at", "TEXT");
    this.ensureColumn("sessions", "archived_at", "TEXT");
    // Remove the exact prototype fixture; it was never learner data.
    this.db.prepare("DELETE FROM sessions WHERE title = ? AND original_goal = ? AND objective = ?").run("Deep JavaScript Runtime", "Understand JavaScript runtime behavior deeply", "Build reliable reasoning about reference ownership and asynchronous state.");
    // Earlier builds stored a pending question as plain text. Upgrade it once so
    // the suspension has a stable identity and does not reset the answer UI.
    const legacyIntakes=this.db.prepare("SELECT session_id,question FROM session_intake WHERE status='pending'").all() as Array<{session_id:string;question:string}>;
    const updateIntake=this.db.prepare("UPDATE session_intake SET question=? WHERE session_id=?");
    this.db.transaction(()=>{for(const row of legacyIntakes){try{askUserQuestionRequestSchema.parse(JSON.parse(row.question));}catch{updateIntake.run(JSON.stringify(legacyQuestionRequest(row.question)),row.session_id);}}})();
  }

  /** Pinned first, then last touched. Archived rows stay in the list — they are
   *  filed away, not deleted, and their attempts still count toward progress. */
  listSessions(): SessionSummary[] { return (this.db.prepare(`SELECT ${SESSION_COLUMNS} FROM sessions ORDER BY (pinned_at IS NULL), updated_at DESC`).all() as SessionRow[]).map(row => this.toSession(row)); }
  createSession(goal: string): { sessionId: string } { const sessionId=randomUUID();const now=new Date().toISOString();const title=goal.length>80?`${goal.slice(0,77)}...`:goal;this.db.prepare("INSERT INTO sessions (id,title,original_goal,objective,status,current_focus,questions,total_seconds,created_at,updated_at) VALUES (?,?,?,?,?,'[]','[]',0,?,?)").run(sessionId,title,goal,"Investigating your prior evidence and defining the first training target.","planning",now,now);this.enqueue("session-create",{sessionId,goal,title,createdAt:now});return{sessionId}; }

  readSession(id: string): SessionDetail | null {
    const row=this.db.prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id=?`).get(id) as SessionRow|undefined;if(!row)return null;
    const question=this.db.prepare("SELECT * FROM questions WHERE session_id=? ORDER BY ordinal DESC LIMIT 1").get(id) as QuestionRow|undefined;
    let active: SessionDetail["question"]=null; let events:SessionDetail["events"]=[];
    // An abandoned challenge stops being the session's live question, which is
    // what returns the app to general chat until the learner asks for another.
    if(question&&question.status!=="abandoned"){const target=this.db.prepare("SELECT * FROM training_targets WHERE id=?").get(question.training_target_id) as Record<string,unknown>;const attempt=this.db.prepare("SELECT * FROM attempts WHERE question_id=? ORDER BY started_at DESC LIMIT 1").get(question.id) as {id:string;latest_event_sequence:number;started_at:string;completed_at:string|null}|undefined;const design=JSON.parse(question.design) as QuestionDesign;if(attempt)events=(this.db.prepare("SELECT id,sequence,type,occurred_at,payload,source FROM attempt_events WHERE attempt_id=? ORDER BY sequence").all(attempt.id) as Array<{id:string;sequence:number;type:string;occurred_at:string;payload:string;source:string}>).map(e=>({...e,occurredAt:e.occurred_at,payload:JSON.parse(e.payload)}));if(attempt)active={id:question.id,sessionId:id,trainingTargetId:question.training_target_id,ordinal:question.ordinal,title:question.title,statement:question.statement,language:question.language,kind:question.kind,status:question.status,difficulty:question.difficulty,replacesQuestionId:question.replaces_question_id,createdAt:question.created_at,abilityId:String(target.ability_id),abilityTitle:String(target.ability_title),specificGap:String(target.specific_gap),desiredEvidence:String(target.desired_evidence),avoidTesting:JSON.parse(String(target.avoid_testing)) as string[],files:challengeFileEntries(design).map(({path,language,readOnly})=>({path,language,readOnly})),visibleTestFiles:Object.keys(design.visibleTests),concepts:this.questionConcepts(question.id),source:parseSourceRef(question.source_ref),attemptId:attempt.id,attemptStartedAt:attempt.started_at,attemptCompletedAt:attempt.completed_at,latestEventSequence:attempt.latest_event_sequence};}
    const messages=(this.db.prepare("SELECT id,role,body,created_at,activity FROM agent_messages WHERE session_id=? ORDER BY created_at").all(id) as Array<{id:string;role:"learner"|"agent"|"system";body:string;created_at:string;activity:string|null}>).map(m=>({id:m.id,role:m.role,body:m.body,createdAt:m.created_at,activity:parseActivity(m.activity)}));
    return{summary:this.toSession(row),question:active,checkpoint:this.latestCheckpoint(id),pendingLearnerQuestion:this.pendingIntake(id)??null,messages,events};
  }

  setObjective(sessionId:string,objective:string){this.db.prepare("UPDATE sessions SET objective=?,updated_at=? WHERE id=?").run(objective,new Date().toISOString(),sessionId);return{objective};}
  setTrainingTarget(sessionId:string,input:{ability:string;specificGap:string;desiredEvidence:string;avoidTesting:string[];action?:TrainingTarget["action"]}){
    const action=input.action??"practise";
    const avoidTesting=JSON.stringify(input.avoidTesting);
    const duplicate=this.db.prepare(`
      SELECT t.* FROM training_targets t
      LEFT JOIN questions q ON q.training_target_id=t.id
      WHERE t.session_id=? AND q.id IS NULL AND lower(t.ability_title)=lower(?)
        AND t.specific_gap=? AND t.desired_evidence=? AND t.avoid_testing=? AND t.action=?
      ORDER BY t.created_at DESC LIMIT 1
    `).get(sessionId,input.ability,input.specificGap,input.desiredEvidence,avoidTesting,action) as Record<string,unknown>|undefined;
    if(duplicate)return normalizeTarget(duplicate);
    const id=randomUUID();const existing=this.db.prepare("SELECT id FROM ability_documents WHERE lower(title)=lower(?) ORDER BY updated_at DESC LIMIT 1").get(input.ability) as {id:string}|undefined;const abilityId=existing?.id??randomUUID();const now=new Date().toISOString();this.db.prepare("INSERT INTO training_targets VALUES (?,?,?,?,?,?,?,?,?)").run(id,sessionId,abilityId,input.ability,input.specificGap,input.desiredEvidence,avoidTesting,action,now);this.db.prepare("UPDATE sessions SET current_focus=?,updated_at=? WHERE id=?").run(JSON.stringify([input.ability]),now,sessionId);return{id,sessionId,abilityId,abilityTitle:input.ability,specificGap:input.specificGap,desiredEvidence:input.desiredEvidence,avoidTesting:input.avoidTesting,action,createdAt:now};
  }
  latestTarget(sessionId:string){return this.db.prepare("SELECT * FROM training_targets WHERE session_id=? ORDER BY created_at DESC LIMIT 1").get(sessionId) as Record<string,unknown>|undefined;}
  createQuestion(sessionId:string,design:QuestionDesign,report:unknown,options:{replacesQuestionId?:string|null;concepts?:ConceptTagInput[];source?:ChallengeSource|null}={}){const target=this.latestTarget(sessionId);if(!target)throw new Error("A persisted training target is required before question creation");const id=randomUUID();const attemptId=randomUUID();const now=new Date().toISOString();const ordinal=(this.db.prepare("SELECT COALESCE(MAX(ordinal),0)+1 value FROM questions WHERE session_id=?").get(sessionId) as {value:number}).value;const tagged=this.db.transaction(()=>{this.db.prepare("INSERT INTO questions (id,session_id,training_target_id,ordinal,title,statement,language,kind,status,difficulty,design,validation_report,created_at,replaces_question_id,source_ref) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id,sessionId,String(target.id),ordinal,design.title,design.statement,design.language,design.kind,"active",design.difficulty??"developing",JSON.stringify(design),JSON.stringify(report),now,options.replacesQuestionId??null,options.source?JSON.stringify(options.source):null);this.db.prepare("INSERT INTO attempts VALUES (?,?,?,?,?,?,NULL)").run(attemptId,id,sessionId,"active",0,now);const event={id:randomUUID(),attemptId,sequence:0,type:"attempt_started",occurredAt:now,payload:{questionId:id,...(options.replacesQuestionId?{replacesQuestionId:options.replacesQuestionId}:{})},source:"system",schemaVersion:1} satisfies AttemptEvent;this.insertEvent(event);
    // Tagged inside the same transaction as the challenge it describes: an
    // untagged challenge is invisible to every concept rollup, so a challenge
    // that exists without its concepts is worse than neither existing.
    const concepts=options.concepts?.length?this.tagQuestion(id,options.concepts):[];
    this.db.prepare("UPDATE sessions SET status='active',updated_at=? WHERE id=?").run(now,sessionId);this.enqueue("question-create",{sessionId,questionId:id,attemptId,design,report,concepts,target:normalizeTarget(target),replacesQuestionId:options.replacesQuestionId??null,source:options.source??null,createdAt:now});return concepts;})();return{id,attemptId,ordinal,concepts:tagged};}
  replaceQuestion(sessionId:string,design:QuestionDesign,report:unknown,reason:string,concepts?:ConceptTagInput[],source?:ChallengeSource|null){const active=this.db.prepare("SELECT q.id,a.id attempt_id FROM questions q JOIN attempts a ON a.question_id=q.id WHERE q.session_id=? AND q.status='active' AND a.status='active' ORDER BY q.ordinal DESC LIMIT 1").get(sessionId) as {id:string;attempt_id:string}|undefined;if(!active)throw new Error("No active challenge exists to replace");this.abandonAttempt(active.attempt_id,reason,"agent","replaced");return this.createQuestion(sessionId,design,report,{replacesQuestionId:active.id,...(concepts?{concepts}:{}),...(source!==undefined?{source}:{})});}
  /** Returns null when the session is gone: a turn can outlive the session the
   *  learner deleted under it, and it has nowhere left to record. */
  /* The transcript syncs. Everything else the cloud holds is what Spar concluded;
     this is what was actually said, and a session restored without its thread
     reads as amnesia rather than as history. */
  addMessage(sessionId:string,role:"learner"|"agent"|"system",body:string,activity:AgentActivityStep[]=[]){const session=this.db.prepare("SELECT id FROM sessions WHERE id=?").get(sessionId) as {id:string}|undefined;if(!session)return null;const value={id:randomUUID(),role,body,createdAt:new Date().toISOString(),activity};this.db.prepare("INSERT INTO agent_messages (id,session_id,role,body,created_at,activity) VALUES (?,?,?,?,?,?)").run(value.id,sessionId,role,body,value.createdAt,JSON.stringify(activity));this.enqueue("agent-message",{sessionId,messages:[value]});return value;}
  hasLearnerEvidence(){const abilities=(this.db.prepare("SELECT COUNT(*) count FROM ability_documents").get() as {count:number}).count;const completed=(this.db.prepare("SELECT COUNT(*) count FROM attempts WHERE status='completed'").get() as {count:number}).count;return abilities>0||completed>0;}
  /**
   * Evidence that can calibrate this goal, rather than any row sharing a generic
   * word with it.  Session routing used to reuse the fuzzy search helpers here.
   * A goal such as "learn DSU in C++" therefore matched an unrelated C++ array
   * attempt, while "DP from scratch; I know loops and arrays" matched the named
   * prerequisites.  Both skipped placement even though the learner had never
   * touched the requested topic.
   *
   * Routing is deliberately stricter than retrieval:
   * - intent/language words do not count as subject evidence;
   * - a multi-term goal needs two topical overlaps;
   * - an uncertain target and an `attempt_started` row are exposure, not learner
   *   evidence.  A real edit, run, submission, remark, or graded event is.
   *
   * The agent still receives the broader fuzzy results after routing, where it
   * can use prerequisite history without mistaking it for topic mastery.
   */
  hasRelevantLearnerEvidence(goal:string){
    const terms=evidenceTerms(goal);
    if(!terms.length)return false;
    const threshold=Math.min(2,terms.length);
    const abilities=this.db.prepare("SELECT title,markdown,status,evidence_ids FROM ability_documents ORDER BY updated_at DESC LIMIT 200").all() as Array<{title:string;markdown:string;status:string;evidence_ids:string}>;
    if(abilities.some((row)=>(row.status!=="uncertain"||parseStringArray(row.evidence_ids).length>0)&&evidenceRelevance(`${row.title}\n${row.markdown}`,terms)>=threshold))return true;
    const events=this.db.prepare("SELECT q.title,e.type,e.payload FROM attempt_events e JOIN attempts a ON a.id=e.attempt_id JOIN questions q ON q.id=a.question_id WHERE e.type<>'attempt_started' ORDER BY e.occurred_at DESC LIMIT 500").all() as Array<{title:string;type:string;payload:string}>;
    return events.some((row)=>evidenceRelevance(`${row.title}\n${row.type}\n${row.payload}`,terms)>=threshold);
  }
  setPendingIntake(sessionId:string,input:AskUserQuestionInput){const existing=this.db.prepare("SELECT question,status,answer FROM session_intake WHERE session_id=?").get(sessionId) as {question:string;status:string;answer:string|null}|undefined;if(existing?.status==="answered"){let request:AskUserQuestionRequest;try{request=askUserQuestionRequestSchema.parse(JSON.parse(existing.question));}catch{request=legacyQuestionRequest(existing.question);}return{request,status:"answered" as const,answer:existing.answer};}const now=new Date().toISOString();const request=askUserQuestionRequestSchema.parse({id:randomUUID(),...input});this.db.prepare("INSERT INTO session_intake (session_id,question,status,answer,created_at,answered_at) VALUES (?,?,'pending',NULL,?,NULL) ON CONFLICT(session_id) DO UPDATE SET question=excluded.question,status='pending',answer=NULL,created_at=excluded.created_at,answered_at=NULL").run(sessionId,JSON.stringify(request),now);return{request,status:"pending" as const};}
  pendingIntake(sessionId:string):AskUserQuestionRequest|undefined{const row=this.db.prepare("SELECT question FROM session_intake WHERE session_id=? AND status='pending'").get(sessionId) as {question:string}|undefined;if(!row)return undefined;try{return askUserQuestionRequestSchema.parse(JSON.parse(row.question));}catch{return legacyQuestionRequest(row.question);}}
  answeredIntake(sessionId:string):string|undefined{const row=this.db.prepare("SELECT answer FROM session_intake WHERE session_id=? AND status='answered'").get(sessionId) as {answer:string|null}|undefined;return row?.answer??undefined;}
  answerIntake(sessionId:string,answer:string){const result=this.db.prepare("UPDATE session_intake SET status='answered',answer=?,answered_at=? WHERE session_id=? AND status='pending'").run(answer,new Date().toISOString(),sessionId);if(result.changes!==1)throw new Error("No pending placement question exists for this session");return{answered:true};}
  resetIncompletePlanning(sessionId:string){
    return this.db.transaction(()=>{
      const session=this.db.prepare("SELECT status FROM sessions WHERE id=?").get(sessionId) as {status:string}|undefined;
      if(!session||session.status!=="planning")return false;
      const questions=(this.db.prepare("SELECT COUNT(*) count FROM questions WHERE session_id=?").get(sessionId) as {count:number}).count;
      if(questions>0)return false;
      const targets=(this.db.prepare("SELECT COUNT(*) count FROM training_targets WHERE session_id=?").get(sessionId) as {count:number}).count;
      if(targets===0)return false;
      this.db.prepare("DELETE FROM session_decisions WHERE session_id=?").run(sessionId);
      this.db.prepare("DELETE FROM training_targets WHERE session_id=?").run(sessionId);
      this.db.prepare("UPDATE sessions SET objective=?,current_focus='[]',updated_at=? WHERE id=?").run("Investigating your prior evidence and defining the first training target.",new Date().toISOString(),sessionId);
      return true;
    })();
  }
  commitDecision(sessionId:string,input:{action:string;reason:string}){const value={id:randomUUID(),...input,createdAt:new Date().toISOString()};this.db.prepare("INSERT INTO session_decisions VALUES (?,?,?,?,?)").run(value.id,sessionId,value.action,value.reason,value.createdAt);return value;}
  searchLearner(query:string,limit:number){const terms=searchTerms(query);if(!terms.length)return[];const rows=this.db.prepare("SELECT id,title,markdown,version,status,updated_at FROM ability_documents ORDER BY updated_at DESC LIMIT 200").all() as Array<{id:string;title:string;markdown:string;version:number;status:string;updated_at:string}>;return rows.map(row=>({row,score:relevance(`${row.title}\n${row.markdown}`,terms)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||b.row.updated_at.localeCompare(a.row.updated_at)).slice(0,limit).map(item=>item.row);}
  readAbility(id:string){return this.db.prepare("SELECT * FROM ability_documents WHERE id=?").get(id)??null;}
  searchAttempts(query:string,limit:number){const terms=searchTerms(query);if(!terms.length)return[];const rows=this.db.prepare("SELECT e.attempt_id,e.type,e.occurred_at,e.payload,q.title FROM attempt_events e JOIN attempts a ON a.id=e.attempt_id JOIN questions q ON q.id=a.question_id ORDER BY e.occurred_at DESC LIMIT 500").all() as Array<{attempt_id:string;type:string;occurred_at:string;payload:string;title:string}>;return rows.map(row=>({row,score:relevance(`${row.title}\n${row.type}\n${row.payload}`,terms)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||b.row.occurred_at.localeCompare(a.row.occurred_at)).slice(0,limit).map(item=>item.row);}
  readAttempt(id:string){return (this.db.prepare("SELECT id,attempt_id,sequence,type,occurred_at,payload,source,schema_version FROM attempt_events WHERE attempt_id=? ORDER BY sequence").all(id) as Array<{id:string;attempt_id:string;sequence:number;type:string;occurred_at:string;payload:string;source:string;schema_version:number}>).map((event)=>({id:event.id,attemptId:event.attempt_id,sequence:event.sequence,type:event.type,occurredAt:event.occurred_at,payload:JSON.parse(event.payload),source:event.source,schemaVersion:event.schema_version}));}
  /** What the challenge behind an attempt is, so a replay of the attempt can name
   *  it. Separate from `readChallenge`, which returns the whole design and every
   *  attempt at it — far more than a replay header needs. */
  attemptSubject(attemptId:string){const row=this.db.prepare("SELECT q.id question_id,q.title,q.language,q.statement,q.ordinal,a.status,a.started_at,a.completed_at,s.id session_id FROM attempts a JOIN questions q ON q.id=a.question_id JOIN sessions s ON s.id=a.session_id WHERE a.id=?").get(attemptId) as {question_id:string;title:string;language:string;statement:string;ordinal:number;status:string;started_at:string;completed_at:string|null;session_id:string}|undefined;return row??null;}
  submissionBundle(attemptId:string){const row=this.db.prepare("SELECT a.id attempt_id,a.session_id,a.latest_event_sequence,q.id question_id,q.language,q.design FROM attempts a JOIN questions q ON q.id=a.question_id WHERE a.id=? AND a.status='active'").get(attemptId) as {attempt_id:string;session_id:string;latest_event_sequence:number;question_id:string;language:"javascript"|"typescript"|"cpp";design:string}|undefined;return row?{...row,design:JSON.parse(row.design) as QuestionDesign}:null;}
  completeAttempt(attemptId:string,_outcome:"passed"|"failed"){const now=new Date().toISOString();this.db.transaction(()=>{const attempt=this.db.prepare("SELECT question_id,session_id FROM attempts WHERE id=?").get(attemptId) as {question_id:string;session_id:string}|undefined;if(!attempt)throw new Error("Attempt not found");this.db.prepare("UPDATE attempts SET status='completed',completed_at=? WHERE id=?").run(now,attemptId);this.db.prepare("UPDATE questions SET status='completed' WHERE id=?").run(attempt.question_id);this.db.prepare("UPDATE sessions SET updated_at=? WHERE id=?").run(now,attempt.session_id);})();}
  /** The learner gave up. Records why, then leaves the session in chat mode. */
  abandonAttempt(attemptId:string,reason:string,source:"learner"|"agent"="learner",outcome:"abandoned"|"replaced"="abandoned"){const now=new Date().toISOString();return this.db.transaction(()=>{const attempt=this.db.prepare("SELECT question_id,session_id,latest_event_sequence FROM attempts WHERE id=? AND status='active'").get(attemptId) as {question_id:string;session_id:string;latest_event_sequence:number}|undefined;if(!attempt)throw new Error("No active attempt to abandon");const event={id:randomUUID(),attemptId,sequence:attempt.latest_event_sequence+1,type:"attempt_completed",occurredAt:now,payload:{outcome,reason},source,schemaVersion:1} satisfies AttemptEvent;this.insertEvent(event);this.db.prepare("UPDATE attempts SET status='completed',completed_at=?,latest_event_sequence=? WHERE id=?").run(now,event.sequence,attemptId);this.db.prepare("UPDATE questions SET status='abandoned' WHERE id=?").run(attempt.question_id);this.db.prepare("UPDATE sessions SET status='paused',updated_at=? WHERE id=?").run(now,attempt.session_id);this.enqueue("attempt-event",event);return{sessionId:attempt.session_id,questionId:attempt.question_id};})();}
  setSessionStatus(sessionId:string,status:"planning"|"active"|"paused"|"completed"){this.db.prepare("UPDATE sessions SET status=?,updated_at=? WHERE id=?").run(status,new Date().toISOString(),sessionId);}
  /* Renaming, pinning and archiving deliberately leave `updated_at` alone. It is
     the last-touched time the sidebar and the home page order by, and tidying a
     list is not work on the goal — bumping it would shuffle everything the
     learner just organised back to the top. */
  renameSession(sessionId:string,title:string){const value=title.trim().slice(0,80);if(!value)throw new Error("A session title is required");const result=this.db.prepare("UPDATE sessions SET title=? WHERE id=?").run(value,sessionId);if(result.changes!==1)throw new Error("Session not found");this.enqueue("session-rename",{sessionId,title:value});return{title:value};}
  /* Filing syncs too. Pinning is a statement about what matters, not a window
     preference, so a session pinned on one machine is pinned on the next. */
  setSessionPinned(sessionId:string,pinned:boolean){const pinnedAt=pinned?new Date().toISOString():null;this.db.prepare("UPDATE sessions SET pinned_at=? WHERE id=?").run(pinnedAt,sessionId);this.enqueue("session-flags",{sessionId,pinnedAt});}
  /** Archiving also unpins: a session cannot be both put away and held at the top. */
  setSessionArchived(sessionId:string,archived:boolean){const archivedAt=archived?new Date().toISOString():null;this.db.prepare("UPDATE sessions SET archived_at=?,pinned_at=CASE WHEN ? THEN NULL ELSE pinned_at END WHERE id=?").run(archivedAt,archived?1:0,sessionId);this.enqueue("session-flags",{sessionId,archivedAt,...(archived?{pinnedAt:null}:{})});}
  /* Permanent, and the learner is told so before it runs. Cascades cover the
     session's own children; attempt events and checkpoints are keyed on ids
     rather than declared as foreign keys, so they are removed by hand. */
  deleteSession(sessionId:string){return this.db.transaction(()=>{const row=this.db.prepare("SELECT id FROM sessions WHERE id=?").get(sessionId) as {id:string}|undefined;if(!row)return false;this.db.prepare("DELETE FROM attempt_events WHERE attempt_id IN (SELECT id FROM attempts WHERE session_id=?)").run(sessionId);this.db.prepare("DELETE FROM checkpoints WHERE session_id=?").run(sessionId);this.db.prepare("DELETE FROM sessions WHERE id=?").run(sessionId);this.enqueue("session-delete",{sessionId});return true;})();}
  updateAbility(input:{abilityId:string;markdown:string;evidenceEventIds:string[];summary?:string;practice?:string[];concepts?:ConceptTagInput[];status?:AbilityStatus}){const target=this.db.prepare("SELECT ability_title FROM training_targets WHERE ability_id=? ORDER BY created_at DESC LIMIT 1").get(input.abilityId) as {ability_title:string}|undefined;const existing=this.abilityRow(input.abilityId);return this.writeAbility({id:input.abilityId,title:existing?.title??target?.ability_title??"Observed ability",...input},existing);}
  upsertAbility(input:{title:string;markdown:string;evidenceEventIds:string[];summary?:string;practice?:string[];concepts?:ConceptTagInput[];status?:AbilityStatus}){const found=this.db.prepare("SELECT id FROM ability_documents WHERE lower(title)=lower(?) ORDER BY updated_at DESC LIMIT 1").get(input.title) as {id:string}|undefined;const existing=found?this.abilityRow(found.id):undefined;return this.writeAbility({id:existing?.id??randomUUID(),...input},existing);}
  ensureAbility(id:string,title:string){const now=new Date().toISOString();this.db.prepare("INSERT OR IGNORE INTO ability_documents (id,title,markdown,version,status,updated_at,evidence_ids,summary,practice,earned_at) VALUES (?,?,?,?,?,?,?,?,?,NULL)").run(id,title,`# ${title}\n\nIntroduced as an active learning target. Evidence is still uncertain.`,1,"uncertain",now,"[]","",'[]');return this.readAbility(id);}
  /**
   * One ability version. An ability is the thing the learner is told they have,
   * so this owns the two facts the UI is not allowed to guess: the status, which
   * follows the evidence rather than the agent's enthusiasm, and `earned_at`,
   * stamped once when evidence first supported it and never moved afterwards —
   * the date it was earned, not the date the document was last edited.
   */
  private writeAbility(input:{id:string;title:string;markdown:string;evidenceEventIds:string[];summary?:string;practice?:string[];concepts?:ConceptTagInput[];status?:AbilityStatus},existing?:AbilityRow){
    const now=new Date().toISOString();
    const evidenceIds=[...new Set([...(existing?JSON.parse(existing.evidence_ids) as string[]:[]),...input.evidenceEventIds])];
    const version=(existing?.version??0)+1;
    const status=input.status??abilityStatusFor(evidenceIds.length);
    /* Stamped once, and never restamped. An ability written before this column
       existed has no date to recover, so it inherits its last edit rather than
       claiming to have been earned just now — a wrong-but-close date is a
       rounding error, and "earned 2 minutes ago" on a month-old ability is a
       lie the card would tell every time it was opened. */
    const earnedAt=existing?.earned_at??(status==="uncertain"?null:existing&&existing.status!=="uncertain"?existing.updated_at:now);
    const summary=input.summary?.trim()||existing?.summary||"";
    const practice=input.practice?.length?input.practice.map((item)=>item.trim()).filter(Boolean).slice(0,4):(existing?JSON.parse(existing.practice) as string[]:[]);
    this.db.transaction(()=>{
      this.db.prepare("INSERT INTO ability_documents (id,title,markdown,version,status,updated_at,evidence_ids,summary,practice,earned_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,markdown=excluded.markdown,version=excluded.version,status=excluded.status,updated_at=excluded.updated_at,evidence_ids=excluded.evidence_ids,summary=excluded.summary,practice=excluded.practice,earned_at=excluded.earned_at").run(input.id,input.title,input.markdown,version,status,now,JSON.stringify(evidenceIds),summary,JSON.stringify(practice),earnedAt);
      // Concepts are replaced rather than merged: the set is the agent's current
      // claim about what this ability covers, and a stale concept left attached
      // would keep pulling unrelated challenges into its evidence.
      if(input.concepts?.length){
        this.db.prepare("DELETE FROM ability_concepts WHERE ability_id=?").run(input.id);
        const link=this.db.prepare("INSERT OR IGNORE INTO ability_concepts (ability_id,concept_id) VALUES (?,?)");
        for(const tag of input.concepts.slice(0,8))link.run(input.id,this.ensureConcept(tag).id);
      }
    })();
    return {id:input.id,title:input.title,version,status,summary,practice,earnedAt,evidenceEventIds:evidenceIds,concepts:this.abilityConcepts(input.id),updatedAt:now};
  }
  listAbilities():AbilityHistorySummary[]{const concepts=this.abilityConceptRows();return (this.db.prepare("SELECT id,title,markdown,version,status,updated_at,evidence_ids,summary,practice,earned_at FROM ability_documents ORDER BY (earned_at IS NULL), updated_at DESC").all() as AbilityRow[]).map((row)=>this.toAbility(row,concepts.get(row.id)??[]));}
  /** The ability's own page: the document, and the challenges that are the reason
   *  it exists. Evidence is the challenges created against this ability's targets
   *  — the causal link, not merely challenges that share a concept with it. */
  readAbilityDetail(id:string):AbilityDetail|null{
    const row=this.abilityRow(id);
    if(!row)return null;
    const evidence=this.db.prepare(`SELECT ch.id challenge_id,ch.session_id,s.title session_title,ch.title,ch.language,ch.difficulty,ch.outcome,ch.updated_at occurred_at FROM (${CHALLENGE_OUTCOME_SQL}) ch JOIN training_targets t ON t.id=ch.training_target_id JOIN sessions s ON s.id=ch.session_id WHERE t.ability_id=? ORDER BY ch.updated_at DESC`).all(id) as Array<{challenge_id:string;session_id:string;session_title:string;title:string;language:string;difficulty:string;outcome:string;occurred_at:string}>;
    return {
      ability:this.toAbility(row,this.abilityConcepts(id)),
      evidence:evidence.map((item)=>({challengeId:item.challenge_id,sessionId:item.session_id,sessionTitle:item.session_title,title:item.title,language:item.language as Language,difficulty:item.difficulty as AbilityDetail["evidence"][number]["difficulty"],outcome:item.outcome as AbilityDetail["evidence"][number]["outcome"],occurredAt:item.occurred_at})),
    };
  }
  queueAbilitySync(id:string){const row=this.abilityRow(id);if(row)this.enqueue("ability-upsert",{id:row.id,title:row.title,markdown:row.markdown,version:row.version,status:row.status,summary:row.summary,earnedAt:row.earned_at,updatedAt:row.updated_at,concepts:this.abilityConcepts(id).map((tag)=>tag.slug),evidenceEventIds:JSON.parse(row.evidence_ids)});}
  private abilityRow(id:string){return this.db.prepare("SELECT id,title,markdown,version,status,updated_at,evidence_ids,summary,practice,earned_at FROM ability_documents WHERE id=?").get(id) as AbilityRow|undefined;}
  private abilityConcepts(id:string):ConceptTag[]{return this.abilityConceptRows(id).get(id)??[];}
  private abilityConceptRows(id?:string){
    const rows=this.db.prepare(`SELECT ac.ability_id key,c.slug,c.title,c.kind,c.parent_slug,p.title parent_title FROM ability_concepts ac JOIN concepts c ON c.id=ac.concept_id LEFT JOIN concepts p ON p.slug=c.parent_slug${id?" WHERE ac.ability_id=?":""} ORDER BY c.title`).all(...(id?[id]:[]) as []) as Array<{key:string;slug:string;title:string;kind:string;parent_slug:string|null;parent_title:string|null}>;
    const grouped=new Map<string,ConceptTag[]>();
    for(const row of rows)grouped.set(row.key,[...(grouped.get(row.key)??[]),{slug:row.slug,title:row.title,kind:row.kind as ConceptKind,parentSlug:row.parent_slug,parentTitle:row.parent_title,role:"primary" as const}]);
    return grouped;
  }
  private toAbility(row:AbilityRow,concepts:ConceptTag[]):AbilityHistorySummary{return {id:row.id,title:row.title,markdown:row.markdown,summary:row.summary,version:row.version,status:row.status,evidenceCount:(JSON.parse(row.evidence_ids) as string[]).length,concepts,practice:JSON.parse(row.practice) as string[],earnedAt:row.earned_at,updatedAt:row.updated_at};}
  listChallenges():ChallengeHistorySummary[]{const tags=this.conceptTagRows("",[]);const rows=this.db.prepare(`SELECT q.id,q.session_id,s.title session_title,q.ordinal,q.title,q.language,q.difficulty,q.status,q.replaces_question_id,q.source_ref,parent.title replaces_question_title,child.id replaced_by_question_id,child.title replaced_by_question_title,q.created_at,COALESCE(MAX(a.completed_at),q.created_at) updated_at,COUNT(DISTINCT a.id) attempt_count,(SELECT COUNT(*) FROM attempt_events te JOIN attempts ta ON ta.id=te.attempt_id WHERE ta.question_id=q.id AND te.type='test_run') test_run_count,(SELECT json_extract(te.payload,'$.outcome') FROM attempt_events te JOIN attempts ta ON ta.id=te.attempt_id WHERE ta.question_id=q.id AND te.type='attempt_completed' ORDER BY te.occurred_at DESC LIMIT 1) last_outcome FROM questions q JOIN sessions s ON s.id=q.session_id LEFT JOIN questions parent ON parent.id=q.replaces_question_id LEFT JOIN questions child ON child.replaces_question_id=q.id LEFT JOIN attempts a ON a.question_id=q.id GROUP BY q.id ORDER BY updated_at DESC`).all() as Array<Record<string,unknown>>;return rows.map((row)=>({id:String(row.id),sessionId:String(row.session_id),sessionTitle:String(row.session_title),ordinal:Number(row.ordinal),title:String(row.title),language:String(row.language) as ChallengeHistorySummary["language"],difficulty:String(row.difficulty) as ChallengeHistorySummary["difficulty"],status:String(row.status) as ChallengeHistorySummary["status"],replacesQuestionId:row.replaces_question_id?String(row.replaces_question_id):null,replacesQuestionTitle:row.replaces_question_title?String(row.replaces_question_title):null,replacedByQuestionId:row.replaced_by_question_id?String(row.replaced_by_question_id):null,replacedByQuestionTitle:row.replaced_by_question_title?String(row.replaced_by_question_title):null,attemptCount:Number(row.attempt_count),testRunCount:Number(row.test_run_count),lastOutcome:row.last_outcome?String(row.last_outcome) as ChallengeHistorySummary["lastOutcome"]:null,concepts:tags.get(String(row.id))??[],source:parseSourceRef(row.source_ref as string|null),createdAt:String(row.created_at),updatedAt:String(row.updated_at)}));}
  /** Concepts are part of what a challenge *is*, so they are searchable text: the
   *  agent looking for "sliding window" evidence has to find the challenges that
   *  were tagged with it even when the title never says the words. */
  searchChallenges(query:string,limit:number){const terms=searchTerms(query);const rows=this.listChallenges();if(!terms.length)return rows.slice(0,limit);return rows.map((row)=>({row,score:relevance(`${row.title}\n${row.sessionTitle}\n${row.difficulty}\n${row.lastOutcome??""}\n${row.concepts.map((tag)=>`${tag.slug.replace(/-/g," ")} ${tag.title} ${tag.parentTitle??""}`).join("\n")}`,terms)})).filter((item)=>item.score>0).sort((a,b)=>b.score-a.score||b.row.updatedAt.localeCompare(a.row.updatedAt)).slice(0,limit).map((item)=>item.row);}
  /** What the learner has actually been asked lately, across every session,
   *  flattened to the fields a targeting decision needs.
   *
   *  Deliberately not a search: a search only answers the question the agent
   *  thought to ask, and the failure this exists to prevent is a new goal that
   *  never thinks to ask. Carried on every planning turn's context so the same
   *  primary concept coming back for the thirteenth time is visible before the
   *  target is set rather than after the challenge is published. */
  recentChallengeCoverage(limit=12){return this.listChallenges().slice(0,limit).map((row)=>({title:row.title,goal:row.sessionTitle,primaryConcept:row.concepts[0]?.slug??null,difficulty:row.difficulty,outcome:row.lastOutcome,askedAt:row.createdAt}));}
  /** Whether this exact title has been asked before anywhere. The session-scoped
   *  check let the same challenge come back under a new session, which is what
   *  the learner sees as repetition — the library is one library to them. */
  challengeTitleUsed(title:string){const normalized=title.trim().toLocaleLowerCase();if(!normalized)return false;const rows=this.db.prepare("SELECT title FROM questions").all() as Array<{title:string}>;return rows.some((row)=>row.title.trim().toLocaleLowerCase()===normalized);}
  readChallenge(id:string){const row=this.db.prepare("SELECT q.*,s.title session_title FROM questions q JOIN sessions s ON s.id=q.session_id WHERE q.id=?").get(id) as (QuestionRow&{session_title:string;validation_report:string})|undefined;if(!row)return null;const attempts=this.db.prepare("SELECT id,status,started_at,completed_at FROM attempts WHERE question_id=? ORDER BY started_at").all(id) as Array<Record<string,unknown>>;return{...row,sessionTitle:row.session_title,concepts:this.questionConcepts(id),design:JSON.parse(row.design),validationReport:JSON.parse(row.validation_report),attempts:attempts.map((attempt)=>({...attempt,events:this.readAttempt(String(attempt.id))}))};}
  /** One challenge with everything it needs to stand on its own away from its
   *  session: the design it was compiled from, the goal and target it answers,
   *  and every attempt at it in order. Read by the standalone challenge page,
   *  which practises against a sandbox and so never touches an attempt. */
  challengeRecord(id:string){
    const row=this.db.prepare("SELECT q.id,q.session_id,q.training_target_id,q.statement,q.kind,q.design,q.source_ref,s.original_goal,s.status session_status FROM questions q JOIN sessions s ON s.id=q.session_id WHERE q.id=?").get(id) as {id:string;session_id:string;training_target_id:string;statement:string;kind:QuestionRow["kind"];design:string;source_ref:string|null;original_goal:string;session_status:SessionSummary["status"]}|undefined;
    if(!row)return null;
    const target=this.db.prepare("SELECT ability_title,specific_gap,desired_evidence,action FROM training_targets WHERE id=?").get(row.training_target_id) as {ability_title:string;specific_gap:string;desired_evidence:string;action:TrainingTarget["action"]}|undefined;
    const attempts=(this.db.prepare("SELECT id FROM attempts WHERE question_id=? ORDER BY started_at").all(id) as Array<{id:string}>).map((attempt,index)=>({ordinal:index+1,events:this.readAttempt(attempt.id)}));
    return{sessionId:row.session_id,statement:row.statement,kind:row.kind,design:JSON.parse(row.design) as QuestionDesign,source:parseSourceRef(row.source_ref),sessionGoal:row.original_goal,sessionStatus:row.session_status,abilityTitle:target?.ability_title??"",specificGap:target?.specific_gap??"",desiredEvidence:target?.desired_evidence??"",action:target?.action??null,attempts};
  }
  /** Every challenge's starter excerpt, keyed by id. Its own read rather than a
   *  column on the history row: bootstrap carries that row whether or not the
   *  learner ever opens the list, and code is too much to send on that path. */
  challengePreviews(){const rows=this.db.prepare("SELECT id,design FROM questions").all() as Array<{id:string;design:string}>;const previews:Record<string,ChallengeCodePreview>={};for(const row of rows){let preview:ChallengeCodePreview|null=null;try{preview=codePreview(JSON.parse(row.design) as QuestionDesign);}catch{preview=null;}if(preview)previews[row.id]=preview;}return previews;}

  /* ---- Practice sources -----------------------------------------------------
     A problem read from someone else's service, kept so that opening it,
     re-reading it next week and working on a train do not each cost a request.
     The cache is keyed on (source, region, slug) because the same slug is a
     different problem on the two LeetCodes, and it stores the whole normalised
     problem rather than a summary: the statement is the expensive part and the
     part most often wanted again. */

  cachePracticeProblem(input:{source:string;region:string;slug:string;title:string;difficulty:string;payload:unknown;references?:Array<{slug:string;title:string;difficulty:string|null;relation:string}>}){
    const now=new Date().toISOString();
    this.db.transaction(()=>{
      this.db.prepare("INSERT INTO practice_problems (source,region,slug,title,difficulty,payload,cached_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(source,region,slug) DO UPDATE SET title=excluded.title,difficulty=excluded.difficulty,payload=excluded.payload,cached_at=excluded.cached_at").run(input.source,input.region,input.slug,input.title,input.difficulty,JSON.stringify(input.payload),now);
      if(!input.references?.length)return;
      /* Replaced rather than merged: the source's current answer about what a
         problem relates to is the whole answer, and a link it has dropped should
         stop being offered. */
      this.db.prepare("DELETE FROM practice_problem_links WHERE source=? AND region=? AND from_slug=?").run(input.source,input.region,input.slug);
      const link=this.db.prepare("INSERT OR IGNORE INTO practice_problem_links (source,region,from_slug,to_slug,relation,title,difficulty) VALUES (?,?,?,?,?,?,?)");
      for(const reference of input.references.slice(0,24))link.run(input.source,input.region,input.slug,reference.slug,reference.relation,reference.title,reference.difficulty);
    })();
  }

  /** A cached problem, or null when it was never read or has gone stale. Staleness
   *  is the caller's call because it differs by use: a statement is good for
   *  weeks, and the learner's solved status on it is good for minutes. */
  readCachedPracticeProblem(source:string,region:string,slug:string,maxAgeMs?:number){
    const row=this.db.prepare("SELECT payload,cached_at FROM practice_problems WHERE source=? AND region=? AND slug=?").get(source,region,slug) as {payload:string;cached_at:string}|undefined;
    if(!row)return null;
    /* `>=`, so a max age of zero means "nothing cached will do". With `>` a
       caller asking for a guaranteed-fresh read got the copy written in the same
       millisecond — which is exactly the read that must not be served stale. */
    if(maxAgeMs!==undefined&&Date.now()-Date.parse(row.cached_at)>=maxAgeMs)return null;
    try{return {payload:JSON.parse(row.payload) as unknown,cachedAt:row.cached_at};}catch{return null;}
  }

  /**
   * What the source says a problem is related to, in both directions.
   *
   * Both directions on purpose. "This is a harder version of what you just
   * failed" and "this is what that problem leads to" are the same edge read from
   * opposite ends, and only one of them is ever stored — LeetCode publishes
   * relations from the newer problem to the older one.
   */
  practiceProblemLinks(source:string,region:string,slug:string){
    const outgoing=this.db.prepare("SELECT to_slug slug,relation,title,difficulty FROM practice_problem_links WHERE source=? AND region=? AND from_slug=?").all(source,region,slug) as Array<{slug:string;relation:string;title:string;difficulty:string|null}>;
    const incoming=this.db.prepare("SELECT p.from_slug slug,p.relation,COALESCE(c.title,'') title,c.difficulty FROM practice_problem_links p LEFT JOIN practice_problems c ON c.source=p.source AND c.region=p.region AND c.slug=p.from_slug WHERE p.source=? AND p.region=? AND p.to_slug=?").all(source,region,slug) as Array<{slug:string;relation:string;title:string;difficulty:string|null}>;
    return {outgoing,incoming};
  }

  /** Every sourced challenge the learner has been set, newest first. Read before
   *  assigning one so the same problem is not set twice — and so a problem they
   *  gave up on can be recognised when it comes round again. */
  assignedPracticeProblems(limit=40){
    return (this.db.prepare(`SELECT q.source_ref,q.title,q.status,ch.outcome,ch.updated_at FROM questions q JOIN (${CHALLENGE_OUTCOME_SQL}) ch ON ch.id=q.id WHERE q.source_ref IS NOT NULL ORDER BY ch.updated_at DESC LIMIT ?`).all(limit) as Array<{source_ref:string;title:string;status:string;outcome:string;updated_at:string}>)
      .flatMap((row)=>{const source=parseSourceRef(row.source_ref);return source?[{slug:source.slug,source:source.source,region:source.region,title:row.title,outcome:row.outcome,assignedAt:row.updated_at}]:[];});
  }

  /* ---- Concepts -------------------------------------------------------------
     A concept is what a challenge is about, and the unit evidence accumulates
     against. The shipped taxonomy is re-applied on every launch so an edit to it
     reaches a store that already exists — and so a concept the agent invented
     before it was seeded is upgraded in place rather than duplicated beside the
     seeded one. Only vocabulary is overwritten; nothing tagged is touched. */
  private seedConcepts(){
    const upsert=this.db.prepare("INSERT INTO concepts (id,slug,title,kind,parent_slug,description,seeded,created_at) VALUES (?,?,?,?,?,?,1,?) ON CONFLICT(slug) DO UPDATE SET title=excluded.title,kind=excluded.kind,parent_slug=excluded.parent_slug,description=excluded.description,seeded=1");
    const now=new Date().toISOString();
    this.db.transaction(()=>{for(const seed of CONCEPT_TAXONOMY)upsert.run(randomUUID(),seed.slug,seed.title,seed.kind,seed.parentSlug,seed.description,now);})();
  }

  /** The concept for a slug, created if Spar has not met it. The agent is allowed
   *  to extend the vocabulary — a learner working on something the taxonomy never
   *  anticipated must still get evidence recorded against a name for it — so an
   *  unknown slug is a new concept rather than a rejected tool call. */
  ensureConcept(input:ConceptTagInput):ConceptRow{
    const slug=conceptSlug(input.slug);
    if(!slug)throw new Error("A concept slug is required");
    const existing=this.db.prepare("SELECT id,slug,title,kind,parent_slug,description FROM concepts WHERE slug=?").get(slug) as ConceptRow|undefined;
    if(existing)return existing;
    const seed=seededConcept(slug);
    // A parent named by the agent is ensured first, and only ever as an area: the
    // tree is two levels by design, and a three-level chain would put evidence
    // somewhere neither the rollups nor the UI look.
    const parentSlug=seed?.parentSlug??(input.parentSlug?conceptSlug(input.parentSlug):null);
    if(parentSlug&&parentSlug!==slug&&!this.db.prepare("SELECT 1 FROM concepts WHERE slug=?").get(parentSlug)){
      const parentSeed=seededConcept(parentSlug);
      this.db.prepare("INSERT OR IGNORE INTO concepts (id,slug,title,kind,parent_slug,description,seeded,created_at) VALUES (?,?,?,?,NULL,?,?,?)").run(randomUUID(),parentSlug,parentSeed?.title??conceptTitleFromSlug(parentSlug),parentSeed?.kind??conceptKind(input.kind),parentSeed?.description??"",parentSeed?1:0,new Date().toISOString());
    }
    const row:ConceptRow={id:randomUUID(),slug,title:seed?.title??(input.title?.trim()||conceptTitleFromSlug(slug)),kind:seed?.kind??conceptKind(input.kind),parent_slug:parentSlug===slug?null:parentSlug,description:seed?.description??(input.description?.trim()??"")};
    this.db.prepare("INSERT INTO concepts (id,slug,title,kind,parent_slug,description,seeded,created_at) VALUES (?,?,?,?,?,?,?,?)").run(row.id,row.slug,row.title,row.kind,row.parent_slug,row.description,seed?1:0,new Date().toISOString());
    /* Only what the agent invented is pushed. The shipped taxonomy reseeds itself
       on any device from the binary, so syncing it would be uploading a constant
       — and the ids differ per install, which is why the slug is the identity on
       both sides. */
    if(!seed)this.enqueue("concept-create",{concepts:[{slug:row.slug,title:row.title,kind:row.kind,parentSlug:row.parent_slug,description:row.description}]});
    return row;
  }

  /** Replaces a challenge's tags outright. Re-tagging is how the agent corrects
   *  an aim it got wrong, so the previous set must not survive as evidence. */
  tagQuestion(questionId:string,tags:ConceptTagInput[]){
    const resolved=tags.slice(0,8).map((tag)=>({concept:this.ensureConcept(tag),role:tag.role==="supporting"?"supporting":"primary"}));
    // At most one primary. The first tag is the aim; the rest support it.
    const normalized=resolved.map((entry,index)=>({...entry,role:index===0?entry.role:entry.role==="primary"?"supporting":entry.role}));
    this.db.transaction(()=>{
      this.db.prepare("DELETE FROM question_concepts WHERE question_id=?").run(questionId);
      const insert=this.db.prepare("INSERT OR IGNORE INTO question_concepts (question_id,concept_id,role) VALUES (?,?,?)");
      for(const entry of normalized)insert.run(questionId,entry.concept.id,entry.role);
    })();
    return normalized.map((entry)=>({slug:entry.concept.slug,title:entry.concept.title,role:entry.role}));
  }

  /** The tags on one challenge, primary first — the order a row with room for a
   *  single chip depends on. */
  questionConcepts(questionId:string):ConceptTag[]{return this.conceptTagRows("WHERE qc.question_id=?",[questionId]).get(questionId)??[];}

  /** Every concept the learner has actually met, richest first. Counts roll a
   *  sub-concept's evidence up into its area, so "Sliding window" reads as the
   *  whole shelf while "Restoring the invariant" stays the finding. */
  listConcepts():ConceptSummary[]{
    const index=this.conceptIndex();
    return index.rows
      .map((row)=>index.summarize(row))
      .filter((summary)=>summary.challengeCount>0||summary.abilityCount>0)
      .sort((left,right)=>right.challengeCount-left.challengeCount||(right.lastSeenAt??"").localeCompare(left.lastSeenAt??"")||left.title.localeCompare(right.title));
  }

  conceptDetail(slug:string):ConceptDetail|null{
    const index=this.conceptIndex();
    const row=index.bySlug.get(conceptSlug(slug));
    if(!row)return null;
    const parent=row.parent_slug?index.bySlug.get(row.parent_slug):undefined;
    return {
      concept:index.summarize(row),
      parent:parent?index.summarize(parent):null,
      // Only sub-concepts with something behind them: an area's full seeded list
      // would bury the two the learner has actually been tested on.
      children:index.childrenOf(row.slug).map((child)=>index.summarize(child)).filter((child)=>child.challengeCount>0).sort((left,right)=>right.challengeCount-left.challengeCount),
      challenges:index.evidence(row),
      abilities:index.abilitiesFor(row).map((ability)=>({id:ability.id,title:ability.title,status:ability.status})),
    };
  }

  /**
   * The agent's view of the vocabulary. Unlike {@link listConcepts} this includes
   * seeded concepts with no evidence yet, because choosing what to test next
   * means seeing the shelf the learner has not reached — the old stub returned an
   * empty graph, which read as "this learner has no concepts" and left the tool
   * useless.
   */
  conceptGraph(query:string,limit=14):Array<ConceptSummary&{standing:string}>{
    const index=this.conceptIndex();
    const terms=searchTerms(query);
    const scored=index.rows.map((row)=>{
      const summary=index.summarize(row);
      const relevanceScore=terms.length?relevance(`${row.slug.replace(/-/g," ")} ${row.title} ${row.description} ${row.parent_slug?.replace(/-/g," ")??""}`,terms):0;
      // Evidence outranks a text match: what the learner has been measured on is
      // more useful to a pedagogical decision than a keyword hit.
      return {summary,score:relevanceScore*4+(summary.challengeCount?2:0)+(summary.abilityCount?1:0)};
    });
    const matched=scored.filter((item)=>item.score>0).sort((left,right)=>right.score-left.score||right.summary.challengeCount-left.summary.challengeCount);
    return (matched.length?matched:scored.filter((item)=>item.summary.challengeCount>0).sort((left,right)=>right.summary.challengeCount-left.summary.challengeCount))
      .slice(0,limit)
      .map((item)=>({...item.summary,standing:conceptStandingOf(item.summary)}));
  }

  /**
   * How the learner behaves under one concept, broken down by sub-concept. This
   * is what lets the agent say "arrays are fine, the in-place pass is not"
   * instead of averaging the two into a number that hides both.
   */
  conceptEvidenceReport(query:string,limit=4){
    const index=this.conceptIndex();
    const slug=conceptSlug(query);
    const direct=index.bySlug.get(slug);
    const targets=direct?[direct]:this.conceptGraph(query,limit).flatMap((summary)=>{const row=index.bySlug.get(summary.slug);return row?[row]:[];});
    return targets.slice(0,limit).map((row)=>{
      const summary=index.summarize(row);
      return {
        slug:row.slug,title:row.title,kind:row.kind,area:row.parent_slug,
        standing:conceptStandingOf(summary),
        challenges:summary.challengeCount,passed:summary.passedCount,failed:summary.failedCount,abandoned:summary.abandonedCount,open:summary.openCount,
        replacedUnderThisConcept:summary.replacedCount,
        testRuns:summary.testRunCount,lastSeenAt:summary.lastSeenAt,
        subConcepts:index.childrenOf(row.slug).map((child)=>index.summarize(child)).filter((child)=>child.challengeCount>0).map((child)=>({slug:child.slug,title:child.title,standing:conceptStandingOf(child),passed:child.passedCount,failed:child.failedCount,abandoned:child.abandonedCount,open:child.openCount,testRuns:child.testRunCount,lastSeenAt:child.lastSeenAt})),
        recentChallenges:index.evidence(row).slice(0,6).map((item)=>({questionId:item.challengeId,title:item.title,difficulty:item.difficulty,outcome:item.outcome,testRuns:item.testRunCount,role:item.role,occurredAt:item.occurredAt})),
        abilities:index.abilitiesFor(row).map((ability)=>({id:ability.id,title:ability.title,status:ability.status})),
      };
    });
  }

  /** Every challenge tagged with a concept or one of its sub-concepts. */
  conceptChallenges(slug:string,limit=40):ConceptEvidence[]{
    const index=this.conceptIndex();
    const row=index.bySlug.get(conceptSlug(slug));
    return row?index.evidence(row).slice(0,limit):[];
  }

  /**
   * One pass over the tagged history, shared by every concept read. Rollups are
   * done here rather than in SQL because a sub-concept's evidence has to count
   * for its area *without* being double-counted when a challenge is tagged with
   * both — which is a de-duplication, not an aggregate.
   */
  private conceptIndex(){
    const rows=this.db.prepare("SELECT id,slug,title,kind,parent_slug,description FROM concepts ORDER BY title").all() as ConceptRow[];
    const bySlug=new Map(rows.map((row)=>[row.slug,row]));
    const children=new Map<string,ConceptRow[]>();
    for(const row of rows)if(row.parent_slug)children.set(row.parent_slug,[...(children.get(row.parent_slug)??[]),row]);
    const tagged=this.db.prepare(`SELECT qc.concept_id,qc.role,ch.id question_id,ch.session_id,s.title session_title,ch.title,ch.language,ch.difficulty,ch.outcome,ch.attempt_count,ch.test_run_count,ch.created_at,ch.updated_at occurred_at,(SELECT COUNT(*) FROM questions child WHERE child.replaces_question_id=ch.id) replaced FROM question_concepts qc JOIN (${CHALLENGE_OUTCOME_SQL}) ch ON ch.id=qc.question_id JOIN sessions s ON s.id=ch.session_id`).all() as TaggedChallengeRow[];
    const byConcept=new Map<string,TaggedChallengeRow[]>();
    for(const row of tagged)byConcept.set(row.concept_id,[...(byConcept.get(row.concept_id)??[]),row]);
    const abilityRows=this.db.prepare("SELECT ac.concept_id,a.id,a.title,a.status FROM ability_concepts ac JOIN ability_documents a ON a.id=ac.ability_id").all() as Array<{concept_id:string;id:string;title:string;status:string}>;
    const abilitiesByConcept=new Map<string,typeof abilityRows>();
    for(const row of abilityRows)abilitiesByConcept.set(row.concept_id,[...(abilitiesByConcept.get(row.concept_id)??[]),row]);
    const childrenOf=(slug:string)=>children.get(slug)??[];
    const family=(row:ConceptRow)=>[row,...childrenOf(row.slug)];
    const evidenceRows=(row:ConceptRow)=>{
      const seen=new Map<string,TaggedChallengeRow>();
      for(const member of family(row))for(const item of byConcept.get(member.id)??[]){
        const prior=seen.get(item.question_id);
        // The strongest role wins: a challenge aimed at a sub-concept is aimed at
        // its area too, and recording it as merely supporting would understate it.
        if(!prior||(prior.role!=="primary"&&item.role==="primary"))seen.set(item.question_id,item);
      }
      return [...seen.values()].sort((left,right)=>right.occurred_at.localeCompare(left.occurred_at));
    };
    const summarize=(row:ConceptRow):ConceptSummary=>{
      const items=evidenceRows(row);
      const count=(outcome:string)=>items.filter((item)=>item.outcome===outcome).length;
      const abilities=new Set(family(row).flatMap((member)=>(abilitiesByConcept.get(member.id)??[]).map((ability)=>ability.id)));
      const dates=items.map((item)=>item.occurred_at).sort();
      return {
        id:row.id,slug:row.slug,title:row.title,kind:row.kind as ConceptKind,description:row.description,
        parentSlug:row.parent_slug,parentTitle:row.parent_slug?bySlug.get(row.parent_slug)?.title??null:null,
        childSlugs:childrenOf(row.slug).map((child)=>child.slug),
        challengeCount:items.length,passedCount:count("passed"),failedCount:count("failed"),abandonedCount:count("abandoned"),
        openCount:count("open"),
        attemptCount:items.reduce((total,item)=>total+item.attempt_count,0),
        testRunCount:items.reduce((total,item)=>total+item.test_run_count,0),
        replacedCount:items.filter((item)=>item.replaced>0||item.outcome==="replaced").length,
        abilityCount:abilities.size,
        firstSeenAt:dates[0]??null,lastSeenAt:dates.at(-1)??null,
      };
    };
    return {
      rows,bySlug,childrenOf,summarize,
      evidence:(row:ConceptRow):ConceptEvidence[]=>evidenceRows(row).map((item)=>({challengeId:item.question_id,sessionId:item.session_id,sessionTitle:item.session_title,title:item.title,language:item.language,difficulty:item.difficulty,role:item.role as ConceptRole,outcome:item.outcome,testRunCount:item.test_run_count,occurredAt:item.occurred_at})),
      abilitiesFor:(row:ConceptRow)=>{const seen=new Map<string,{id:string;title:string;status:string}>();for(const member of family(row))for(const ability of abilitiesByConcept.get(member.id)??[])seen.set(ability.id,ability);return [...seen.values()];},
    };
  }

  /** Tags for a set of rows, keyed by the joined id. One query for a whole list. */
  private conceptTagRows(where:string,params:unknown[]){
    const rows=this.db.prepare(`SELECT qc.question_id key,c.slug,c.title,c.kind,c.parent_slug,p.title parent_title,qc.role FROM question_concepts qc JOIN concepts c ON c.id=qc.concept_id LEFT JOIN concepts p ON p.slug=c.parent_slug ${where}`).all(...params as []) as Array<{key:string;slug:string;title:string;kind:string;parent_slug:string|null;parent_title:string|null;role:string}>;
    const grouped=new Map<string,ConceptTag[]>();
    for(const row of rows){
      const tag:ConceptTag={slug:row.slug,title:row.title,kind:row.kind as ConceptKind,parentSlug:row.parent_slug,parentTitle:row.parent_title,role:row.role==="supporting"?"supporting":"primary"};
      grouped.set(row.key,[...(grouped.get(row.key)??[]),tag]);
    }
    for(const [key,tags] of grouped)grouped.set(key,tags.sort((left,right)=>Number(right.role==="primary")-Number(left.role==="primary")||left.title.localeCompare(right.title)));
    return grouped;
  }

  latestCheckpoint(sessionId:string):SessionCheckpoint|null{const row=this.db.prepare("SELECT payload FROM checkpoints WHERE session_id=? ORDER BY version DESC LIMIT 1").get(sessionId) as {payload:string}|undefined;return row?JSON.parse(row.payload) as SessionCheckpoint:null;}
  saveCheckpoint(value:SessionCheckpoint){this.db.transaction(()=>{this.db.prepare("INSERT OR IGNORE INTO checkpoints VALUES (?,?,?,?,?,?)").run(value.id,value.sessionId,value.version,value.eventSequence,JSON.stringify(value),value.savedAt);this.db.prepare("UPDATE sessions SET updated_at=? WHERE id=?").run(value.savedAt,value.sessionId);this.enqueue("checkpoint",value);})();}
  appendEvent(event:AttemptEvent){this.db.transaction(()=>{const attempt=this.db.prepare("SELECT latest_event_sequence FROM attempts WHERE id=?").get(event.attemptId) as {latest_event_sequence:number}|undefined;if(!attempt)throw new Error("Attempt not found");if(event.sequence!==attempt.latest_event_sequence+1)throw new Error(`Attempt event sequence conflict: expected ${attempt.latest_event_sequence+1}, received ${event.sequence}`);this.insertEvent(event);this.db.prepare("UPDATE attempts SET latest_event_sequence=? WHERE id=?").run(event.sequence,event.attemptId);this.enqueue("attempt-event",event);})();}
  appendNextEvent(input:Omit<AttemptEvent,"sequence">):AttemptEvent{return this.db.transaction(()=>{const attempt=this.db.prepare("SELECT latest_event_sequence FROM attempts WHERE id=?").get(input.attemptId) as {latest_event_sequence:number}|undefined;if(!attempt)throw new Error("Attempt not found");const event={...input,sequence:attempt.latest_event_sequence+1};this.insertEvent(event);this.db.prepare("UPDATE attempts SET latest_event_sequence=? WHERE id=?").run(event.sequence,event.attemptId);this.enqueue("attempt-event",event);return event;})();}
  /** The onboarding answers. One row, keyed on a constant: a device holds one
   *  signed-in learner, and the row is dropped with the rest of the account's
   *  state on sign-out so the next person is asked for themselves. */
  getProfile():LearnerProfile|null{const row=this.db.prepare("SELECT payload FROM learner_profile WHERE id='self'").get() as {payload:string}|undefined;if(!row)return null;const parsed=learnerProfileSchema.safeParse(JSON.parse(row.payload));return parsed.success?parsed.data:null;}
  /* Pushed as well as written. The profile is the answer to "has this account
     ever been onboarded", and holding that answer only on the device is what
     sent an onboarded learner back through intake after every sign-out and on
     every new machine. */
  saveProfile(value:LearnerProfile){this.db.prepare("INSERT INTO learner_profile VALUES ('self',?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").run(JSON.stringify(value),new Date().toISOString());this.enqueue("profile-save",value);}
  /** The training language on its own: Settings changes it without reopening onboarding. */
  setPreferredLanguage(language:Language){const current=this.getProfile();if(!current)return;this.saveProfile({...current,language});}
  getSetting<T>(key:string,fallback:T):T{const row=this.db.prepare("SELECT value FROM settings WHERE key=?").get(key) as {value:string}|undefined;return row?JSON.parse(row.value) as T:fallback;}
  setSetting(key:string,value:unknown){this.db.prepare("INSERT INTO settings VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(key,JSON.stringify(value),new Date().toISOString());}
  pendingSync(limit=100){return this.db.prepare("SELECT id,kind,payload,attempts FROM sync_outbox ORDER BY created_at LIMIT ?").all(limit) as Array<{id:string;kind:string;payload:string;attempts:number}>;}
  acknowledgeSync(ids:string[]){const remove=this.db.prepare("DELETE FROM sync_outbox WHERE id=?");this.db.transaction(()=>ids.forEach(id=>remove.run(id)))();}
  markSyncFailed(id:string){this.db.prepare("UPDATE sync_outbox SET attempts=attempts+1 WHERE id=?").run(id);}
  /* ---- Restore ------------------------------------------------------------
     The pull half of sync. Everything here writes rows the cloud already has, so
     it differs from every other insert path in this class in two ways that
     matter: ids arrive in the payload instead of being generated, and nothing
     enqueues — `restoring` sees to the second, and without it a fresh device
     would spend its first minutes uploading the account back to itself.

     `INSERT OR IGNORE` throughout, so a restore interrupted halfway is resumed
     by running it again. Where a row could legitimately differ, local wins: the
     device is where the learner has been working, and a cloud copy is at best as
     fresh as the last flush. */
  private inRestore<T>(work:()=>T):T{this.restoring=true;try{return this.db.transaction(work)();}finally{this.restoring=false;}}

  /** True when this device already holds this session at or beyond the cloud's
   *  version of it, and the bundle can be skipped without fetching it. */
  sessionIsCurrent(sessionId:string,updatedAt:string){const row=this.db.prepare("SELECT updated_at FROM sessions WHERE id=?").get(sessionId) as {updated_at:string}|undefined;return row?Date.parse(row.updated_at)>=Date.parse(updatedAt):false;}

  /** The account-wide half: who the learner is, the vocabulary the agent invented
   *  for them, and their abilities. Written before any session, because a
   *  session's targets and tags point at all three. */
  restoreAccount(input:RestoredAccount){
    return this.inRestore(()=>{
      for(const concept of input.concepts)
        /* Ensured by slug rather than inserted by id: concept ids are per-install
           and the slug is the identity on both sides, so a concept this device
           already seeded is matched rather than duplicated. */
        try{this.ensureConcept({slug:concept.slug,title:concept.title,kind:concept.kind as ConceptKind,parentSlug:concept.parentSlug,description:concept.description});}catch{/* A slug this build no longer understands is skipped rather than fatal. */}
      const insertAbility=this.db.prepare("INSERT OR IGNORE INTO ability_documents (id,title,markdown,version,status,updated_at,evidence_ids,summary,practice,earned_at) VALUES (?,?,?,?,?,?,?,?,?,?)");
      const linkConcept=this.db.prepare("INSERT OR IGNORE INTO ability_concepts (ability_id,concept_id) VALUES (?,?)");
      for(const ability of input.abilities){
        insertAbility.run(ability.id,ability.title,ability.markdown,ability.version,ability.status,ability.updatedAt,JSON.stringify(ability.evidenceEventIds??[]),ability.summary,JSON.stringify(ability.practice),ability.earnedAt);
        for(const slug of ability.conceptSlugs)
          try{linkConcept.run(ability.id,this.ensureConcept({slug}).id);}catch{/* as above */}
      }
      /* Last, and only when the device has none: a profile edited offline is the
         newer statement of who the learner is, and the flush will carry it up. */
      if(input.profile&&!this.getProfile())this.db.prepare("INSERT OR IGNORE INTO learner_profile VALUES ('self',?,?)").run(JSON.stringify(input.profile),new Date().toISOString());
    });
  }

  /** One batch of sessions, each with its targets, challenges, attempts, events,
   *  transcript and latest checkpoint. Insert order is forced by the foreign keys
   *  declared at the top of this class. */
  restoreSessions(bundles:RestoredSession[]){
    return this.inRestore(()=>{
      const insertSession=this.db.prepare("INSERT OR IGNORE INTO sessions (id,title,original_goal,objective,status,current_focus,questions,total_seconds,created_at,updated_at,pinned_at,archived_at) VALUES (?,?,?,?,?,?,'[]',?,?,?,?,?)");
      const insertTarget=this.db.prepare("INSERT OR IGNORE INTO training_targets (id,session_id,ability_id,ability_title,specific_gap,desired_evidence,avoid_testing,action,created_at) VALUES (?,?,?,?,?,?,?,?,?)");
      const insertQuestion=this.db.prepare("INSERT OR IGNORE INTO questions (id,session_id,training_target_id,ordinal,title,statement,language,kind,status,difficulty,design,validation_report,created_at,replaces_question_id,source_ref) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
      const insertAttempt=this.db.prepare("INSERT OR IGNORE INTO attempts (id,question_id,session_id,status,latest_event_sequence,started_at,completed_at) VALUES (?,?,?,?,?,?,?)");
      const insertEvent=this.db.prepare("INSERT OR IGNORE INTO attempt_events VALUES (?,?,?,?,?,?,?,?)");
      const insertMessage=this.db.prepare("INSERT OR IGNORE INTO agent_messages (id,session_id,role,body,created_at,activity) VALUES (?,?,?,?,?,?)");
      const insertCheckpoint=this.db.prepare("INSERT OR IGNORE INTO checkpoints VALUES (?,?,?,?,?,?)");
      const tagQuestion=this.db.prepare("INSERT OR IGNORE INTO question_concepts (question_id,concept_id,role) VALUES (?,?,?)");
      const abilityTitle=this.db.prepare("SELECT title FROM ability_documents WHERE id=?");
      for(const bundle of bundles){
        const session=bundle.session;
        insertSession.run(session.id,session.title,session.originalGoal,session.objective,session.status,JSON.stringify(session.currentFocus??[]),session.totalSeconds??0,iso(session.createdAt),iso(session.updatedAt),session.pinnedAt?iso(session.pinnedAt):null,session.archivedAt?iso(session.archivedAt):null);
        for(const target of bundle.targets){
          /* The cloud's target names an ability document; the device's names the
             ability's title too, because that is what the sidebar and the target
             card read. Resolved from the abilities restored a moment ago. */
          const title=(target.abilityDocumentId?(abilityTitle.get(target.abilityDocumentId) as {title:string}|undefined)?.title:undefined)??target.specificGap.slice(0,80)??"Observed ability";
          insertTarget.run(target.id,session.id,target.abilityDocumentId??randomUUID(),title,target.specificGap,target.desiredEvidence,JSON.stringify(target.avoidTesting??[]),target.action,iso(target.createdAt));
        }
        for(const question of bundle.questions){
          insertQuestion.run(question.id,session.id,question.trainingTargetId,question.ordinal,question.title,question.statement,question.language,question.kind,question.status,question.difficulty,JSON.stringify(question.design??{}),JSON.stringify(question.report??{}),iso(question.createdAt),question.replacesQuestionId??null,question.sourceRef?JSON.stringify(question.sourceRef):null);
          for(const tag of question.concepts??[])
            try{tagQuestion.run(question.id,this.ensureConcept({slug:tag.slug}).id,tag.role==="supporting"?"supporting":"primary");}catch{/* as above */}
        }
        for(const attempt of bundle.attempts){
          insertAttempt.run(attempt.id,attempt.questionId,session.id,attempt.status,attempt.latestEventSequence,iso(attempt.startedAt),attempt.completedAt?iso(attempt.completedAt):null);
          for(const event of attempt.events)insertEvent.run(event.id,attempt.id,event.sequence,event.type,iso(event.occurredAt),JSON.stringify(event.payload),event.source,event.schemaVersion??1);
        }
        for(const message of bundle.messages)insertMessage.run(message.id,session.id,message.role,message.body,iso(message.createdAt),JSON.stringify(message.activity??[]));
        /* Reconciled rather than inserted blindly: a device that has been working
           offline may hold a later checkpoint than the cloud, and the shared
           chooser is the one place that decides which of two wins. */
        const remote=sessionCheckpointSchema.safeParse(bundle.checkpoint);
        if(remote.success){
          const chosen=chooseCheckpoint(this.latestCheckpoint(session.id),remote.data);
          if(chosen===remote.data)insertCheckpoint.run(remote.data.id,session.id,remote.data.version,remote.data.eventSequence,JSON.stringify(remote.data),remote.data.savedAt);
        }
      }
    });
  }

  /** Account-scoped learner state must not survive a permanent account deletion. Preferences stay device-scoped. */
  /* The cached problems go too. Their statements are public, but the copy Spar
     holds records whether *this* learner has solved each one, which is theirs. */
  clearAccountData(){this.db.transaction(()=>{for(const table of ["sync_outbox","question_concepts","ability_concepts","attempt_events","checkpoints","agent_messages","session_decisions","session_intake","attempts","questions","training_targets","sessions","ability_documents","learner_profile","practice_problems","practice_problem_links"])this.db.prepare(`DELETE FROM ${table}`).run();
    /* Seeded concepts are shipped vocabulary and stay. A concept the agent
       invented is not: it names something this learner was working on, and
       serving it to whoever signs in next would leak that. */
    this.db.prepare("DELETE FROM concepts WHERE seeded=0").run();})();}
  close(){this.db.close();}
  private insertEvent(event:AttemptEvent){this.db.prepare("INSERT INTO attempt_events VALUES (?,?,?,?,?,?,?,?)").run(event.id,event.attemptId,event.sequence,event.type,event.occurredAt,JSON.stringify(event.payload),event.source,event.schemaVersion);}
  private ensureColumn(table:string,column:string,declaration:string){const columns=this.db.pragma(`table_info(${table})`) as Array<{name:string}>;if(!columns.some((item)=>item.name===column))this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);}
  /* Writes made while restoring are not news. Every insert path in this class
     enqueues, which is right when the learner is the one causing it and wrong
     when the cloud is: without this guard a restore would push every row it had
     just pulled straight back, and a fresh device would spend its first minutes
     uploading the account to itself. */
  private restoring=false;
  private enqueue(kind:string,payload:unknown){if(this.restoring)return;this.db.prepare("INSERT INTO sync_outbox (id,kind,payload,created_at) VALUES (?,?,?,?)").run(randomUUID(),kind,JSON.stringify(payload),new Date().toISOString());}
  private toSession(row:SessionRow):SessionSummary{const questions=this.db.prepare("SELECT id,title,status FROM questions WHERE session_id=? ORDER BY ordinal").all(row.id) as Array<{id:string;title:string;status:SessionSummary["questionTitles"][number]["status"]}>;const active=questions.find(q=>q.status==="active");const focus=(this.db.prepare("SELECT ability_title FROM training_targets WHERE session_id=? ORDER BY created_at DESC LIMIT 3").all(row.id) as Array<{ability_title:string}>).map(v=>v.ability_title);return{id:row.id,title:row.title,originalGoal:row.original_goal,objective:row.objective,status:row.status,currentFocus:focus,completedQuestions:questions.filter(q=>q.status==="completed").length,activeQuestion:active?{id:active.id,title:active.title,ordinal:questions.indexOf(active)+1}:null,questionTitles:questions,totalSeconds:row.total_seconds,updatedAt:row.updated_at,pinnedAt:row.pinned_at,archivedAt:row.archived_at};}
}

/** A concept kind the agent named, or the safest default. "engineering" is that
 *  default rather than "dsa": an untagged concept is more often something about
 *  building software than an algorithm, and a wrong kind only mis-tints a chip. */
function conceptKind(value:unknown):ConceptKind{return value==="dsa"||value==="craft"||value==="engineering"?value:"engineering";}
/** The band, said in one word, from counts the caller already has. */
function conceptStandingOf(summary:ConceptSummary){return CONCEPT_STANDING_LABEL[conceptStanding(conceptStrength(summary))].toLowerCase();}
/** Evidence count to confidence. One graded attempt is a signal, three is a
 *  pattern; the ledger says "independent" only once it has the latter. */
function abilityStatusFor(evidenceCount:number):AbilityStatus{return evidenceCount===0?"uncertain":evidenceCount<3?"developing":"independent";}
type AbilityRow={id:string;title:string;markdown:string;version:number;status:AbilityStatus;updated_at:string;evidence_ids:string;summary:string;practice:string;earned_at:string|null};

const SEARCH_STOP_WORDS=new Set(["a","an","and","day","days","for","from","have","i","in","interview","learn","me","my","of","on","prepare","the","to","want","with"]);
const EVIDENCE_STOP_WORDS=new Set([
  ...SEARCH_STOP_WORDS,
  "advanced","algorithm","algorithms","beginner","c#","c++","code","coding","comfortable","cpp","data","dsa","go","java","javascript","js","know","language","not","practice","practise","prerequisite","prerequisites","problem","problems","programming","python","rust","scratch","sure","teach","typescript","understand","understanding","whether","yet",
]);
function tokens(value:string){return value.toLowerCase().replace(/[^a-z0-9+#-]+/g," ").split(/\s+/).filter(Boolean);}
function searchTerms(query:string){return [...new Set(tokens(query).filter(term=>!SEARCH_STOP_WORDS.has(term)&&(term.length>2||["ai","js","c#","c++"].includes(term))))].slice(0,12);}
function relevance(text:string,terms:string[]){const haystack=new Set(tokens(text));return terms.reduce((score,term)=>score+(haystack.has(term)?1:0),0);}
function normalizedEvidenceTokens(value:string){return value.toLowerCase().replace(/[^a-z0-9+#]+/g," ").split(/\s+/).filter(Boolean).map((term)=>term.length>4&&term.endsWith("s")?term.slice(0,-1):term);}
function evidenceTerms(query:string){return [...new Set(normalizedEvidenceTokens(query).filter((term)=>!EVIDENCE_STOP_WORDS.has(term)&&(term.length>2||term==="ai")))].slice(0,12);}
function evidenceRelevance(text:string,terms:string[]){const haystack=new Set(normalizedEvidenceTokens(text));return terms.reduce((score,term)=>score+(haystack.has(term)?1:0),0);}
function parseStringArray(value:string){try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed.filter((item):item is string=>typeof item==="string"):[];}catch{return[];}}
/** A `training_targets` row as the domain shape. Exported because a checkpoint
 *  carries the session's target and is composed outside this file. */
export function normalizeTarget(row:Record<string,unknown>){return{id:String(row.id),sessionId:String(row.session_id),abilityId:String(row.ability_id),abilityTitle:String(row.ability_title),specificGap:String(row.specific_gap),desiredEvidence:String(row.desired_evidence),avoidTesting:JSON.parse(String(row.avoid_testing)) as string[],action:String(row.action),createdAt:String(row.created_at)};}
function legacyQuestionRequest(question:string):AskUserQuestionRequest{return{id:randomUUID(),questions:[{header:"Placement",question,options:[{label:"New to this — start me from the prerequisites"},{label:"Some experience — calibrate with an applied question"},{label:"Comfortable — go straight to an interview-style diagnostic"}],multiple:false,custom:true}]};}
/** A challenge's source, read back defensively. Null is the ordinary answer —
 *  every challenge Spar wrote itself has none — and a row written by a build that
 *  stored a shape this one no longer understands reads as "Spar wrote it" rather
 *  than taking the challenge down with it. */
function parseSourceRef(value:string|null|undefined):ChallengeSource|null{
  if(!value)return null;
  try{const parsed=challengeSourceSchema.safeParse(JSON.parse(value));return parsed.success?parsed.data:null;}catch{return null;}
}
/** A timestamp from the wire as the ISO string every local column stores. The
 *  API answers with ISO already; this exists because a restore that writes
 *  "Invalid Date" into `updated_at` silently reorders the learner's whole
 *  sidebar, and falling back to now is a visible wrongness rather than a
 *  poisoned sort key. */
function iso(value:string|Date|null|undefined):string{
  if(!value)return new Date().toISOString();
  const date=value instanceof Date?value:new Date(value);
  return Number.isNaN(date.getTime())?new Date().toISOString():date.toISOString();
}

/** Stored activity, read back defensively: a message written before this column
 *  existed has none, and a malformed row must not take the transcript with it. */
function parseActivity(value:string|null):AgentActivityStep[]{if(!value)return[];try{const parsed=JSON.parse(value) as unknown;if(!Array.isArray(parsed))return[];return parsed.flatMap((entry)=>{const step=agentActivityStepSchema.safeParse(entry);return step.success?[step.data]:[];});}catch{return[];}}
