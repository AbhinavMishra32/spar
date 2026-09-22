import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { ChallengeCodePreview } from "@spar/domain";
import { challengeFileEntries, codePreview } from "./challengeFiles.js";
import { foldSubmissions, submissionSummary, type SubmissionContext, type SubmissionRecord, type SubmissionRow } from "../shared/submissions.js";
import { decay as decayRating, updateRating, ESTABLISHED_DEVIATION, INITIAL_DEVIATION, INITIAL_RATING, INITIAL_VOLATILITY, type Rating } from "@spar/domain";
import { challengeResult, elapsedDays } from "./rating.js";
import { askUserQuestionRequestSchema, baselineStateSchema, languageSchema, challengeSourceSchema, chooseCheckpoint, conceptSlug, conceptStanding, conceptStrength, conceptTitleFromSlug, learnerProfileSchema, seededConcept, savedProblemSchema, sessionCheckpointSchema, trainingModeSchema, CONCEPT_STANDING_LABEL, CONCEPT_TAXONOMY, agentActivityStepSchema, type AbilityDetail, type AbilityHistorySummary, type AbilityStatus, type AgentActivityStep, type AskUserQuestionInput, type AskUserQuestionRequest, type AttemptEvent, type BaselineState, type ChallengeHistorySummary, type ChallengeSource, type ConceptDetail, type ConceptEvidence, type ConceptKind, type ConceptRole, type ConceptSummary, type ConceptTag, type Language, type LearnerAbilityState, type LearnerEvidence, type LearnerPattern, type LearnerProfile, type LearnerProgress, type QuestionDesign, type RatingPoint, type SavedProblem, type SessionCheckpoint, type SessionDetail, type SessionSummary, type SparNotice, type TodayRecommendation, type Track, type TrainingMode, type TrainingTarget } from "@spar/domain";

type SessionRow = { id:string; track_id:string|null; context:"training"|"baseline"; title:string; original_goal:string; objective:string; status:SessionSummary["status"]; total_seconds:number; updated_at:string; pinned_at:string|null; archived_at:string|null };
const SESSION_COLUMNS="id,track_id,context,title,original_goal,objective,status,total_seconds,updated_at,pinned_at,archived_at";
type QuestionRow = { id:string; session_id:string; training_target_id:string; ordinal:number; title:string; statement:string; language:Language; kind:"function"|"module"|"repair"|"extension"|"repository"; status:"generating"|"validating"|"playable"|"active"|"completed"|"invalid"|"abandoned"; difficulty:"foundation"|"developing"|"proficient"|"advanced"; design:string; validation_report:string; replaces_question_id:string|null; source_ref:string|null; created_at:string };
type ConceptRow = { id:string; slug:string; title:string; kind:string; parent_slug:string|null; description:string };
type TrackRow = { id:string;title:string;goal:string;status:Track["status"];language:string|null;emphasis:string;priorities:string;investigating:string;monitoring:string;created_at:string;updated_at:string };
type EvidenceInterpretation={eventId:string;statement:string;polarity:LearnerEvidence["polarity"];independence:LearnerEvidence["independence"];strength:number};
type PatternInterpretation={title:string;description:string;status:LearnerPattern["status"];evidenceEventIds:string[]};

/**
 * The number of private cases a validated challenge actually runs.
 *
 * A hidden test file is commonly a generated sweep containing dozens of cases,
 * so counting files produces the misleading `1` the result grid used to show.
 * New reports carry structured counts. The check-detail fallback keeps existing
 * challenges correct without rewriting their persisted validation reports.
 */
export function validatedHiddenCaseCount(value: unknown): number {
  let report: unknown = value;
  if (typeof value === "string") {
    try { report = JSON.parse(value); } catch { return 0; }
  }
  if (!report || typeof report !== "object") return 0;
  const record = report as { caseCounts?: unknown; checks?: unknown };
  if (record.caseCounts && typeof record.caseCounts === "object") {
    const hidden = (record.caseCounts as { hidden?: unknown }).hidden;
    if (Number.isInteger(hidden) && (hidden as number) >= 0) return hidden as number;
  }
  const checks = record.checks;
  if (!Array.isArray(checks)) return 0;
  const detail = (name: string) => {
    const check = checks.find((item: unknown) => item && typeof item === "object" && (item as { name?: unknown }).name === name);
    return check && typeof check === "object" ? String((check as { detail?: unknown }).detail ?? "") : "";
  };
  const total = Number(/(?:^Only\s+)?(\d+)\s+cases\s+(?:executed|ran)/i.exec(detail("case volume"))?.[1]);
  const visible = Number(/(?:^Only\s+)?(\d+)\s+(?:named\s+)?visible\s+cases/i.exec(detail("curated visible cases"))?.[1]);
  return Number.isInteger(total) && Number.isInteger(visible) ? Math.max(0, total - visible) : 0;
}

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

/** How long an earned ability stands without new evidence before it is only a
 *  claim about the past. Long enough that a fortnight away from Spar does not
 *  unpick the ledger, short enough that "you can do this" still means now. */
export const ABILITY_STALE_AFTER_DAYS = 45;

/** How long a piece of evidence keeps its full weight. The same span, so that
 *  at the moment an ability is called stale its evidence counts for half — the
 *  two halves of "this was true a while ago" moving together rather than one
 *  number contradicting the other. */
export const ABILITY_EVIDENCE_HALF_LIFE_DAYS = ABILITY_STALE_AFTER_DAYS;

/** Below this, the evidence is not backing the claim the document makes. Used
 *  only to notice the disagreement, never to overrule it. */
const ABILITY_DIVERGENCE_FLOOR = 0.6;

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
    (SELECT COUNT(*) FROM attempt_events te JOIN attempts ta ON ta.id=te.attempt_id WHERE ta.question_id=q.id AND te.type='test_run' AND te.sequence>=(SELECT MAX(start.sequence) FROM attempt_events start WHERE start.attempt_id=te.attempt_id AND start.type='attempt_started')) test_run_count,
    COALESCE((SELECT json_extract(te.payload,'$.outcome') FROM attempt_events te JOIN attempts ta ON ta.id=te.attempt_id WHERE ta.question_id=q.id AND te.type='attempt_completed' AND te.sequence>=(SELECT MAX(start.sequence) FROM attempt_events start WHERE start.attempt_id=te.attempt_id AND start.type='attempt_started') ORDER BY te.occurred_at DESC LIMIT 1),'open') outcome
  FROM questions q LEFT JOIN attempts a ON a.question_id=q.id GROUP BY q.id
`;

export class LocalStore {
  private readonly db: Database.Database;
  /** The last timestamp `stamp()` handed out. See it for why this exists. */
  private lastStamp = "";
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
      /* These are the access paths behind every shell refresh. Without them the
         challenge/concept summaries run correlated full scans of attempt history
         and opening a thread eventually beach-balls as the learner's record
         grows. They are migrations as well as schema: IF NOT EXISTS adds them to
         existing local stores without rewriting or discarding any history. */
      CREATE INDEX IF NOT EXISTS attempts_question_idx ON attempts(question_id);
      CREATE INDEX IF NOT EXISTS attempt_events_attempt_type_sequence_idx ON attempt_events(attempt_id, type, sequence);
      CREATE INDEX IF NOT EXISTS sync_outbox_created_idx ON sync_outbox(created_at);
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
      /* A Track is a workspace boundary. Sessions, ability memory, notices and
         rating all resolve through it; account/profile preferences remain global. */
      CREATE TABLE IF NOT EXISTS tracks (id TEXT PRIMARY KEY, title TEXT NOT NULL, goal TEXT NOT NULL, status TEXT NOT NULL, emphasis TEXT NOT NULL DEFAULT '[]', priorities TEXT NOT NULL DEFAULT '[]', investigating TEXT NOT NULL DEFAULT '[]', monitoring TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS learner_ability_state (ability_id TEXT PRIMARY KEY REFERENCES ability_documents(id) ON DELETE CASCADE, proficiency REAL NOT NULL, confidence REAL NOT NULL, evidence_count INTEGER NOT NULL, last_evidence_at TEXT, training_status TEXT NOT NULL, trend TEXT NOT NULL, current_belief TEXT NOT NULL, next_verification TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS learner_evidence (id TEXT PRIMARY KEY, ability_id TEXT NOT NULL REFERENCES ability_documents(id) ON DELETE CASCADE, attempt_id TEXT, event_id TEXT, statement TEXT NOT NULL, polarity TEXT NOT NULL, independence TEXT NOT NULL, strength REAL NOT NULL, occurred_at TEXT NOT NULL, UNIQUE(ability_id,event_id));
      CREATE TABLE IF NOT EXISTS learner_patterns (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, ability_id TEXT REFERENCES ability_documents(id) ON DELETE SET NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_observed_at TEXT);
      CREATE TABLE IF NOT EXISTS pattern_evidence (pattern_id TEXT NOT NULL REFERENCES learner_patterns(id) ON DELETE CASCADE, evidence_id TEXT NOT NULL REFERENCES learner_evidence(id) ON DELETE CASCADE, PRIMARY KEY(pattern_id,evidence_id));
      CREATE TABLE IF NOT EXISTS learner_notices (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, dismissed_at TEXT);
      CREATE TABLE IF NOT EXISTS rating_points (id TEXT PRIMARY KEY, rating INTEGER NOT NULL, provisional INTEGER NOT NULL, reason TEXT NOT NULL, occurred_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS training_decisions (id TEXT PRIMARY KEY, track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE, session_id TEXT, ability_id TEXT, intent TEXT NOT NULL, reason TEXT NOT NULL, mode TEXT NOT NULL, candidate_snapshot TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL);
      /* A picture the agent built into an explanation, kept because the
         explanation outlives the turn. The transcript stores only this row's id,
         so a message from three weeks ago still draws its own diagram instead of
         degrading into a sentence about a picture that used to be there. The
         payload is a slice of a trace, not the trace. */
      CREATE TABLE IF NOT EXISTS agent_visualizations (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, title TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
      /* What Spar taught, kept past the turn that taught it.
         A lesson is addressable so a later turn can point at it — "this is the
         aliasing I showed you" — and durable so the pointer still resolves in a
         session weeks later. Sessions are the scope it was written in, not the
         scope it is readable in: the row survives its session being read back
         and is only removed with the track. */
      CREATE TABLE IF NOT EXISTS lessons (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS lessons_session ON lessons (session_id);
      CREATE TABLE IF NOT EXISTS lesson_concepts (lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE, concept_id TEXT NOT NULL REFERENCES concepts(id), PRIMARY KEY (lesson_id, concept_id));
      /* Problems the learner put aside, filed by the same key both populations
         dedupe on. The snapshot is empty for a challenge Spar wrote — that row
         is already in the questions table and a copy here could only disagree
         with it — and holds what a source problem needs to draw itself, because
         a saved search hit has nowhere else on the device to be read from.

         Written without backticks on purpose: this comment lives inside the
         schema's own template literal, and a backtick here ends the string. */
      CREATE TABLE IF NOT EXISTS saved_problems (key TEXT PRIMARY KEY, snapshot TEXT NOT NULL DEFAULT '', saved_at TEXT NOT NULL);
    `);
    this.ensureColumn("questions", "replaces_question_id", "TEXT");
    /* Indexed here rather than up in the schema block, because the column it
       indexes is added by the line above it. On a store that already had the
       column — every developer's own, which is why this survived review — the
       index built fine from the schema block; on a fresh database it was an
       index over a column that did not exist yet, and the whole constructor
       threw. A migrated column's index belongs with its migration. */
    this.db.exec("CREATE INDEX IF NOT EXISTS questions_replaces_idx ON questions(replaces_question_id);");
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
    this.ensureColumn("ability_documents", "track_id", "TEXT");
    this.ensureColumn("tracks", "language", "TEXT");
    this.ensureColumn("learner_notices", "track_id", "TEXT");
    this.ensureColumn("rating_points", "track_id", "TEXT");
    /* Glicko-2's own state, on the point rather than beside it. A rating is not
       something you can resume from on its own: the deviation decides how far the
       next result moves it, and the volatility decides how fast the deviation
       itself may move. Points written before the rating was a rating carry the
       defaults, which say "this number's uncertainty was never measured" — which
       is true of every one of them. */
    this.ensureColumn("rating_points", "deviation", `REAL NOT NULL DEFAULT ${INITIAL_DEVIATION}`);
    this.ensureColumn("rating_points", "volatility", `REAL NOT NULL DEFAULT ${INITIAL_VOLATILITY}`);
    /* Which challenge moved it. Recorded so a challenge can only ever be rated
       once: a solve that the agent's review then reopened was rated on the pass,
       and rating the second pass too would pay the learner twice for one
       problem. It also makes the replay idempotent, which a migration that
       deletes and rebuilds the curve had better be. */
    this.ensureColumn("rating_points", "question_id", "TEXT");
    this.seedConcepts();
    // Filing, not activity: a timestamp rather than a flag so the sidebar can
    // order the shelf it produces without a second column to keep in step.
    /* A turn's tool steps, kept with the reply they produced. Without this the
       activity existed only in the live stream and every finished turn collapsed
       to its last sentence. */
    this.ensureColumn("agent_messages", "activity", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn("agent_messages", "worked_ms", "INTEGER NOT NULL DEFAULT 0");
    /* The learner's verdict on a reply. Nullable on purpose — "not rated" and
       "rated neither way" are the same thing here, and a default would make
       every reply written before this column existed look like it had been
       judged. */
    this.ensureColumn("agent_messages", "rating", "TEXT");
    this.ensureColumn("sessions", "pinned_at", "TEXT");
    this.ensureColumn("sessions", "archived_at", "TEXT");
    this.ensureColumn("sessions", "track_id", "TEXT");
    this.ensureColumn("sessions", "context", "TEXT NOT NULL DEFAULT 'training'");
    // Remove the exact prototype fixture; it was never learner data.
    this.db.prepare("DELETE FROM sessions WHERE title = ? AND original_goal = ? AND objective = ?").run("Deep JavaScript Runtime", "Understand JavaScript runtime behavior deeply", "Build reliable reasoning about reference ownership and asynchronous state.");
    // Earlier builds stored a pending question as plain text. Upgrade it once so
    // the suspension has a stable identity and does not reset the answer UI.
    const legacyIntakes=this.db.prepare("SELECT session_id,question FROM session_intake WHERE status='pending'").all() as Array<{session_id:string;question:string}>;
    const updateIntake=this.db.prepare("UPDATE session_intake SET question=? WHERE session_id=?");
    this.db.transaction(()=>{for(const row of legacyIntakes){try{askUserQuestionRequestSchema.parse(JSON.parse(row.question));}catch{updateIntake.run(JSON.stringify(legacyQuestionRequest(row.question)),row.session_id);}}})();
    this.normalizeLegacyBaseline();
    this.backfillTracks();
    this.migrateLegacyTrackWorkspaces();
    this.backfillLearningTracks();
    this.migrateAbilityProficiency();
    this.ensureRating();
    this.migrateRatingHistory();
  }

  /** Pinned first, then last touched. Archived rows stay in the list — they are
   *  filed away, not deleted, and their attempts still count toward progress. */
  listSessions(): SessionSummary[] { return (this.db.prepare(`SELECT ${SESSION_COLUMNS} FROM sessions ORDER BY (pinned_at IS NULL), updated_at DESC`).all() as SessionRow[]).map(row => this.toSession(row)); }
  createSession(goal: string, trackId?: string): { sessionId: string } { const sessionId=randomUUID();const now=new Date().toISOString();const title=goal.length>80?`${goal.slice(0,77)}...`:goal;const resolvedTrack=trackId??this.activeTrack()?.id??this.createTrackRecord(goal,title).id;this.db.prepare("INSERT INTO sessions (id,title,original_goal,objective,status,current_focus,questions,total_seconds,created_at,updated_at,track_id) VALUES (?,?,?,?,?,'[]','[]',0,?,?,?)").run(sessionId,title,goal,"Investigating your prior evidence and defining the first training target.","planning",now,now,resolvedTrack);this.setActiveTrack(resolvedTrack);this.enqueue("session-create",{sessionId,goal,title,trackId:resolvedTrack,createdAt:now});this.queueLearningState();return{sessionId}; }

  createBaselineSession(){const baseline=this.getBaseline();if(baseline.sessionId&&this.readSession(baseline.sessionId))return{sessionId:baseline.sessionId};const sessionId=randomUUID();const now=new Date().toISOString();const goal="Establish a direct adaptive programming baseline.";this.db.prepare("INSERT INTO sessions (id,title,original_goal,objective,status,current_focus,questions,total_seconds,created_at,updated_at,track_id,context) VALUES (?,?,?,?,?,'[]','[]',0,?,?,NULL,'baseline')").run(sessionId,"Baseline",goal,"Calibrate current problem-solving ability with the smallest useful sequence of direct coding probes.","planning",now,now);this.enqueue("session-create",{sessionId,goal,title:"Baseline",context:"baseline",createdAt:now});const importedEvidenceCount=Math.max(baseline.importedEvidenceCount,this.abilityStates().reduce((sum,item)=>sum+item.evidenceCount,0));this.setBaseline({status:"in-progress",sessionId,importedEvidenceCount});return{sessionId};}

  createTrack(goal:string,title?:string,language?:Language|null){const track=this.createTrackRecord(goal,title,language);const session=this.createSession(goal,track.id);return{track,sessionId:session.sessionId};}
  deleteTrack(trackId: string): boolean {
    return this.db.transaction(() => {
      if (!this.db.prepare("SELECT id FROM tracks WHERE id=?").get(trackId)) return false;
      const sessions = this.db.prepare("SELECT id FROM sessions WHERE track_id=?").all(trackId) as Array<{ id: string }>;
      for (const session of sessions) {
        this.db.prepare("DELETE FROM agent_visualizations WHERE session_id=?").run(session.id);
        this.db.prepare("DELETE FROM lesson_concepts WHERE lesson_id IN (SELECT id FROM lessons WHERE session_id=?)").run(session.id);
        this.db.prepare("DELETE FROM lessons WHERE session_id=?").run(session.id);
        this.deleteSession(session.id);
      }
      this.db.prepare("DELETE FROM learner_patterns WHERE ability_id IN (SELECT id FROM ability_documents WHERE track_id=?)").run(trackId);
      for (const table of ["ability_documents", "learner_notices", "rating_points"]) {
        this.db.prepare(`DELETE FROM ${table} WHERE track_id=?`).run(trackId);
      }
      this.db.prepare("DELETE FROM tracks WHERE id=?").run(trackId);
      if (this.getSetting<string>("active-track-id", "") === trackId) {
        this.setSetting("active-track-id", this.activeTrack()?.id ?? "");
      }
      this.queueLearningState();
      return true;
    })();
  }
  listTracks():Track[]{return (this.db.prepare("SELECT * FROM tracks ORDER BY status='active' DESC,updated_at DESC").all() as TrackRow[]).map((row)=>this.toTrack(row));}
  activeTrack():Track|null{const selected=this.getSetting<string>("active-track-id","");const row=(selected?this.db.prepare("SELECT * FROM tracks WHERE id=?").get(selected):undefined) as TrackRow|undefined;const fallback=row??this.db.prepare("SELECT * FROM tracks WHERE status='active' ORDER BY updated_at DESC LIMIT 1").get() as TrackRow|undefined;return fallback?this.toTrack(fallback):null;}
  trackIdForSession(sessionId:string){const row=this.db.prepare("SELECT track_id FROM sessions WHERE id=?").get(sessionId) as {track_id:string|null}|undefined;return row?.track_id??null;}
  setActiveTrack(trackId:string){const row=this.db.prepare("SELECT id FROM tracks WHERE id=?").get(trackId);if(!row)throw new Error("Track not found");this.setSetting("active-track-id",trackId);this.queueLearningState();return this.activeTrack();}
  updateTrack(trackId:string,input:Partial<Pick<Track,"title"|"goal"|"status"|"language"|"emphasis"|"priorities">>){const current=this.db.prepare("SELECT * FROM tracks WHERE id=?").get(trackId) as TrackRow|undefined;if(!current)throw new Error("Track not found");const now=new Date().toISOString();this.db.prepare("UPDATE tracks SET title=?,goal=?,status=?,language=?,emphasis=?,priorities=?,updated_at=? WHERE id=?").run(input.title?.trim()||current.title,input.goal?.trim()||current.goal,input.status??current.status,input.language===undefined?current.language:input.language,JSON.stringify(input.emphasis??JSON.parse(current.emphasis)),JSON.stringify(input.priorities??JSON.parse(current.priorities)),now,trackId);this.queueLearningState();return this.activeTrack()?.id===trackId?this.activeTrack():this.toTrack(this.db.prepare("SELECT * FROM tracks WHERE id=?").get(trackId) as TrackRow);}

  readSession(id: string): SessionDetail | null {
    const row=this.db.prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id=?`).get(id) as SessionRow|undefined;if(!row)return null;
    const question=this.db.prepare("SELECT * FROM questions WHERE session_id=? ORDER BY ordinal DESC LIMIT 1").get(id) as QuestionRow|undefined;
    let active: SessionDetail["question"]=null; let events:SessionDetail["events"]=[];
    // An abandoned challenge stops being the session's live question, which is
    // what returns the app to general chat until the learner asks for another.
    if(question&&question.status!=="abandoned"){const target=this.db.prepare("SELECT * FROM training_targets WHERE id=?").get(question.training_target_id) as Record<string,unknown>;const attempt=this.db.prepare("SELECT * FROM attempts WHERE question_id=? ORDER BY started_at DESC LIMIT 1").get(question.id) as {id:string;latest_event_sequence:number;started_at:string;completed_at:string|null}|undefined;const design=JSON.parse(question.design) as QuestionDesign;if(attempt)events=this.readAttempt(attempt.id);if(attempt)active={id:question.id,sessionId:id,trainingTargetId:question.training_target_id,ordinal:question.ordinal,title:question.title,statement:question.statement,language:question.language,kind:question.kind,status:question.status,difficulty:question.difficulty,replacesQuestionId:question.replaces_question_id,createdAt:question.created_at,abilityId:String(target.ability_id),abilityTitle:String(target.ability_title),specificGap:String(target.specific_gap),desiredEvidence:String(target.desired_evidence),avoidTesting:JSON.parse(String(target.avoid_testing)) as string[],files:challengeFileEntries(design).map(({path,language,readOnly})=>({path,language,readOnly})),visibleTestFiles:Object.keys(design.visibleTests),hiddenTestCount:validatedHiddenCaseCount(question.validation_report),concepts:this.questionConcepts(question.id),source:parseSourceRef(question.source_ref),attemptId:attempt.id,attemptStartedAt:events[0]?.occurredAt??attempt.started_at,attemptCompletedAt:attempt.completed_at,latestEventSequence:attempt.latest_event_sequence};}
    /**
     * The transcript, with the expensive half of it windowed.
     *
     * A message's `activity` is the whole account of the turn behind it: up to
     * eighty steps, each carrying reasoning text and the arguments and results
     * of a tool call. It is a few hundred bytes of reply and tens of kilobytes
     * of everything else. This is read again on every turn that finishes, and a
     * session with a hundred messages in it was parsing and handing the renderer
     * tens of megabytes of JSON each time, which it then held as React state and
     * drew — the "long chat makes it slow and huge" complaint, exactly.
     *
     * Only the recent tail is loaded. Older turns keep their reply, which is
     * what the transcript is actually made of, and report how many steps they
     * have on disk so the row can offer to fetch them. Nothing is deleted; this
     * is about what is resident, not what is kept.
     */
    const rows=this.db.prepare("SELECT id,role,body,created_at,activity,worked_ms,rating FROM agent_messages WHERE session_id=? ORDER BY created_at").all(id) as Array<{id:string;role:"learner"|"agent"|"system";body:string;created_at:string;activity:string|null;worked_ms:number;rating:"good"|"bad"|null}>;
    const windowStart=Math.max(0,rows.length-TRANSCRIPT_ACTIVITY_WINDOW);
    const messages=rows.map((m,index)=>{
      if(index>=windowStart)return{id:m.id,role:m.role,body:m.body,createdAt:m.created_at,activity:parseActivity(m.activity),activityCount:0,workedMs:m.worked_ms,rating:m.rating};
      return{id:m.id,role:m.role,body:m.body,createdAt:m.created_at,rating:m.rating,activity:parseActivity(m.activity).filter((step)=>step.kind==="tool" && step.ok && (["create_question","replace_current_question","assign_practice_problem"].includes(step.tool) || (step.tool==="teach_lesson" && /"lessonId"\s*:\s*"[^"\s]+"/.test(step.output)))),activityCount:countActivity(m.activity),workedMs:m.worked_ms};
    });
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
    const id=randomUUID();const trackId=this.trackIdForSession(sessionId);const existing=this.db.prepare("SELECT id FROM ability_documents WHERE track_id IS ? AND lower(title)=lower(?) ORDER BY updated_at DESC LIMIT 1").get(trackId,input.ability) as {id:string}|undefined;const abilityId=existing?.id??randomUUID();const now=new Date().toISOString();this.db.prepare("INSERT INTO training_targets VALUES (?,?,?,?,?,?,?,?,?)").run(id,sessionId,abilityId,input.ability,input.specificGap,input.desiredEvidence,avoidTesting,action,now);this.db.prepare("UPDATE sessions SET current_focus=?,updated_at=? WHERE id=?").run(JSON.stringify([input.ability]),now,sessionId);return{id,sessionId,abilityId,abilityTitle:input.ability,specificGap:input.specificGap,desiredEvidence:input.desiredEvidence,avoidTesting:input.avoidTesting,action,createdAt:now};
  }
  latestTarget(sessionId:string){return this.db.prepare("SELECT * FROM training_targets WHERE session_id=? ORDER BY created_at DESC LIMIT 1").get(sessionId) as Record<string,unknown>|undefined;}
  createQuestion(sessionId:string,design:QuestionDesign,report:unknown,options:{replacesQuestionId?:string|null;concepts?:ConceptTagInput[];source?:ChallengeSource|null}={}){const target=this.latestTarget(sessionId);if(!target)throw new Error("A persisted training target is required before question creation");const id=randomUUID();const attemptId=randomUUID();const now=this.stamp();const ordinal=(this.db.prepare("SELECT COALESCE(MAX(ordinal),0)+1 value FROM questions WHERE session_id=?").get(sessionId) as {value:number}).value;const tagged=this.db.transaction(()=>{this.db.prepare("INSERT INTO questions (id,session_id,training_target_id,ordinal,title,statement,language,kind,status,difficulty,design,validation_report,created_at,replaces_question_id,source_ref) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id,sessionId,String(target.id),ordinal,design.title,design.statement,design.language,design.kind,"active",design.difficulty??"developing",JSON.stringify(design),JSON.stringify(report),now,options.replacesQuestionId??null,options.source?JSON.stringify(options.source):null);this.db.prepare("INSERT INTO attempts VALUES (?,?,?,?,?,?,NULL)").run(attemptId,id,sessionId,"active",0,now);const event={id:randomUUID(),attemptId,sequence:0,type:"attempt_started",occurredAt:now,payload:{questionId:id,...(options.replacesQuestionId?{replacesQuestionId:options.replacesQuestionId}:{})},source:"system",schemaVersion:1} satisfies AttemptEvent;this.insertEvent(event);
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
  /** One older turn's steps, fetched when the learner opens it. The window keeps
   *  them out of memory; this is how they come back. */
  /** Record — or clear — what the learner made of a reply. Agent messages only:
   *  there is nothing to say about your own message, and a rating on a system
   *  line would be a verdict on Spar's bookkeeping. */
  rateMessage(messageId:string,rating:"good"|"bad"|null){const changed=this.db.prepare("UPDATE agent_messages SET rating=? WHERE id=? AND role='agent'").run(rating,messageId).changes;return changed>0;}
  messageActivity(messageId:string):AgentActivityStep[]{const row=this.db.prepare("SELECT activity FROM agent_messages WHERE id=?").get(messageId) as {activity:string|null}|undefined;return parseActivity(row?.activity??null);}
  addMessage(sessionId:string,role:"learner"|"agent"|"system",body:string,activity:AgentActivityStep[]=[],workedMs=0){const session=this.db.prepare("SELECT id FROM sessions WHERE id=?").get(sessionId) as {id:string}|undefined;if(!session)return null;const value={id:randomUUID(),role,body,createdAt:new Date().toISOString(),activity};this.db.prepare("INSERT INTO agent_messages (id,session_id,role,body,created_at,activity,worked_ms) VALUES (?,?,?,?,?,?,?)").run(value.id,sessionId,role,body,value.createdAt,JSON.stringify(activity),Math.round(workedMs));this.enqueue("agent-message",{sessionId,messages:[value]});return value;}
  /**
   * Take the conversation back to one of the learner's own messages.
   *
   * What this removes is the conversation from that message onward — the
   * message itself included, because the caller is about to send a rewritten
   * one in its place. What it does not remove is anything the agent recorded on
   * the way: a challenge that was published, an attempt that was made, evidence
   * that was written into the learner model. Those are not conversation, they
   * are the record, and a record that rewrites itself when somebody rephrases a
   * question is not a record. The caller says so plainly in the confirmation.
   *
   * Ordered by rowid rather than `created_at`: insertion order is what "after
   * this message" means, and two messages written in the same millisecond would
   * otherwise cut in whichever order the timestamps happened to sort.
   */
  rewindToMessage(sessionId:string,messageId:string):{body:string;removed:number}|null{
    const target=this.db.prepare("SELECT rowid,role,body FROM agent_messages WHERE id=? AND session_id=?").get(messageId,sessionId) as {rowid:number;role:string;body:string}|undefined;
    if(!target||target.role!=="learner")return null;
    const removed=this.db.prepare("DELETE FROM agent_messages WHERE session_id=? AND rowid>=?").run(sessionId,target.rowid).changes;
    /* Not enqueued for sync: the cloud transcript is append-only and has no
       delete route, so a row here would be written and dropped on the next
       drain. The local conversation is the one the learner is rewinding. */
    return {body:target.body,removed};
  }
  hasLearnerEvidence(trackId?:string|null){const scope=this.learningTrackId(trackId);if(!scope)return false;const abilities=(this.db.prepare("SELECT COUNT(*) count FROM ability_documents WHERE track_id=?").get(scope) as {count:number}).count;const completed=(this.db.prepare("SELECT COUNT(*) count FROM attempts a JOIN sessions s ON s.id=a.session_id WHERE a.status='completed' AND s.track_id=?").get(scope) as {count:number}).count;return abilities>0||completed>0;}
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
  hasRelevantLearnerEvidence(goal:string,trackId?:string|null){
    const scope=this.learningTrackId(trackId);if(!scope)return false;
    const terms=evidenceTerms(goal);
    if(!terms.length)return false;
    const threshold=Math.min(2,terms.length);
    const abilities=this.db.prepare("SELECT title,markdown,status,evidence_ids FROM ability_documents WHERE track_id=? ORDER BY updated_at DESC LIMIT 200").all(scope) as Array<{title:string;markdown:string;status:string;evidence_ids:string}>;
    if(abilities.some((row)=>(row.status!=="uncertain"||parseStringArray(row.evidence_ids).length>0)&&evidenceRelevance(`${row.title}\n${row.markdown}`,terms)>=threshold))return true;
    const events=this.db.prepare(`SELECT q.title,e.type,e.payload FROM attempt_events e JOIN attempts a ON a.id=e.attempt_id JOIN questions q ON q.id=a.question_id JOIN sessions s ON s.id=a.session_id
      WHERE e.type<>'attempt_started' AND e.sequence>=(SELECT MAX(start.sequence) FROM attempt_events start WHERE start.attempt_id=e.attempt_id AND start.type='attempt_started')
        AND s.track_id=? ORDER BY e.occurred_at DESC LIMIT 500`).all(scope) as Array<{title:string;type:string;payload:string}>;
    return events.some((row)=>evidenceRelevance(`${row.title}\n${row.type}\n${row.payload}`,terms)>=threshold);
  }
  /**
   * Put a question from the agent in front of the learner.
   *
   * The answered branch exists for one case and one case only: the agent asks,
   * the turn ends, the learner answers, and the answer opens a new turn in which
   * the phase controller requires `ask_user_question` again. Handing back the
   * answer there is what stops it asking the same thing forever.
   *
   * It used to do that for *any* later question, because this table holds one
   * row per session. So the second question a session ever asked was swallowed
   * and the first one's answer returned in its place — the agent would see a
   * reply to something it had not asked, ask again, and the learner would watch
   * it spin having never been shown anything to answer. A question that differs
   * from the answered one is a new question and replaces it.
   */
  setPendingIntake(sessionId:string,input:AskUserQuestionInput){
    const existing=this.db.prepare("SELECT question,status,answer FROM session_intake WHERE session_id=?").get(sessionId) as {question:string;status:string;answer:string|null}|undefined;
    if(existing?.status==="answered"){
      let previous:AskUserQuestionRequest;
      try{previous=askUserQuestionRequestSchema.parse(JSON.parse(existing.question));}catch{previous=legacyQuestionRequest(existing.question);}
      if(sameIntake(previous,input))return{request:previous,status:"answered" as const,answer:existing.answer};
    }
    const now=new Date().toISOString();
    const request=askUserQuestionRequestSchema.parse({id:randomUUID(),...input});
    this.db.prepare("INSERT INTO session_intake (session_id,question,status,answer,created_at,answered_at) VALUES (?,?,'pending',NULL,?,NULL) ON CONFLICT(session_id) DO UPDATE SET question=excluded.question,status='pending',answer=NULL,created_at=excluded.created_at,answered_at=NULL").run(sessionId,JSON.stringify(request),now);
    return{request,status:"pending" as const};
  }

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
  searchLearner(query:string,limit:number,trackId?:string|null){const terms=searchTerms(query);const scope=this.learningTrackId(trackId);if(!terms.length||!scope)return[];const rows=this.db.prepare("SELECT id,title,markdown,version,status,updated_at FROM ability_documents WHERE track_id=? ORDER BY updated_at DESC LIMIT 200").all(scope) as Array<{id:string;title:string;markdown:string;version:number;status:string;updated_at:string}>;return rows.map(row=>({row,score:relevance(`${row.title}\n${row.markdown}`,terms)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||b.row.updated_at.localeCompare(a.row.updated_at)).slice(0,limit).map(item=>item.row);}
  /**
   * The rest of the learner's memory, searched the way the ability documents are.
   *
   * An ability document is the standing claim. These are the observations under
   * it: one behaviour per row, with the polarity, the independence and the
   * attempt it came from, and the mistake lifecycles assembled out of them.
   *
   * They are written on every attempt-complete turn and, until this, nothing but
   * the learner's own screens could read them back. So the agent would record
   * "inconsistent once restoring the invariant takes more than one shrink" as a
   * hypothesis, find no way to retrieve it on the next attempt, re-derive the
   * finding from the replay, and write it down again — a pattern can only be
   * promoted by evidence spanning two attempts, and nothing could ever reach the
   * first attempt's half of it.
   */
  searchLearnerMemory(query:string,limit:number,trackId?:string|null){
    const terms=searchTerms(query);const scope=this.learningTrackId(trackId);
    if(!terms.length||!scope)return{patterns:[],evidence:[]};
    const patternRows=this.db.prepare(`SELECT p.id,p.title,p.description,p.status,p.ability_id,a.title ability_title,p.last_observed_at,p.updated_at,COUNT(pe.evidence_id) evidence_count
      FROM learner_patterns p JOIN ability_documents a ON a.id=p.ability_id LEFT JOIN pattern_evidence pe ON pe.pattern_id=p.id
      WHERE a.track_id=? GROUP BY p.id ORDER BY p.updated_at DESC LIMIT 200`).all(scope) as Array<Record<string,unknown>>;
    const evidenceRows=this.db.prepare(`SELECT e.event_id,e.statement,e.polarity,e.independence,e.strength,e.occurred_at,e.attempt_id,e.ability_id,a.title ability_title
      FROM learner_evidence e JOIN ability_documents a ON a.id=e.ability_id
      /* rowid breaks the tie. Two pieces of evidence written in the same
         millisecond — which is what happens when one turn records both — are
         otherwise returned in whatever order SQLite happens to scan them, and
         "most recent first" stops meaning anything at exactly the moment two
         rows are competing to be it. */
      WHERE a.track_id=? ORDER BY e.occurred_at DESC, e.rowid DESC LIMIT 300`).all(scope) as Array<Record<string,unknown>>;
    const rank=<T extends Record<string,unknown>>(rows:T[],text:(row:T)=>string,recency:(row:T)=>string)=>rows
      .map((row)=>({row,score:relevance(text(row),terms)}))
      .filter((item)=>item.score>0)
      .sort((a,b)=>b.score-a.score||recency(b.row).localeCompare(recency(a.row)))
      .slice(0,limit)
      .map((item)=>item.row);
    return {
      patterns:rank(patternRows,(row)=>`${row.title}\n${row.description}\n${row.ability_title}`,(row)=>String(row.updated_at)).map((row)=>({id:String(row.id),title:String(row.title),description:String(row.description),status:String(row.status),abilityId:row.ability_id?String(row.ability_id):null,abilityTitle:String(row.ability_title),evidenceCount:Number(row.evidence_count),lastObservedAt:row.last_observed_at?String(row.last_observed_at):null})),
      evidence:rank(evidenceRows,(row)=>`${row.statement}\n${row.ability_title}`,(row)=>String(row.occurred_at)).map((row)=>({abilityId:String(row.ability_id),abilityTitle:String(row.ability_title),attemptId:row.attempt_id?String(row.attempt_id):null,eventId:row.event_id?String(row.event_id):null,statement:String(row.statement),polarity:String(row.polarity),independence:String(row.independence),strength:Number(row.strength),occurredAt:String(row.occurred_at)})),
    };
  }
  readAbility(id:string){return this.db.prepare("SELECT * FROM ability_documents WHERE id=?").get(id)??null;}
  searchAttempts(query:string,limit:number,trackId?:string|null){const terms=searchTerms(query);const scope=this.learningTrackId(trackId);if(!terms.length||!scope)return[];const rows=this.db.prepare(`SELECT e.attempt_id,e.type,e.occurred_at,e.payload,q.title FROM attempt_events e JOIN attempts a ON a.id=e.attempt_id JOIN questions q ON q.id=a.question_id JOIN sessions s ON s.id=a.session_id
    WHERE e.sequence>=(SELECT MAX(start.sequence) FROM attempt_events start WHERE start.attempt_id=e.attempt_id AND start.type='attempt_started')
      AND s.track_id=? ORDER BY e.occurred_at DESC LIMIT 500`).all(scope) as Array<{attempt_id:string;type:string;occurred_at:string;payload:string;title:string}>;return rows.map(row=>({row,score:relevance(`${row.title}\n${row.type}\n${row.payload}`,terms)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||b.row.occurred_at.localeCompare(a.row.occurred_at)).slice(0,limit).map(item=>item.row);}
  /** Only the latest evidence segment is readable. A reset is another durable
   * `attempt_started` marker, so synced rows stay append-only while every agent
   * search and replay shares the same hard visibility boundary. */
  readAttempt(id:string){return (this.db.prepare(`SELECT id,attempt_id,sequence,type,occurred_at,payload,source,schema_version FROM attempt_events
    WHERE attempt_id=? AND sequence>=(SELECT MAX(sequence) FROM attempt_events WHERE attempt_id=? AND type='attempt_started') ORDER BY sequence`).all(id,id) as Array<{id:string;attempt_id:string;sequence:number;type:string;occurred_at:string;payload:string;source:string;schema_version:number}>).map((event)=>({id:event.id,attemptId:event.attempt_id,sequence:event.sequence,type:event.type,occurredAt:event.occurred_at,payload:JSON.parse(event.payload),source:event.source,schemaVersion:event.schema_version}));}
  /** What the challenge behind an attempt is, so a replay of the attempt can name
   *  it. Separate from `readChallenge`, which returns the whole design and every
   *  attempt at it — far more than a replay header needs. */
  attemptSubject(attemptId:string){const row=this.db.prepare("SELECT q.id question_id,q.title,q.language,q.statement,q.ordinal,a.status,a.started_at,a.completed_at,s.id session_id FROM attempts a JOIN questions q ON q.id=a.question_id JOIN sessions s ON s.id=a.session_id WHERE a.id=?").get(attemptId) as {question_id:string;title:string;language:string;statement:string;ordinal:number;status:string;started_at:string;completed_at:string|null;session_id:string}|undefined;return row??null;}
  submissionBundle(attemptId:string){const row=this.db.prepare("SELECT a.id attempt_id,a.session_id,a.latest_event_sequence,q.id question_id,q.language,q.design FROM attempts a JOIN questions q ON q.id=a.question_id WHERE a.id=? AND a.status='active'").get(attemptId) as {attempt_id:string;session_id:string;latest_event_sequence:number;question_id:string;language:Language;design:string}|undefined;return row?{...row,design:JSON.parse(row.design) as QuestionDesign}:null;}
  /**
   * Every submission at a challenge, oldest first.
   *
   * Reads the whole ledger rather than `readAttempt`'s latest segment. That
   * boundary exists so the agent judges the evidence a learner has not since
   * wiped, and it is right for evidence — but a submission the learner made and
   * then reset past is still a submission they made, and this is the surface
   * that promises to have kept them. It spans attempts too: a challenge reopened
   * after a rejected review has two attempts and one history.
   */
  submissionsForQuestion(questionId:string):SubmissionRow[]{
    const context=this.submissionContext(questionId);
    if(!context)return[];
    const rows=this.db.prepare(`SELECT e.id,e.attempt_id,e.sequence,e.type,e.occurred_at,e.payload,a.started_at FROM attempt_events e
      JOIN attempts a ON a.id=e.attempt_id
      WHERE a.question_id=? AND e.type IN ('submission_created','test_run','submission_evaluated')
      ORDER BY a.started_at, e.sequence`).all(questionId) as Array<{id:string;attempt_id:string;sequence:number;type:string;occurred_at:string;payload:string;started_at:string}>;
    const attemptOrder=new Map<string,number>();
    for(const row of rows)if(!attemptOrder.has(row.attempt_id))attemptOrder.set(row.attempt_id,attemptOrder.size+1);
    return foldSubmissions(rows.map((row)=>({id:row.id,attemptId:row.attempt_id,sequence:row.sequence,type:row.type,occurredAt:row.occurred_at,payload:JSON.parse(row.payload) as Record<string,unknown>})))
      .map((submission)=>({...submissionSummary(submission),...context,attemptOrdinal:attemptOrder.get(submission.attemptId)??1}));
  }

  /** One submission in full: what was sent, and every case it was graded on. */
  readSubmission(submissionId:string):SubmissionRecord|null{
    const owner=this.db.prepare("SELECT a.question_id FROM attempt_events e JOIN attempts a ON a.id=e.attempt_id WHERE e.id=? AND e.type='submission_created'").get(submissionId) as {question_id:string}|undefined;
    if(!owner)return null;
    const context=this.submissionContext(owner.question_id);
    if(!context)return null;
    const rows=this.db.prepare(`SELECT e.id,e.attempt_id,e.sequence,e.type,e.occurred_at,e.payload,a.started_at FROM attempt_events e
      JOIN attempts a ON a.id=e.attempt_id
      WHERE a.question_id=? AND e.type IN ('submission_created','test_run','submission_evaluated')
      ORDER BY a.started_at, e.sequence`).all(owner.question_id) as Array<{id:string;attempt_id:string;sequence:number;type:string;occurred_at:string;payload:string}>;
    const attemptOrder=new Map<string,number>();
    for(const row of rows)if(!attemptOrder.has(row.attempt_id))attemptOrder.set(row.attempt_id,attemptOrder.size+1);
    const found=foldSubmissions(rows.map((row)=>({id:row.id,attemptId:row.attempt_id,sequence:row.sequence,type:row.type,occurredAt:row.occurred_at,payload:JSON.parse(row.payload) as Record<string,unknown>}))).find((submission)=>submission.id===submissionId);
    return found?{...found,...context,attemptOrdinal:attemptOrder.get(found.attemptId)??1}:null;
  }

  /** The most recent submissions across a whole session, newest first. What the
   *  agent reaches for when the learner says "that one where I". */
  submissionsForSession(sessionId:string,limit=40):SubmissionRow[]{
    const questions=this.db.prepare("SELECT id FROM questions WHERE session_id=? ORDER BY ordinal").all(sessionId) as Array<{id:string}>;
    return questions.flatMap((question)=>this.submissionsForQuestion(question.id))
      /* Two submissions can share a millisecond — a rejected one and the retry
         that follows it in the same handler — so the stamp alone is not an
         order. The ordinal breaks the tie within a challenge, and the challenge
         number breaks it between two. */
      .sort((left,right)=>right.submittedAt.localeCompare(left.submittedAt)||right.challengeOrdinal-left.challengeOrdinal||right.ordinal-left.ordinal)
      .slice(0,limit);
  }

  private submissionContext(questionId:string):Omit<SubmissionContext,"attemptOrdinal">|null{
    const row=this.db.prepare("SELECT q.id,q.title,q.ordinal,q.language,s.id session_id,s.title session_title FROM questions q JOIN sessions s ON s.id=q.session_id WHERE q.id=?").get(questionId) as {id:string;title:string;ordinal:number;language:string;session_id:string;session_title:string}|undefined;
    return row?{challengeId:row.id,challengeTitle:row.title,challengeOrdinal:row.ordinal,language:row.language,sessionId:row.session_id,sessionTitle:row.session_title}:null;
  }

  completeAttempt(attemptId:string,_outcome:"passed"|"failed"){const now=new Date().toISOString();this.db.transaction(()=>{const attempt=this.db.prepare("SELECT question_id,session_id FROM attempts WHERE id=?").get(attemptId) as {question_id:string;session_id:string}|undefined;if(!attempt)throw new Error("Attempt not found");this.db.prepare("UPDATE attempts SET status='completed',completed_at=? WHERE id=?").run(now,attemptId);this.db.prepare("UPDATE questions SET status='completed' WHERE id=?").run(attempt.question_id);this.db.prepare("UPDATE sessions SET updated_at=? WHERE id=?").run(now,attempt.session_id);
    /* Inside the same transaction as the completion. A solve that was recorded
       but not rated would be invisible to the rating for ever: nothing re-reads
       finished challenges looking for ones it missed. */
    this.rateFinishedChallenge(attempt.question_id,`Solved ${this.questionTitle(attempt.question_id)}`,this.trackForSession(attempt.session_id));})();}

  private questionTitle(questionId:string){return (this.db.prepare("SELECT title FROM questions WHERE id=?").get(questionId) as {title:string}|undefined)?.title??"a challenge";}
  private trackForSession(sessionId:string){return (this.db.prepare("SELECT track_id FROM sessions WHERE id=?").get(sessionId) as {track_id:string|null}|undefined)?.track_id??null;}
  /**
   * A completed attempt, put back.
   *
   * The submission passed every case, so the attempt closed — and then the
   * review found it was not solved the way the challenge required. Reopening is
   * the honest record of that: the run that passed stays in the log, the review
   * that rejected it is appended after, and the learner gets their challenge
   * back rather than a new one that quietly asks the same thing again.
   */
  reopenAttempt(attemptId:string,reason:string){const now=new Date().toISOString();return this.db.transaction(()=>{const attempt=this.db.prepare("SELECT question_id,session_id,latest_event_sequence FROM attempts WHERE id=?").get(attemptId) as {question_id:string;session_id:string;latest_event_sequence:number}|undefined;if(!attempt)throw new Error("Attempt not found");const event={id:randomUUID(),attemptId,sequence:attempt.latest_event_sequence+1,type:"attempt_started",occurredAt:now,payload:{questionId:attempt.question_id,reopened:true,reason},source:"agent",schemaVersion:1} satisfies AttemptEvent;this.insertEvent(event);this.db.prepare("UPDATE attempts SET status='active',completed_at=NULL,latest_event_sequence=? WHERE id=?").run(event.sequence,attemptId);this.db.prepare("UPDATE questions SET status='active' WHERE id=?").run(attempt.question_id);this.db.prepare("UPDATE sessions SET status='active',updated_at=? WHERE id=?").run(now,attempt.session_id);this.enqueue("attempt-event",event);return{sessionId:attempt.session_id,questionId:attempt.question_id};})();}
  resetAttempt(sessionId:string,attemptId:string){const attempt=this.db.prepare("SELECT question_id FROM attempts WHERE id=? AND session_id=? AND status='active'").get(attemptId,sessionId) as {question_id:string}|undefined;if(!attempt)throw new Error("No active attempt to reset in this session");return this.appendNextEvent({id:randomUUID(),attemptId,type:"attempt_started",occurredAt:new Date().toISOString(),payload:{questionId:attempt.question_id,reset:true},source:"learner",schemaVersion:1});}
  /** The learner gave up. Records why, then leaves the session in chat mode. */
  abandonAttempt(attemptId:string,reason:string,source:"learner"|"agent"="learner",outcome:"abandoned"|"replaced"="abandoned"){const now=new Date().toISOString();return this.db.transaction(()=>{const attempt=this.db.prepare("SELECT question_id,session_id,latest_event_sequence FROM attempts WHERE id=? AND status='active'").get(attemptId) as {question_id:string;session_id:string;latest_event_sequence:number}|undefined;if(!attempt)throw new Error("No active attempt to abandon");const event={id:randomUUID(),attemptId,sequence:attempt.latest_event_sequence+1,type:"attempt_completed",occurredAt:now,payload:{outcome,reason},source,schemaVersion:1} satisfies AttemptEvent;this.insertEvent(event);this.db.prepare("UPDATE attempts SET status='completed',completed_at=?,latest_event_sequence=? WHERE id=?").run(now,event.sequence,attemptId);this.db.prepare("UPDATE questions SET status='abandoned' WHERE id=?").run(attempt.question_id);this.db.prepare("UPDATE sessions SET status='paused',updated_at=? WHERE id=?").run(now,attempt.session_id);this.enqueue("attempt-event",event);
    /* Only the learner conceding is a result. A challenge the agent replaced is
       scored by nothing — `outcomeScore` returns null for it — so this call is
       made on both paths and does nothing on that one. */
    this.rateFinishedChallenge(attempt.question_id,outcome==="abandoned"?`Gave up on ${this.questionTitle(attempt.question_id)}`:"",this.trackForSession(attempt.session_id));
    return{sessionId:attempt.session_id,questionId:attempt.question_id};})();}
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
  updateAbility(input:{abilityId:string;markdown:string;evidenceEventIds:string[];summary?:string;practice?:string[];concepts?:ConceptTagInput[];status?:AbilityStatus;evidence?:EvidenceInterpretation[];pattern?:PatternInterpretation}){const target=this.db.prepare("SELECT ability_title FROM training_targets WHERE ability_id=? ORDER BY created_at DESC LIMIT 1").get(input.abilityId) as {ability_title:string}|undefined;const existing=this.abilityRow(input.abilityId);return this.writeAbility({id:input.abilityId,title:existing?.title??target?.ability_title??"Observed ability",...input},existing);}
  upsertAbility(input:{title:string;markdown:string;evidenceEventIds:string[];summary?:string;practice?:string[];concepts?:ConceptTagInput[];status?:AbilityStatus;evidence?:EvidenceInterpretation[];pattern?:PatternInterpretation},trackId?:string|null){const scope=this.learningTrackId(trackId);if(scope===null&&trackId===undefined)throw new Error("A Track is required before writing learner memory");const found=this.db.prepare("SELECT id FROM ability_documents WHERE track_id IS ? AND lower(title)=lower(?) ORDER BY updated_at DESC LIMIT 1").get(scope,input.title) as {id:string}|undefined;const existing=found?this.abilityRow(found.id):undefined;return this.writeAbility({id:existing?.id??randomUUID(),trackId:scope,...input},existing);}
  ensureAbility(id:string,title:string,trackId?:string|null){const scope=trackId===undefined?(this.trackIdForAbilityTarget(id)??this.learningTrackId()):this.learningTrackId(trackId);if(scope===null&&trackId===undefined)throw new Error("A Track is required before writing learner memory");const now=new Date().toISOString();this.db.prepare("INSERT OR IGNORE INTO ability_documents (id,title,markdown,version,status,updated_at,evidence_ids,summary,practice,earned_at,track_id) VALUES (?,?,?,?,?,?,?,?,?,NULL,?)").run(id,title,`# ${title}\n\nIntroduced as an active learning target. Evidence is still uncertain.`,1,"uncertain",now,"[]","",'[]',scope);this.reconcileAbilityState(id);return this.readAbility(id);}
  /**
   * One ability version. An ability is the thing the learner is told they have,
   * so this owns the two facts the UI is not allowed to guess: the status, which
   * follows the evidence rather than the agent's enthusiasm, and `earned_at`,
   * stamped once when evidence first supported it and never moved afterwards —
   * the date it was earned, not the date the document was last edited.
   */
  private writeAbility(input:{id:string;trackId?:string|null;title:string;markdown:string;evidenceEventIds:string[];summary?:string;practice?:string[];concepts?:ConceptTagInput[];status?:AbilityStatus;evidence?:EvidenceInterpretation[];pattern?:PatternInterpretation},existing?:AbilityRow){
    const now=this.stamp();
    const evidenceIds=[...new Set([...(existing?JSON.parse(existing.evidence_ids) as string[]:[]),...input.evidenceEventIds])];
    const version=(existing?.version??0)+1;
    /* The document is written in two passes, because the status now follows the
       evidence and the evidence rows cannot exist until the document they hang
       off does. This pass carries the old status forward untouched; the status
       is settled below, once the rows this write brings have landed. */
    const provisional=input.status??existing?.status??"uncertain";
    const summary=input.summary?.trim()||existing?.summary||"";
    const practice=input.practice?.length?input.practice.map((item)=>item.trim()).filter(Boolean).slice(0,4):(existing?JSON.parse(existing.practice) as string[]:[]);
    this.db.transaction(()=>{
      const owner=input.trackId!==undefined?input.trackId:(existing?.track_id??this.learningTrackId());
      this.db.prepare("INSERT INTO ability_documents (id,title,markdown,version,status,updated_at,evidence_ids,summary,practice,earned_at,track_id) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,markdown=excluded.markdown,version=excluded.version,status=excluded.status,updated_at=excluded.updated_at,evidence_ids=excluded.evidence_ids,summary=excluded.summary,practice=excluded.practice,earned_at=excluded.earned_at,track_id=excluded.track_id").run(input.id,input.title,input.markdown,version,provisional,now,JSON.stringify(evidenceIds),summary,JSON.stringify(practice),existing?.earned_at??null,owner);
      // Concepts are replaced rather than merged: the set is the agent's current
      // claim about what this ability covers, and a stale concept left attached
      // would keep pulling unrelated challenges into its evidence.
      if(input.concepts?.length){
        this.db.prepare("DELETE FROM ability_concepts WHERE ability_id=?").run(input.id);
        const link=this.db.prepare("INSERT OR IGNORE INTO ability_concepts (ability_id,concept_id) VALUES (?,?)");
        for(const tag of input.concepts.slice(0,8))link.run(input.id,this.ensureConcept(tag).id);
      }
    })();
    this.recordAbilityEvidence(input.id,input.evidenceEventIds,summary);
    if(input.evidence?.length)this.recordInterpretedEvidence(input.id,input.evidence);
    /* The agent's word when it gave one, and otherwise what the rows support.
       Never the other way round: an explicit status is not second-guessed here,
       however the arithmetic reads — that disagreement is surfaced as a notice
       in `reconcileAbilityState` rather than settled behind the agent's back. */
    const status=input.status??this.abilityStatusFromEvidence(input.id);
    /* Stamped once, and never restamped. An ability written before this column
       existed has no date to recover, so it inherits its last edit rather than
       claiming to have been earned just now — a wrong-but-close date is a
       rounding error, and "earned 2 minutes ago" on a month-old ability is a
       lie the card would tell every time it was opened. */
    const earnedAt=existing?.earned_at??(status==="uncertain"?null:existing&&existing.status!=="uncertain"?existing.updated_at:now);
    this.db.prepare("UPDATE ability_documents SET status=?,earned_at=? WHERE id=?").run(status,earnedAt,input.id);
    if(input.pattern)this.upsertPattern(input.id,input.pattern);
    this.reconcileAbilityState(input.id);
    this.queueLearningState();
    return {id:input.id,title:input.title,version,status,summary,practice,earnedAt,evidenceEventIds:evidenceIds,concepts:this.abilityConcepts(input.id),updatedAt:now};
  }
  listAbilities(trackId?:string|null):AbilityHistorySummary[]{const scope=this.learningTrackId(trackId);if(!scope)return[];const concepts=this.abilityConceptRows();return (this.db.prepare("SELECT id,title,markdown,version,status,updated_at,evidence_ids,summary,practice,earned_at,track_id FROM ability_documents WHERE track_id=? ORDER BY (earned_at IS NULL), updated_at DESC").all(scope) as AbilityRow[]).map((row)=>this.toAbility(row,concepts.get(row.id)??[]));}

  /** Every ability state the learner has, in every Track. Only the rating reads
   *  this — everything else in the app is about one line of practice at a time. */
  allAbilityStates():LearnerAbilityState[]{const rows=this.db.prepare("SELECT s.*,a.title FROM learner_ability_state s JOIN ability_documents a ON a.id=s.ability_id ORDER BY s.updated_at DESC").all() as Array<Record<string,unknown>>;return rows.map((row)=>this.toAbilityState(row));}
  abilityStates(trackId?:string|null):LearnerAbilityState[]{const scope=this.learningTrackId(trackId);if(!scope)return[];const rows=this.db.prepare("SELECT s.*,a.title FROM learner_ability_state s JOIN ability_documents a ON a.id=s.ability_id WHERE a.track_id=? ORDER BY CASE s.training_status WHEN 'training' THEN 0 WHEN 'diagnosing' THEN 1 WHEN 'monitoring' THEN 2 ELSE 3 END,s.updated_at DESC").all(scope) as Array<Record<string,unknown>>;return rows.map((row)=>this.toAbilityState(row));}
  private toAbilityState(row:Record<string,unknown>):LearnerAbilityState{return{abilityId:String(row.ability_id),title:String(row.title),proficiency:Number(row.proficiency),confidence:Number(row.confidence),evidenceCount:Number(row.evidence_count),lastEvidenceAt:row.last_evidence_at?String(row.last_evidence_at):null,trainingStatus:String(row.training_status) as LearnerAbilityState["trainingStatus"],trend:String(row.trend) as LearnerAbilityState["trend"],currentBelief:String(row.current_belief),nextVerification:String(row.next_verification),updatedAt:String(row.updated_at)};}
  evidenceForAbility(abilityId:string):LearnerEvidence[]{return (this.db.prepare("SELECT * FROM learner_evidence WHERE ability_id=? ORDER BY occurred_at DESC").all(abilityId) as Array<Record<string,unknown>>).map((row)=>({id:String(row.id),abilityId:String(row.ability_id),attemptId:row.attempt_id?String(row.attempt_id):null,eventId:row.event_id?String(row.event_id):null,statement:String(row.statement),polarity:String(row.polarity) as LearnerEvidence["polarity"],independence:String(row.independence) as LearnerEvidence["independence"],strength:Number(row.strength),occurredAt:String(row.occurred_at)}));}
  listPatterns(trackId?:string|null):LearnerPattern[]{const scope=this.learningTrackId(trackId);if(!scope)return[];return (this.db.prepare("SELECT p.*,COUNT(pe.evidence_id) evidence_count FROM learner_patterns p JOIN ability_documents a ON a.id=p.ability_id LEFT JOIN pattern_evidence pe ON pe.pattern_id=p.id WHERE a.track_id=? GROUP BY p.id ORDER BY CASE p.status WHEN 'pattern' THEN 0 WHEN 'hypothesis' THEN 1 WHEN 'monitoring' THEN 2 WHEN 'observation' THEN 3 ELSE 4 END,p.updated_at DESC").all(scope) as Array<Record<string,unknown>>).map((row)=>({id:String(row.id),title:String(row.title),description:String(row.description),abilityId:row.ability_id?String(row.ability_id):null,status:String(row.status) as LearnerPattern["status"],evidenceCount:Number(row.evidence_count),lastObservedAt:row.last_observed_at?String(row.last_observed_at):null,updatedAt:String(row.updated_at)}));}
  /** The mistake lifecycles filed under one ability. Read beside the document
   *  itself, because the document is the claim and these are the open questions
   *  about it — an update proposed without them can only restate the claim. */
  patternsForAbility(abilityId:string):LearnerPattern[]{return (this.db.prepare("SELECT p.*,COUNT(pe.evidence_id) evidence_count FROM learner_patterns p LEFT JOIN pattern_evidence pe ON pe.pattern_id=p.id WHERE p.ability_id=? GROUP BY p.id ORDER BY CASE p.status WHEN 'pattern' THEN 0 WHEN 'hypothesis' THEN 1 WHEN 'monitoring' THEN 2 WHEN 'observation' THEN 3 ELSE 4 END,p.updated_at DESC").all(abilityId) as Array<Record<string,unknown>>).map((row)=>({id:String(row.id),title:String(row.title),description:String(row.description),abilityId:row.ability_id?String(row.ability_id):null,status:String(row.status) as LearnerPattern["status"],evidenceCount:Number(row.evidence_count),lastObservedAt:row.last_observed_at?String(row.last_observed_at):null,updatedAt:String(row.updated_at)}));}

  /**
   * Abilities nobody has checked in a long time stop claiming to be current.
   *
   * `stale` has been a status since the ledger existed and nothing ever set it,
   * so the one state that means "this was reliable and nothing since has looked"
   * was reachable only by the agent remembering to ask for it. An earned ability
   * is a claim about the present tense, and a claim about the present tense
   * decays: past the cutoff with no new evidence it goes back to being worth
   * re-checking, which is what the `retain` action already exists for.
   *
   * Only `independent` decays. `developing` and `uncertain` are already claims
   * Spar is unsure of, and nothing is gained by making them vaguer.
   *
   * Neither `updated_at` nor the version moves. Decay is not a new version of
   * the document — nobody wrote anything — and `updated_at` is what
   * `targetProgress` measures "challenges since this ability last changed"
   * against, so touching it here would report a session as making progress on
   * the strength of a clock.
   */
  decayAbilities(now=new Date()):string[]{
    const cutoff=new Date(now.getTime()-ABILITY_STALE_AFTER_DAYS*86_400_000).toISOString();
    const rows=this.db.prepare(`SELECT a.id,a.title,a.track_id FROM ability_documents a LEFT JOIN learner_ability_state s ON s.ability_id=a.id
      WHERE a.status='independent' AND COALESCE(s.last_evidence_at,a.updated_at)<?`).all(cutoff) as Array<{id:string;title:string;track_id:string|null}>;
    for(const row of rows){
      this.db.prepare("UPDATE ability_documents SET status='stale' WHERE id=?").run(row.id);
      this.addNotice(`${row.title} has not been checked recently`,`Spar last saw evidence for this over ${ABILITY_STALE_AFTER_DAYS} days ago, so it is no longer counted as current. A retain challenge would settle whether it still holds.`,row.track_id);
    }
    /* Every ability, not only the ones that crossed the line. Evidence loses
       weight by the day and the reading is only recomputed when something is
       written, so without this a learner who stopped for two months would come
       back to numbers dated to their last session — confident, current-looking,
       and about somebody who has not written code since. */
    this.reconcileEveryAbility();
    if(rows.length)this.queueLearningState();
    return rows.map((row)=>row.id);
  }

  private reconcileEveryAbility(){for(const row of this.db.prepare("SELECT id FROM ability_documents").all() as Array<{id:string}>)this.reconcileAbilityState(row.id);}

  /**
   * Ability states written when `proficiency` was a lookup on the status word.
   *
   * Those rows hold one of four constants apiece and say nothing about the
   * evidence underneath them, so they are recomputed once rather than left to
   * drift into the first write that happens to touch each ability. Rows arriving
   * later from another device through `restoreLearningState` carry the same
   * stale shape, which is why that path recomputes too.
   */
  private migrateAbilityProficiency(){if(this.getSetting<boolean>("ability-proficiency-v2",false))return;this.reconcileEveryAbility();this.setSetting("ability-proficiency-v2",true);}

  listNotices(limit=6,trackId?:string|null):SparNotice[]{const scope=this.learningTrackId(trackId);if(!scope)return[];return (this.db.prepare("SELECT id,title,body,created_at FROM learner_notices WHERE dismissed_at IS NULL AND track_id=? ORDER BY created_at DESC LIMIT ?").all(scope,limit) as Array<Record<string,unknown>>).map((row)=>({id:String(row.id),title:String(row.title),body:String(row.body),createdAt:String(row.created_at)}));}
  /**
   * The learner's rating, across everything they have done.
   *
   * Not scoped to a Track, unlike the abilities and patterns beside it. Those
   * are statements about one line of practice and only mean anything inside it;
   * a rating is a statement about the person. Per Track it read as a different
   * number for the same learner depending on which Track was open, and starting
   * a new Track reset them to 1200 — so the one figure in the app that is
   * supposed to accumulate was the one that kept starting over.
   *
   * `track_id` is still written on the rows and still carried by sync, because
   * it says which line of practice produced the point; it just no longer divides
   * the series.
   */
  ratingHistory():RatingPoint[]{return (this.db.prepare("SELECT * FROM rating_points ORDER BY occurred_at").all() as Array<Record<string,unknown>>).map((row)=>({id:String(row.id),rating:Number(row.rating),deviation:Number(row.deviation??INITIAL_DEVIATION),volatility:Number(row.volatility??INITIAL_VOLATILITY),provisional:Boolean(row.provisional),reason:String(row.reason),occurredAt:String(row.occurred_at)}));}
  /**
   * Where the learner stands right now, for the things that have to decide
   * something rather than draw it.
   *
   * Decayed for the time since the last point, which is the whole reason this is
   * not just `ratingHistory().at(-1)`. The stored point is what was true when it
   * was written; a learner who has been away for two months is less precisely
   * placed than that point claims, and problem selection has to widen for them
   * rather than keep choosing against a precision nobody has re-earned. The same
   * decay runs inside `rateFinishedChallenge`, so the window a problem was
   * chosen against and the rating that scores it are the same reading.
   *
   * Not written back: decay is a fact about elapsed time, and recording it as a
   * point would put a mark on the learner's curve on a day they did nothing.
   */
  currentRating(at?:string):Rating{const prior=this.ratingHistory().at(-1)??this.ensureRating();const now=at??new Date().toISOString();
    return decayRating({rating:prior.rating,deviation:prior.deviation,volatility:prior.volatility},elapsedDays(prior.occurredAt,now));}
  /**
   * A picture the agent made, kept for as long as the message that shows it.
   *
   * Stored as opaque JSON. The store has no opinion about what a visualisation
   * is — the shape belongs to `@spar/visualizer`, and putting a second copy of
   * it in the schema would mean a migration every time the canvas learns to draw
   * something new. What the store owns is that the row is scoped to a session
   * and outlives the turn that wrote it.
   */
  saveVisualization(input: { id: string; sessionId: string; title: string; payload: unknown }): void {
    this.db.prepare("INSERT OR REPLACE INTO agent_visualizations (id, session_id, title, payload, created_at) VALUES (?,?,?,?,?)")
      .run(input.id, input.sessionId, input.title, JSON.stringify(input.payload), new Date().toISOString());
  }

  readVisualization(id: string): { id: string; sessionId: string; title: string; payload: unknown } | null {
    const row = this.db.prepare("SELECT * FROM agent_visualizations WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    try {
      return { id: String(row.id), sessionId: String(row.session_id), title: String(row.title), payload: JSON.parse(String(row.payload)) };
    } catch {
      // A row that will not parse is a row written by a version that is gone.
      // The card renders its own "this picture could not be read" rather than
      // the whole transcript failing to draw.
      return null;
    }
  }

  /**
   * A lesson, written down.
   *
   * The same shape as a visualisation — the agent sends a payload, the host
   * keeps it and hands back an id — for the same reason: a turn's teaching has
   * to outlive the turn, and the transcript row can only carry an identity, not
   * a document.
   *
   * What it does that a visualisation does not is file itself against the
   * concept vocabulary. A concept is the one name shared by what Spar tested and
   * what Spar explained, so tagging here is what lets a concept card say "taught
   * on the 3rd, tested on the 5th" instead of holding only the half of the
   * record that came from challenges.
   */
  saveLesson(input:{id:string;sessionId:string;title:string;summary:string;concepts:string[];payload:unknown}):void{
    this.db.transaction(()=>{
      this.db.prepare("INSERT OR REPLACE INTO lessons (id,session_id,title,summary,payload,created_at) VALUES (?,?,?,?,?,?)")
        .run(input.id,input.sessionId,input.title,input.summary,JSON.stringify(input.payload),new Date().toISOString());
      this.db.prepare("DELETE FROM lesson_concepts WHERE lesson_id=?").run(input.id);
      const insert=this.db.prepare("INSERT OR IGNORE INTO lesson_concepts (lesson_id,concept_id) VALUES (?,?)");
      for(const slug of input.concepts.slice(0,5))insert.run(input.id,this.ensureConcept({slug}).id);
    })();
  }

  readLesson(id:string):{id:string;sessionId:string;title:string;summary:string;createdAt:string;payload:unknown}|null{
    const row=this.db.prepare("SELECT * FROM lessons WHERE id=?").get(id) as Record<string,unknown>|undefined;
    if(!row)return null;
    try{
      return {id:String(row.id),sessionId:String(row.session_id),title:String(row.title),summary:String(row.summary),createdAt:String(row.created_at),payload:JSON.parse(String(row.payload))};
    }catch{
      // Same rule as a visualisation: a row written by a version that is gone
      // draws its own "this could not be read" rather than failing the thread.
      return null;
    }
  }

  /** What Spar has already taught near a topic, newest first. This is what stops
   *  the agent teaching the same idea twice and what lets it say "I showed you
   *  this" with something the learner can actually open. */
  searchLessons(query:string,limit=6):Array<{id:string;title:string;summary:string;concepts:string[];createdAt:string}>{
    const term=`%${query.trim().toLowerCase()}%`;
    const rows=this.db.prepare(`SELECT DISTINCT l.id,l.title,l.summary,l.created_at FROM lessons l LEFT JOIN lesson_concepts lc ON lc.lesson_id=l.id LEFT JOIN concepts c ON c.id=lc.concept_id WHERE ?='%%' OR lower(l.title) LIKE ? OR lower(l.summary) LIKE ? OR lower(c.slug) LIKE ? OR lower(c.title) LIKE ? ORDER BY l.created_at DESC LIMIT ?`)
      .all(term,term,term,term,term,Math.max(1,Math.min(limit,12))) as Array<{id:string;title:string;summary:string;created_at:string}>;
    const tags=this.db.prepare("SELECT lc.lesson_id,c.slug FROM lesson_concepts lc JOIN concepts c ON c.id=lc.concept_id");
    const bySlug=new Map<string,string[]>();
    for(const tag of tags.all() as Array<{lesson_id:string;slug:string}>){
      bySlug.set(tag.lesson_id,[...(bySlug.get(tag.lesson_id)??[]),tag.slug]);
    }
    return rows.map((row)=>({id:row.id,title:row.title,summary:row.summary,concepts:bySlug.get(row.id)??[],createdAt:row.created_at}));
  }

  /**
   * The lesson a challenge is following on from, if there is one.
   *
   * The link is made by concept rather than declared, because the declaration is
   * the thing that would be forgotten: an agent that has just spent a turn
   * authoring a challenge is not reliably going to remember to name the lesson it
   * wrote two turns ago. The tags are already there and already mean the same
   * thing on both sides, so the join is free and cannot drift.
   *
   * Newest first, one result: a challenge tests one idea, and the most recent
   * lesson about that idea is the one the learner has just read.
   */
  lessonForConcepts(slugs:string[],trackId?:string|null):{id:string;title:string;summary:string;taughtAt:string}|null{
    const scope=this.learningTrackId(trackId);
    const wanted=slugs.map((slug)=>slug.trim().toLowerCase()).filter(Boolean).slice(0,5);
    if(!scope||!wanted.length)return null;
    const holes=wanted.map(()=>"?").join(",");
    const row=this.db.prepare(`SELECT l.id,l.title,l.summary,l.created_at FROM lessons l JOIN sessions s ON s.id=l.session_id JOIN lesson_concepts lc ON lc.lesson_id=l.id JOIN concepts c ON c.id=lc.concept_id WHERE s.track_id=? AND lower(c.slug) IN (${holes}) ORDER BY l.created_at DESC LIMIT 1`)
      .get(scope,...wanted) as {id:string;title:string;summary:string;created_at:string}|undefined;
    return row?{id:row.id,title:row.title,summary:row.summary,taughtAt:row.created_at}:null;
  }

  /**
   * What Spar has taught on this Track lately, for the turn's own context.
   *
   * Carried unconditionally the way `recentChallengeCoverage` is, and for the
   * mirror-image reason. A lesson the agent cannot see is a lesson it will teach
   * again under a new title — and, worse, it is a lesson it cannot point back at,
   * which is the whole of what makes one worth writing. The id is here because
   * the reference the agent writes is built from it.
   */
  recentLessons(limit=6,trackId?:string|null):Array<{id:string;title:string;summary:string;concepts:string[];taughtAt:string}>{
    const scope=this.learningTrackId(trackId);
    if(!scope)return [];
    const rows=this.db.prepare("SELECT l.id,l.title,l.summary,l.created_at FROM lessons l JOIN sessions s ON s.id=l.session_id WHERE s.track_id=? ORDER BY l.created_at DESC LIMIT ?")
      .all(scope,Math.max(1,Math.min(limit,12))) as Array<{id:string;title:string;summary:string;created_at:string}>;
    const tag=this.db.prepare("SELECT c.slug FROM lesson_concepts lc JOIN concepts c ON c.id=lc.concept_id WHERE lc.lesson_id=?");
    return rows.map((row)=>({id:row.id,title:row.title,summary:row.summary,concepts:(tag.all(row.id) as Array<{slug:string}>).map((entry)=>entry.slug),taughtAt:row.created_at}));
  }

  learnerProgress(trackId?:string|null):LearnerProgress{const scope=this.learningTrackId(trackId);const history=this.ratingHistory();const rating=history.at(-1)??this.ensureRating();return{rating,ratingHistory:history.length?history:[rating],abilities:this.abilityStates(scope),patterns:this.listPatterns(scope),notices:this.listNotices(6,scope)};}
  progressByTrack(){return Object.fromEntries(this.listTracks().map((track)=>[track.id,this.learnerProgress(track.id)]));}

  getBaseline():BaselineState{return baselineStateSchema.catch({status:"not-started",confidence:0,directEvidenceCount:0,importedEvidenceCount:0,completedAt:null,sessionId:null}).parse(this.getSetting("baseline-state",{status:"not-started",confidence:0,directEvidenceCount:0,importedEvidenceCount:0,completedAt:null,sessionId:null}));}
  setBaseline(input:Partial<BaselineState>){const previous=this.getBaseline();const next=baselineStateSchema.parse({...previous,...input});this.setSetting("baseline-state",next);this.queueLearningState();return next;}
  getTrainingMode():TrainingMode{return trainingModeSchema.catch({kind:"recommended"}).parse(this.getSetting("training-mode",{kind:"recommended"}));}
  setTrainingMode(mode:TrainingMode){const parsed=trainingModeSchema.parse(mode);this.setSetting("training-mode",parsed);this.queueLearningState();return parsed;}

  todayRecommendation():TodayRecommendation|null{
    const track=this.activeTrack();if(!track)return null;
    const mode=this.getTrainingMode();
    const session=this.db.prepare("SELECT id FROM sessions WHERE track_id=? AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 1").get(track.id) as {id:string}|undefined;
    const detail=session?this.readSession(session.id):null;
    const question=detail?.question;
    const rawTarget=session?this.latestTarget(session.id):null;
    const target=rawTarget?normalizeTarget(rawTarget):null;
    const source=question?.source?.source??"spar";
    const ability=target?this.abilityStates().find((item)=>item.abilityId===target.abilityId):undefined;
    const intent=target?.action??((ability?.confidence??0)<0.45?"diagnose":"practise");
    const challengeTitle=question?.title??`Continue ${track.title}`;
    const reason=question
      ? `${intentCopy(intent)} ${target?.specificGap??question.specificGap}`
      : "Spar is reviewing this Track's evidence before it chooses a narrowly matched challenge.";
    const recommendation={id:question?.id??track.id,trackId:track.id,trackTitle:track.title,sessionId:session?.id??null,questionId:question?.id??null,challengeTitle,abilityId:target?.abilityId??null,abilityTitle:target?.abilityTitle??track.priorities[0]??"Initial direction",intent,source,reason,reasoning:[`Training intent: ${intentCopy(intent)}`,ability?`Confidence is ${Math.round(ability.confidence*100)}% from ${ability.evidenceCount} linked evidence item${ability.evidenceCount===1?"":"s"}.`:"This ability is still unknown, so Spar is seeking clean diagnostic evidence.",question?.source?`${question.source.source==="leetcode"?"LeetCode":"Codeforces"} provides the best current fit and its own judge.`:"A Spar challenge keeps unrelated difficulty from obscuring the target."],mode,createdAt:new Date().toISOString()} satisfies TodayRecommendation;
    const existing=this.db.prepare("SELECT id FROM training_decisions WHERE id=?").get(recommendation.id);
    if(!existing){this.db.prepare("INSERT INTO training_decisions (id,track_id,session_id,ability_id,intent,reason,mode,candidate_snapshot,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(recommendation.id,track.id,session?.id??null,target?.abilityId??null,intent,reason,JSON.stringify(mode),JSON.stringify([{title:challengeTitle,source,selected:true}]),recommendation.createdAt);this.queueLearningState();}
    return recommendation;
  }
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
      machine:this.abilityStates().find((item)=>item.abilityId===id),
      learnerEvidence:this.evidenceForAbility(id),
      patterns:this.listPatterns(row.track_id).filter((item)=>item.abilityId===id),
    };
  }
  queueAbilitySync(id:string){const row=this.abilityRow(id);if(row)this.enqueue("ability-upsert",{id:row.id,trackId:row.track_id,title:row.title,markdown:row.markdown,version:row.version,status:row.status,summary:row.summary,earnedAt:row.earned_at,updatedAt:row.updated_at,concepts:this.abilityConcepts(id).map((tag)=>tag.slug),evidenceEventIds:JSON.parse(row.evidence_ids)});}
  private abilityRow(id:string){return this.db.prepare("SELECT id,title,markdown,version,status,updated_at,evidence_ids,summary,practice,earned_at,track_id FROM ability_documents WHERE id=?").get(id) as AbilityRow|undefined;}
  private abilityConcepts(id:string):ConceptTag[]{return this.abilityConceptRows(id).get(id)??[];}
  private abilityConceptRows(id?:string){
    const rows=this.db.prepare(`SELECT ac.ability_id key,c.slug,c.title,c.kind,c.parent_slug,p.title parent_title FROM ability_concepts ac JOIN concepts c ON c.id=ac.concept_id LEFT JOIN concepts p ON p.slug=c.parent_slug${id?" WHERE ac.ability_id=?":""} ORDER BY c.title`).all(...(id?[id]:[]) as []) as Array<{key:string;slug:string;title:string;kind:string;parent_slug:string|null;parent_title:string|null}>;
    const grouped=new Map<string,ConceptTag[]>();
    for(const row of rows)grouped.set(row.key,[...(grouped.get(row.key)??[]),{slug:row.slug,title:row.title,kind:row.kind as ConceptKind,parentSlug:row.parent_slug,parentTitle:row.parent_title,role:"primary" as const}]);
    return grouped;
  }
  private toAbility(row:AbilityRow,concepts:ConceptTag[]):AbilityHistorySummary{return {id:row.id,title:row.title,markdown:row.markdown,summary:row.summary,version:row.version,status:row.status,evidenceCount:(JSON.parse(row.evidence_ids) as string[]).length,concepts,practice:JSON.parse(row.practice) as string[],earnedAt:row.earned_at,updatedAt:row.updated_at};}
  listChallenges():ChallengeHistorySummary[]{const tags=this.conceptTagRows("",[]);const rows=this.db.prepare(`SELECT q.id,q.session_id,s.title session_title,q.ordinal,q.title,q.language,q.difficulty,q.status,q.replaces_question_id,q.source_ref,parent.title replaces_question_title,child.id replaced_by_question_id,child.title replaced_by_question_title,q.created_at,COALESCE(MAX(a.completed_at),q.created_at) updated_at,COUNT(DISTINCT a.id) attempt_count,(SELECT COUNT(*) FROM attempt_events te JOIN attempts ta ON ta.id=te.attempt_id WHERE ta.question_id=q.id AND te.type='test_run' AND te.sequence>=(SELECT MAX(start.sequence) FROM attempt_events start WHERE start.attempt_id=te.attempt_id AND start.type='attempt_started')) test_run_count,(SELECT COUNT(*) FROM attempt_events he JOIN attempts ha ON ha.id=he.attempt_id WHERE ha.question_id=q.id AND he.type='hint_requested') hint_count,(SELECT json_extract(te.payload,'$.outcome') FROM attempt_events te JOIN attempts ta ON ta.id=te.attempt_id WHERE ta.question_id=q.id AND te.type='attempt_completed' AND te.sequence>=(SELECT MAX(start.sequence) FROM attempt_events start WHERE start.attempt_id=te.attempt_id AND start.type='attempt_started') ORDER BY te.occurred_at DESC LIMIT 1) last_outcome,(SELECT CAST(MAX(0,(julianday(done.completed_at)-julianday(done.started_at))*86400000) AS INTEGER) FROM attempts done WHERE done.question_id=q.id AND done.completed_at IS NOT NULL ORDER BY done.completed_at DESC LIMIT 1) elapsed_ms,(SELECT json_extract(te.payload,'$.passedCases') FROM attempt_events te JOIN attempts ta ON ta.id=te.attempt_id WHERE ta.question_id=q.id AND te.type='test_run' ORDER BY te.occurred_at DESC LIMIT 1) passed_cases,(SELECT COALESCE(json_extract(te.payload,'$.totalCases'),json_extract(te.payload,'$.passedCases')+json_extract(te.payload,'$.failedCases'),json_array_length(json_extract(te.payload,'$.cases'))) FROM attempt_events te JOIN attempts ta ON ta.id=te.attempt_id WHERE ta.question_id=q.id AND te.type='test_run' ORDER BY te.occurred_at DESC LIMIT 1) total_cases FROM questions q JOIN sessions s ON s.id=q.session_id LEFT JOIN questions parent ON parent.id=q.replaces_question_id LEFT JOIN questions child ON child.replaces_question_id=q.id LEFT JOIN attempts a ON a.question_id=q.id GROUP BY q.id ORDER BY updated_at DESC`).all() as Array<Record<string,unknown>>;return rows.map((row)=>({id:String(row.id),sessionId:String(row.session_id),sessionTitle:String(row.session_title),ordinal:Number(row.ordinal),title:String(row.title),language:String(row.language) as ChallengeHistorySummary["language"],difficulty:String(row.difficulty) as ChallengeHistorySummary["difficulty"],status:String(row.status) as ChallengeHistorySummary["status"],replacesQuestionId:row.replaces_question_id?String(row.replaces_question_id):null,replacesQuestionTitle:row.replaces_question_title?String(row.replaces_question_title):null,replacedByQuestionId:row.replaced_by_question_id?String(row.replaced_by_question_id):null,replacedByQuestionTitle:row.replaced_by_question_title?String(row.replaced_by_question_title):null,attemptCount:Number(row.attempt_count),testRunCount:Number(row.test_run_count),elapsedMs:row.elapsed_ms===null?null:Number(row.elapsed_ms),passedCases:row.passed_cases===null?null:Number(row.passed_cases),totalCases:row.total_cases===null?null:Number(row.total_cases),lastOutcome:row.last_outcome?String(row.last_outcome) as ChallengeHistorySummary["lastOutcome"]:null,assistance:row.last_outcome?(Number(row.hint_count)>0?"assisted":"independent"):"unknown",concepts:tags.get(String(row.id))??[],source:parseSourceRef(row.source_ref as string|null),createdAt:String(row.created_at),updatedAt:String(row.updated_at)}));}
  /**
   * The shelf, newest first.
   *
   * Ordered by when it was saved rather than by anything about the problem: the
   * list answers "what did I put aside", and a shelf sorted by difficulty is a
   * shelf you have to search to find the thing you filed a minute ago.
   */
  listSavedProblems():SavedProblem[]{
    const rows=this.db.prepare("SELECT key,snapshot,saved_at FROM saved_problems ORDER BY saved_at DESC").all() as Array<{key:string;snapshot:string;saved_at:string}>;
    return rows.flatMap((row)=>{
      /* A row whose snapshot no longer parses is dropped from the answer rather
         than crashing the page that asked for it: this is filing, and a shelf
         that fails to open because one card on it is unreadable is worse than a
         shelf missing that card. */
      const parsed=savedProblemSchema.safeParse({key:row.key,savedAt:row.saved_at,snapshot:row.snapshot?JSON.parse(row.snapshot) as unknown:null});
      return parsed.success?[parsed.data]:[];
    });
  }
  /** Saving is idempotent and keeps the original moment: pressing the bookmark on
   *  a problem already saved must not quietly move it to the top of the shelf. */
  setProblemSaved(key:string,saved:boolean,snapshot:SavedProblem["snapshot"]=null):SavedProblem[]{
    if(!saved)this.db.prepare("DELETE FROM saved_problems WHERE key=?").run(key);
    else this.db.prepare("INSERT INTO saved_problems (key,snapshot,saved_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET snapshot=excluded.snapshot").run(key,snapshot?JSON.stringify(snapshot):"",this.stamp());
    return this.listSavedProblems();
  }
  /** Concepts are part of what a challenge *is*, so they are searchable text: the
   *  agent looking for "sliding window" evidence has to find the challenges that
   *  were tagged with it even when the title never says the words. */
  searchChallenges(query:string,limit:number,trackId?:string|null){const terms=searchTerms(query);const scope=this.learningTrackId(trackId);const sessionIds=new Set(this.listSessions().filter((session)=>session.trackId===scope).map((session)=>session.id));const rows=this.listChallenges().filter((row)=>sessionIds.has(row.sessionId));if(!terms.length)return rows.slice(0,limit);return rows.map((row)=>({row,score:relevance(`${row.title}\n${row.sessionTitle}\n${row.difficulty}\n${row.lastOutcome??""}\n${row.concepts.map((tag)=>`${tag.slug.replace(/-/g," ")} ${tag.title} ${tag.parentTitle??""}`).join("\n")}`,terms)})).filter((item)=>item.score>0).sort((a,b)=>b.score-a.score||b.row.updatedAt.localeCompare(a.row.updatedAt)).slice(0,limit).map((item)=>item.row);}
  /** What the learner has actually been asked lately, across every session,
   *  flattened to the fields a targeting decision needs.
   *
   *  Deliberately not a search: a search only answers the question the agent
   *  thought to ask, and the failure this exists to prevent is a new goal that
   *  never thinks to ask. Carried on every planning turn's context so the same
   *  primary concept coming back for the thirteenth time is visible before the
   *  target is set rather than after the challenge is published. */
  /**
   * How far the session has got on the target it is currently working.
   *
   * The agent already sees the last dozen challenges and the active target, and
   * can in principle notice it has asked the same thing twelve times — but it
   * has to infer that from a list of titles, and it does not. One session in the
   * wild ran thirteen challenges against a single target over eight days while
   * the ability it was aimed at never left "developing": every individual turn
   * was a defensible call, and nobody was counting.
   *
   * So the counting happens here. These are facts about what has happened, not
   * a budget or a threshold — what to do about a target that four challenges
   * have not settled stays the agent's judgement, and a fifth challenge is a
   * legitimate answer. It just has to be a decision rather than an oversight.
   */
  targetProgress(sessionId:string){
    const target=this.latestTarget(sessionId);
    if(!target)return null;
    const abilityId=String(target.ability_id);
    const rows=this.db.prepare(`SELECT ch.outcome, ch.created_at FROM (${CHALLENGE_OUTCOME_SQL}) ch WHERE ch.training_target_id=? ORDER BY ch.created_at`).all(String(target.id)) as Array<{outcome:string;created_at:string}>;
    const ability=this.abilityRow(abilityId);
    /* Challenges set since the ability document last changed. The ability moving
       is the only thing that says a challenge taught anybody anything; a run of
       them with a flat document is the shape of a session going nowhere. */
    const since=ability?rows.filter((row)=>row.created_at>ability.updated_at).length:rows.length;
    return {
      abilityTitle:String(target.ability_title),
      desiredEvidence:String(target.desired_evidence),
      setAt:String(target.created_at),
      challengesSet:rows.length,
      passed:rows.filter((row)=>row.outcome==="passed").length,
      failed:rows.filter((row)=>row.outcome==="failed").length,
      abilityStatus:ability?.status??"uncertain",
      abilityVersion:ability?.version??0,
      challengesSinceAbilityChanged:since,
    };
  }
  /**
   * A timestamp strictly later than any this store has already issued.
   *
   * ISO-8601 carries milliseconds, and the sequence that matters here happens
   * faster than one: the agent writes the ability document and then creates the
   * challenge that follows it, and on a quick machine both land in the same
   * millisecond. `targetProgress` then asks which came first by comparing the
   * two strings, gets a tie, and reports that no challenge has been set since
   * the ability last changed — the one number that is supposed to say whether
   * the current approach is producing anything.
   *
   * The order of those two writes is a fact about the sequence, not about the
   * clock, so the clock is not asked to settle it. Only the two writes whose
   * relative order is read back use this; everything else still stamps the wall
   * clock directly, because nothing compares those to each other.
   */
  private stamp(){const now=new Date().toISOString();const next=now>this.lastStamp?now:new Date(Date.parse(this.lastStamp)+1).toISOString();this.lastStamp=next;return next;}

  recentChallengeCoverage(limit=12,trackId?:string|null){return this.searchChallenges("",limit,trackId).map((row)=>({title:row.title,goal:row.sessionTitle,primaryConcept:row.concepts[0]?.slug??null,difficulty:row.difficulty,outcome:row.lastOutcome,askedAt:row.createdAt}));}
  /** Whether this exact title has been asked before anywhere. The session-scoped
   *  check let the same challenge come back under a new session, which is what
   *  the learner sees as repetition — the library is one library to them. */
  challengeTitleUsed(title:string,trackId?:string|null){const normalized=title.trim().toLocaleLowerCase();const scope=this.learningTrackId(trackId);if(!normalized||!scope)return false;const rows=this.db.prepare("SELECT q.title FROM questions q JOIN sessions s ON s.id=q.session_id WHERE s.track_id=?").all(scope) as Array<{title:string}>;return rows.some((row)=>row.title.trim().toLocaleLowerCase()===normalized);}
  readChallenge(id:string){const row=this.db.prepare("SELECT q.*,s.title session_title FROM questions q JOIN sessions s ON s.id=q.session_id WHERE q.id=?").get(id) as (QuestionRow&{session_title:string;validation_report:string})|undefined;if(!row)return null;const attempts=this.db.prepare("SELECT id,status,started_at,completed_at FROM attempts WHERE question_id=? ORDER BY started_at").all(id) as Array<Record<string,unknown>>;return{...row,sessionTitle:row.session_title,concepts:this.questionConcepts(id),design:JSON.parse(row.design),validationReport:JSON.parse(row.validation_report),attempts:attempts.map((attempt)=>({...attempt,events:this.readAttempt(String(attempt.id))}))};}
  /** One challenge with everything it needs to stand on its own away from its
   *  session: the design it was compiled from, the goal and target it answers,
   *  and every attempt at it in order. Read by the standalone challenge page,
   *  which practises against a sandbox and so never touches an attempt. */
  challengeRecord(id:string){
    const row=this.db.prepare("SELECT q.id,q.session_id,q.training_target_id,q.statement,q.kind,q.design,q.validation_report,q.source_ref,s.original_goal,s.status session_status FROM questions q JOIN sessions s ON s.id=q.session_id WHERE q.id=?").get(id) as {id:string;session_id:string;training_target_id:string;statement:string;kind:QuestionRow["kind"];design:string;validation_report:string;source_ref:string|null;original_goal:string;session_status:SessionSummary["status"]}|undefined;
    if(!row)return null;
    const target=this.db.prepare("SELECT ability_title,specific_gap,desired_evidence,action FROM training_targets WHERE id=?").get(row.training_target_id) as {ability_title:string;specific_gap:string;desired_evidence:string;action:TrainingTarget["action"]}|undefined;
    const attempts=(this.db.prepare("SELECT id FROM attempts WHERE question_id=? ORDER BY started_at").all(id) as Array<{id:string}>).map((attempt,index)=>({ordinal:index+1,events:this.readAttempt(attempt.id)}));
    return{sessionId:row.session_id,statement:row.statement,kind:row.kind,design:JSON.parse(row.design) as QuestionDesign,hiddenTestCount:validatedHiddenCaseCount(row.validation_report),source:parseSourceRef(row.source_ref),sessionGoal:row.original_goal,sessionStatus:row.session_status,abilityTitle:target?.ability_title??"",specificGap:target?.specific_gap??"",desiredEvidence:target?.desired_evidence??"",action:target?.action??null,attempts};
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
  assignedPracticeProblems(limit=40,trackId?:string|null){
    const scope=this.learningTrackId(trackId);if(!scope)return[];
    return (this.db.prepare(`SELECT q.source_ref,q.title,q.status,ch.outcome,ch.updated_at FROM questions q JOIN (${CHALLENGE_OUTCOME_SQL}) ch ON ch.id=q.id JOIN sessions s ON s.id=q.session_id WHERE q.source_ref IS NOT NULL AND s.track_id=? ORDER BY ch.updated_at DESC LIMIT ?`).all(scope,limit) as Array<{source_ref:string;title:string;status:string;outcome:string;updated_at:string}>)
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
  listConcepts(trackId?:string|null):ConceptSummary[]{
    const index=this.conceptIndex(trackId);
    return index.rows
      .map((row)=>index.summarize(row))
      .filter((summary)=>summary.challengeCount>0||summary.abilityCount>0)
      .sort((left,right)=>right.challengeCount-left.challengeCount||(right.lastSeenAt??"").localeCompare(left.lastSeenAt??"")||left.title.localeCompare(right.title));
  }

  conceptDetail(slug:string,trackId?:string|null):ConceptDetail|null{
    const index=this.conceptIndex(trackId);
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
  conceptGraph(query:string,limit=14,trackId?:string|null):Array<ConceptSummary&{standing:string}>{
    const index=this.conceptIndex(trackId);
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
  conceptEvidenceReport(query:string,limit=4,trackId?:string|null){
    const index=this.conceptIndex(trackId);
    const slug=conceptSlug(query);
    const direct=index.bySlug.get(slug);
    const targets=direct?[direct]:this.conceptGraph(query,limit,trackId).flatMap((summary)=>{const row=index.bySlug.get(summary.slug);return row?[row]:[];});
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
  conceptChallenges(slug:string,limit=40,trackId?:string|null):ConceptEvidence[]{
    const index=this.conceptIndex(trackId);
    const row=index.bySlug.get(conceptSlug(slug));
    return row?index.evidence(row).slice(0,limit):[];
  }

  /**
   * One pass over the tagged history, shared by every concept read. Rollups are
   * done here rather than in SQL because a sub-concept's evidence has to count
   * for its area *without* being double-counted when a challenge is tagged with
   * both — which is a de-duplication, not an aggregate.
   */
  private conceptIndex(trackId?:string|null){
    const scope=this.learningTrackId(trackId);
    const rows=this.db.prepare("SELECT id,slug,title,kind,parent_slug,description FROM concepts ORDER BY title").all() as ConceptRow[];
    const bySlug=new Map(rows.map((row)=>[row.slug,row]));
    const children=new Map<string,ConceptRow[]>();
    for(const row of rows)if(row.parent_slug)children.set(row.parent_slug,[...(children.get(row.parent_slug)??[]),row]);
    const tagged=this.db.prepare(`SELECT qc.concept_id,qc.role,ch.id question_id,ch.session_id,s.title session_title,ch.title,ch.language,ch.difficulty,ch.outcome,ch.attempt_count,ch.test_run_count,ch.created_at,ch.updated_at occurred_at,(SELECT COUNT(*) FROM questions child WHERE child.replaces_question_id=ch.id) replaced FROM question_concepts qc JOIN (${CHALLENGE_OUTCOME_SQL}) ch ON ch.id=qc.question_id JOIN sessions s ON s.id=ch.session_id WHERE s.track_id IS ?`).all(scope) as TaggedChallengeRow[];
    const byConcept=new Map<string,TaggedChallengeRow[]>();
    for(const row of tagged)byConcept.set(row.concept_id,[...(byConcept.get(row.concept_id)??[]),row]);
    const abilityRows=this.db.prepare("SELECT ac.concept_id,a.id,a.title,a.status FROM ability_concepts ac JOIN ability_documents a ON a.id=ac.ability_id WHERE a.track_id IS ?").all(scope) as Array<{concept_id:string;id:string;title:string;status:string}>;
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
  pendingSync(limit=100){return this.db.prepare("SELECT id,kind,payload,attempts FROM sync_outbox ORDER BY created_at,rowid LIMIT ?").all(limit) as Array<{id:string;kind:string;payload:string;attempts:number}>;}
  acknowledgeSync(ids:string[]){const remove=this.db.prepare("DELETE FROM sync_outbox WHERE id=?");this.db.transaction(()=>ids.forEach(id=>remove.run(id)))();}
  markSyncFailed(id:string){this.db.prepare("UPDATE sync_outbox SET attempts=attempts+1 WHERE id=?").run(id);}
  /** Agent telemetry uses the same durable, authenticated outbox as learner
   * state. Exposing only this narrow method keeps arbitrary callers from
   * inventing sync kinds while still allowing the recorder to checkpoint a
   * long run before the utility process or laptop can disappear. */
  queueAgentTelemetry(kind:"agent-run-start"|"agent-trace-event"|"agent-run-finish",payload:unknown){this.enqueue(kind,payload);}
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
  learningEngineSnapshot(){const trackId=this.activeTrack()?.id??null;return{baseline:this.getBaseline(),trainingMode:this.getTrainingMode(),activeTrack:this.activeTrack(),abilityState:this.abilityStates(trackId),evidence:this.db.prepare("SELECT e.* FROM learner_evidence e JOIN ability_documents a ON a.id=e.ability_id WHERE a.track_id IS ? ORDER BY e.occurred_at DESC LIMIT 100").all(trackId),patterns:this.listPatterns(trackId),decisions:this.db.prepare("SELECT * FROM training_decisions WHERE track_id IS ? ORDER BY created_at DESC LIMIT 50").all(trackId),notices:this.listNotices(20,trackId),rating:this.ratingHistory(),model:{schemaVersion:4,policyVersion:"adaptive-policy-v1",abilityRegistry:"concept-taxonomy-v1"}};}
  cloudLearningState(){const tracks=this.listTracks();return{version:2,updatedAt:new Date().toISOString(),tracks,activeTrackId:this.activeTrack()?.id??null,sessionTracks:this.db.prepare("SELECT id sessionId,track_id trackId FROM sessions WHERE track_id IS NOT NULL").all(),abilityTracks:this.db.prepare("SELECT id abilityId,track_id trackId FROM ability_documents WHERE track_id IS NOT NULL").all(),baseline:this.getBaseline(),trainingMode:this.getTrainingMode(),abilityState:tracks.flatMap((track)=>this.abilityStates(track.id)),evidence:this.db.prepare("SELECT * FROM learner_evidence").all(),patterns:this.db.prepare("SELECT * FROM learner_patterns").all(),patternEvidence:this.db.prepare("SELECT * FROM pattern_evidence").all(),notices:this.db.prepare("SELECT * FROM learner_notices").all(),rating:this.db.prepare("SELECT * FROM rating_points").all(),decisions:this.db.prepare("SELECT * FROM training_decisions").all()};}
  queueLearningState(){if(this.restoring)return;this.db.prepare("DELETE FROM sync_outbox WHERE kind='learning-state'").run();this.enqueue("learning-state",this.cloudLearningState());}
  restoreLearningState(value:unknown){if(!value||typeof value!=="object")return;const state=value as Record<string,unknown>;const tracks=Array.isArray(state.tracks)?state.tracks:[];
    /* A restore runs before the outbox flush. If this device has a pending
       snapshot, it is the only copy that can contain its offline work; replacing
       it with the cloud document would silently move the learner model backward. */
    if(this.db.prepare("SELECT 1 FROM sync_outbox WHERE kind='learning-state' LIMIT 1").get())return;
    this.inRestore(()=>{this.db.prepare("UPDATE sessions SET track_id=NULL").run();for(const table of ["pattern_evidence","learner_patterns","learner_evidence","learner_notices","training_decisions","rating_points","learner_ability_state","tracks"])this.db.prepare(`DELETE FROM ${table}`).run();/* Columns named rather than positional: this insert silently became wrong the
         moment the table grew a language, and a restore that writes a Track's goal
         into its status column is not a failure anyone would diagnose from here. */
      const insertTrack=this.db.prepare("INSERT INTO tracks (id,title,goal,status,language,emphasis,priorities,investigating,monitoring,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)");for(const item of tracks){const row=item as Track;try{insertTrack.run(row.id,row.title,row.goal,row.status,row.language??null,JSON.stringify(row.emphasis??[]),JSON.stringify(row.priorities??[]),JSON.stringify(row.investigating??[]),JSON.stringify(row.monitoring??[]),row.createdAt,row.updatedAt);}catch{/* Ignore a future track shape. */}}
      const attach=this.db.prepare("UPDATE sessions SET track_id=? WHERE id=?");for(const item of Array.isArray(state.sessionTracks)?state.sessionTracks:[]){const row=item as {sessionId?:unknown;trackId?:unknown};if(typeof row.sessionId==="string"&&typeof row.trackId==="string")attach.run(row.trackId,row.sessionId);}
      const attachAbility=this.db.prepare("UPDATE ability_documents SET track_id=? WHERE id=?");for(const item of Array.isArray(state.abilityTracks)?state.abilityTracks:[]){const row=item as {abilityId?:unknown;trackId?:unknown};if(typeof row.abilityId==="string"&&typeof row.trackId==="string")attachAbility.run(row.trackId,row.abilityId);}
      const ability=this.db.prepare("INSERT OR IGNORE INTO learner_ability_state VALUES (?,?,?,?,?,?,?,?,?,?)");for(const item of Array.isArray(state.abilityState)?state.abilityState:[]){const row=item as LearnerAbilityState;ability.run(row.abilityId,row.proficiency,row.confidence,row.evidenceCount,row.lastEvidenceAt,row.trainingStatus,row.trend,row.currentBelief,row.nextVerification,row.updatedAt);}
      const evidence=this.db.prepare("INSERT OR IGNORE INTO learner_evidence VALUES (?,?,?,?,?,?,?,?,?)");for(const item of Array.isArray(state.evidence)?state.evidence:[]){const row=item as Record<string,unknown>;try{evidence.run(row.id,row.ability_id,row.attempt_id,row.event_id,row.statement,row.polarity,row.independence,row.strength,row.occurred_at);}catch{/* Missing attempts from a partial restore are skipped. */}}
      const pattern=this.db.prepare("INSERT OR IGNORE INTO learner_patterns VALUES (?,?,?,?,?,?,?,?)");for(const item of Array.isArray(state.patterns)?state.patterns:[]){const row=item as Record<string,unknown>;try{pattern.run(row.id,row.title,row.description,row.ability_id,row.status,row.created_at,row.updated_at,row.last_observed_at);}catch{/* Defensive restore. */}}
      const patternLink=this.db.prepare("INSERT OR IGNORE INTO pattern_evidence VALUES (?,?)");for(const item of Array.isArray(state.patternEvidence)?state.patternEvidence:[]){const row=item as Record<string,unknown>;try{patternLink.run(row.pattern_id,row.evidence_id);}catch{/* Defensive restore. */}}
      const notice=this.db.prepare("INSERT OR IGNORE INTO learner_notices (id,title,body,created_at,dismissed_at,track_id) VALUES (?,?,?,?,?,?)");for(const item of Array.isArray(state.notices)?state.notices:[]){const row=item as Record<string,unknown>;notice.run(row.id,row.title,row.body,row.created_at,row.dismissed_at,row.track_id??null);}
      /* The deviation and the volatility travel with the point. Without them a
         restore onto a new device rebuilt every point at the defaults — which
         say "this rating's uncertainty has never been measured" — so an
         established learner came back provisional and their next result moved
         the number like a beginner's. Older snapshots have neither field, and
         those genuinely were never measured, so the defaults are right for them. */
      const rating=this.db.prepare("INSERT OR IGNORE INTO rating_points (id,rating,deviation,volatility,provisional,reason,occurred_at,track_id,question_id) VALUES (?,?,?,?,?,?,?,?,?)");for(const item of Array.isArray(state.rating)?state.rating:[]){const row=item as Record<string,unknown>;rating.run(row.id,row.rating,row.deviation??INITIAL_DEVIATION,row.volatility??INITIAL_VOLATILITY,row.provisional,row.reason,row.occurred_at,row.track_id??null,row.question_id??null);}
      const decision=this.db.prepare("INSERT OR IGNORE INTO training_decisions VALUES (?,?,?,?,?,?,?,?,?)");for(const item of Array.isArray(state.decisions)?state.decisions:[]){const row=item as Record<string,unknown>;try{decision.run(row.id,row.track_id,row.session_id,row.ability_id,row.intent,row.reason,row.mode,row.candidate_snapshot,row.created_at);}catch{/* Defensive restore. */}}
      if(state.baseline){const baseline=baselineStateSchema.safeParse(state.baseline);if(baseline.success){this.setSetting("baseline-state",baseline.data);if(baseline.data.sessionId)this.db.prepare("UPDATE sessions SET context='baseline',track_id=NULL WHERE id=?").run(baseline.data.sessionId);}}if(state.trainingMode)this.setSetting("training-mode",state.trainingMode);if(typeof state.activeTrackId==="string")this.setSetting("active-track-id",state.activeTrackId);
    /* The restored ability states were computed on the device that sent them,
       from evidence this device has now imported and can read for itself. Doing
       so is not a courtesy: a snapshot written before proficiency followed the
       evidence carries the old lookup constants, and restoring it verbatim would
       reintroduce them one machine at a time. */
    });this.backfillTracks();this.backfillLearningTracks();this.reconcileEveryAbility();this.ensureRating();}

  clearAccountData(){this.db.transaction(()=>{for(const table of ["sync_outbox","pattern_evidence","learner_patterns","learner_evidence","learner_notices","training_decisions","rating_points","question_concepts","ability_concepts","attempt_events","checkpoints","agent_messages","session_decisions","session_intake","attempts","questions","training_targets","sessions","learner_ability_state","tracks","ability_documents","learner_profile","practice_problems","practice_problem_links"])this.db.prepare(`DELETE FROM ${table}`).run();
    /* Seeded concepts are shipped vocabulary and stay. A concept the agent
       invented is not: it names something this learner was working on, and
       serving it to whoever signs in next would leak that. */
    this.db.prepare("DELETE FROM concepts WHERE seeded=0").run();})();}
  close(){this.db.close();}

  private createTrackRecord(goal:string,title?:string,language?:Language|null){const cleanGoal=goal.trim();if(cleanGoal.length<3)throw new Error("A Track goal is required");const id=randomUUID();const now=new Date().toISOString();const cleanTitle=(title?.trim()||trackTitle(cleanGoal)).slice(0,80);this.db.prepare("INSERT INTO tracks (id,title,goal,status,language,emphasis,priorities,investigating,monitoring,created_at,updated_at) VALUES (?,?,?,'active',?,'[]','[]','[]','[]',?,?)").run(id,cleanTitle,cleanGoal,language??null,now,now);this.setActiveTrack(id);return this.toTrack(this.db.prepare("SELECT * FROM tracks WHERE id=?").get(id) as TrackRow);}
  private toTrack(row:TrackRow):Track{return{id:row.id,title:row.title,goal:row.goal,status:row.status,language:languageSchema.nullable().catch(null).parse(row.language),emphasis:JSON.parse(row.emphasis) as string[],priorities:JSON.parse(row.priorities) as string[],investigating:JSON.parse(row.investigating) as string[],monitoring:JSON.parse(row.monitoring) as string[],createdAt:row.created_at,updatedAt:row.updated_at};}
  private backfillTracks(){const sessions=this.db.prepare("SELECT id,title,original_goal,created_at,updated_at FROM sessions WHERE track_id IS NULL AND context<>'baseline' ORDER BY updated_at DESC").all() as Array<{id:string;title:string;original_goal:string;created_at:string;updated_at:string}>;if(!sessions.length)return;
    /* Sessions predate Tracks. Treating every old session as a Track would turn
       this new product object into a renamed history list, so one migration
       environment owns the existing corpus. A sole session can retain its
       specific goal; a real history gets the intentionally broad migration goal. */
    const existing=this.activeTrack();const trackId=existing?.id??randomUUID();if(!existing){const newest=sessions[0]!;const oldest=sessions.at(-1)!;const title=sessions.length===1?newest.title.slice(0,80):"General practice";const goal=sessions.length===1?newest.original_goal:"Continue adaptive practice across my existing Spar history.";this.db.prepare("INSERT INTO tracks (id,title,goal,status,emphasis,priorities,investigating,monitoring,created_at,updated_at) VALUES (?,?,?,'active','[]','[]','[]','[]',?,?)").run(trackId,title,goal,oldest.created_at,newest.updated_at);}
    const attach=this.db.prepare("UPDATE sessions SET track_id=? WHERE id=?");this.db.transaction(()=>{for(const session of sessions)attach.run(trackId,session.id);})();if(!this.getSetting<string>("active-track-id",""))this.setSetting("active-track-id",trackId);}
  private normalizeLegacyBaseline(){this.db.prepare("UPDATE sessions SET context='baseline',track_id=NULL WHERE context='training' AND title='Baseline calibration' AND original_goal LIKE 'Build a representative programming baseline with adaptive direct calibration%'").run();this.db.prepare("DELETE FROM tracks WHERE title='Baseline calibration' AND NOT EXISTS (SELECT 1 FROM sessions WHERE sessions.track_id=tracks.id)").run();}
  /** The first Tracks prototype wrapped every historical session in its own
   * Track. That is a renamed history list, not a workspace. Collapse that exact
   * migration shape once; deliberate Tracks have independently-created Track
   * timestamps and are left alone. */
  private migrateLegacyTrackWorkspaces(){if(this.getSetting<boolean>("track-workspace-migration-v2",false))return;const rows=this.db.prepare(`SELECT t.id,s.id session_id,s.created_at,s.updated_at FROM tracks t JOIN sessions s ON s.track_id=t.id WHERE t.goal=s.original_goal AND t.title=substr(s.title,1,80) AND t.created_at=s.created_at AND t.updated_at=s.updated_at AND (SELECT COUNT(*) FROM sessions owned WHERE owned.track_id=t.id)=1`).all() as Array<{id:string;session_id:string;created_at:string;updated_at:string}>;if(rows.length>1){const trackId=randomUUID();const oldest=rows.map((row)=>row.created_at).sort()[0]!;const newest=rows.map((row)=>row.updated_at).sort().at(-1)!;this.db.transaction(()=>{this.db.prepare("INSERT INTO tracks (id,title,goal,status,emphasis,priorities,investigating,monitoring,created_at,updated_at) VALUES (?,? ,?,'active','[]','[]','[]','[]',?,?)").run(trackId,"General practice","Continue adaptive practice across my existing Spar history.",oldest,newest);const attach=this.db.prepare("UPDATE sessions SET track_id=? WHERE id=?");const moveAbilities=this.db.prepare("UPDATE ability_documents SET track_id=? WHERE track_id=?");const moveNotices=this.db.prepare("UPDATE learner_notices SET track_id=? WHERE track_id=?");const moveRatings=this.db.prepare("UPDATE rating_points SET track_id=? WHERE track_id=?");const moveDecisions=this.db.prepare("UPDATE training_decisions SET track_id=? WHERE track_id=?");for(const row of rows){attach.run(trackId,row.session_id);moveAbilities.run(trackId,row.id);moveNotices.run(trackId,row.id);moveRatings.run(trackId,row.id);moveDecisions.run(trackId,row.id);}const remove=this.db.prepare("DELETE FROM tracks WHERE id=?");for(const row of rows)remove.run(row.id);this.setSetting("active-track-id",trackId);})();}this.setSetting("track-workspace-migration-v2",true);}
  private backfillLearningTracks(){const fallback=this.activeTrack()?.id??null;if(!fallback)return;this.db.prepare(`UPDATE ability_documents SET track_id=COALESCE((SELECT s.track_id FROM training_targets t JOIN sessions s ON s.id=t.session_id WHERE t.ability_id=ability_documents.id AND s.track_id IS NOT NULL ORDER BY t.created_at DESC LIMIT 1),?) WHERE track_id IS NULL AND NOT EXISTS (SELECT 1 FROM training_targets t JOIN sessions s ON s.id=t.session_id WHERE t.ability_id=ability_documents.id AND s.context='baseline')`).run(fallback);this.db.prepare("UPDATE learner_notices SET track_id=? WHERE track_id IS NULL").run(fallback);
    /* Ratings are deliberately not backfilled onto a Track. The column only
       records which line of practice produced a point, and the account's opening
       point was produced by none — see `ratingHistory`. */
  }
  private learningTrackId(trackId?:string|null){return trackId===undefined?this.activeTrack()?.id??null:trackId;}
  private trackIdForAbilityTarget(abilityId:string){const row=this.db.prepare("SELECT s.track_id FROM training_targets t JOIN sessions s ON s.id=t.session_id WHERE t.ability_id=? AND s.track_id IS NOT NULL ORDER BY t.created_at DESC LIMIT 1").get(abilityId) as {track_id:string}|undefined;return row?.track_id??null;}
  /**
   * An event linked to an ability with nothing said about it.
   *
   * The polarity comes off the event's own payload and from nowhere else. It
   * used to read the ability's status too — an event on an `uncertain` ability
   * counted against it and one on an `independent` ability counted for it —
   * which was harmless while the status was a count of these rows and circular
   * the moment the status started being derived from their polarity. An event
   * that does not say how it went is now neutral, which is what it is: linked,
   * recorded, and evidence for nothing in particular until somebody interprets
   * it. `propose_ability_update` requires that interpretation, and it upserts
   * over whatever this wrote.
   */
  private recordAbilityEvidence(abilityId:string,eventIds:string[],summary:string){const insert=this.db.prepare("INSERT OR IGNORE INTO learner_evidence (id,ability_id,attempt_id,event_id,statement,polarity,independence,strength,occurred_at) VALUES (?,?,?,?,?,?,?,?,?)");for(const eventId of eventIds){const row=this.db.prepare("SELECT e.id,e.attempt_id,e.occurred_at,e.type,e.payload FROM attempt_events e WHERE e.id=?").get(eventId) as {id:string;attempt_id:string;occurred_at:string;type:string;payload:string}|undefined;const payload=row?JSON.parse(row.payload) as Record<string,unknown>:{};const outcome=String(payload.outcome??"");const polarity=outcome==="failed"?"contradictory":outcome==="passed"?"supporting":"neutral";const independence=payload.assisted===true?"assisted":"unknown";insert.run(randomUUID(),abilityId,row?.attempt_id??null,eventId,summary||`Evidence from ${row?.type??"an attempt"}.`,polarity,independence,polarity==="neutral"?0.45:0.7,row?.occurred_at??new Date().toISOString());}}
  private recordInterpretedEvidence(abilityId:string,items:EvidenceInterpretation[]){const upsert=this.db.prepare("INSERT INTO learner_evidence (id,ability_id,attempt_id,event_id,statement,polarity,independence,strength,occurred_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(ability_id,event_id) DO UPDATE SET statement=excluded.statement,polarity=excluded.polarity,independence=excluded.independence,strength=excluded.strength");for(const item of items){const event=this.db.prepare("SELECT attempt_id,occurred_at FROM attempt_events WHERE id=?").get(item.eventId) as {attempt_id:string;occurred_at:string}|undefined;if(!event)continue;upsert.run(randomUUID(),abilityId,event.attempt_id,item.eventId,item.statement,item.polarity,item.independence,Math.max(0,Math.min(1,item.strength)),event.occurred_at);}}
  private upsertPattern(abilityId:string,input:PatternInterpretation){const eventIds=[...new Set(input.evidenceEventIds)];const evidence=this.db.prepare(`SELECT le.id,le.attempt_id FROM learner_evidence le WHERE le.ability_id=? AND le.event_id IN (${eventIds.map(()=>"?").join(",")||"NULL"})`).all(abilityId,...eventIds) as Array<{id:string;attempt_id:string|null}>;const independentAttempts=new Set(evidence.map((item)=>item.attempt_id).filter(Boolean)).size;let status=input.status;if((status==="pattern"||status==="monitoring"||status==="resolved")&&independentAttempts<2)status=independentAttempts?"hypothesis":"observation";const existing=this.db.prepare("SELECT id,status FROM learner_patterns WHERE lower(title)=lower(?) AND ability_id=?").get(input.title,abilityId) as {id:string;status:string}|undefined;const id=existing?.id??randomUUID();const now=new Date().toISOString();this.db.prepare("INSERT INTO learner_patterns (id,title,description,ability_id,status,created_at,updated_at,last_observed_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET description=excluded.description,status=excluded.status,updated_at=excluded.updated_at,last_observed_at=excluded.last_observed_at").run(id,input.title,input.description,abilityId,status,now,now,evidence.length?now:null);const link=this.db.prepare("INSERT OR IGNORE INTO pattern_evidence (pattern_id,evidence_id) VALUES (?,?)");for(const item of evidence)link.run(id,item.id);if(existing&&existing.status!==status)this.addNotice(`${input.title} is now ${status}`,input.description,this.trackIdForAbilityTarget(abilityId)??this.abilityRow(abilityId)?.track_id);}
  /**
   * What the evidence says on its own, before anybody's judgement is applied.
   *
   * `status` on the document is the agent's call and stays the agent's call —
   * it is the pedagogical statement, and the agent has the replay, the code and
   * the conversation to make it with. This is the second opinion: the same rows
   * read arithmetically, so the two can be compared rather than conflated.
   *
   * They used to be one channel. `status` was the agent's word, `proficiency`
   * was a four-entry lookup on that word, and the rating was a mean of those
   * constants — so a judgement went in one end and came out the other looking
   * like a measurement. Worse, the status the agent did not set defaulted to a
   * count of linked events, three of which earned `independent` whether they
   * were passes or failures. The number that was supposed to check the
   * intuition was the intuition, rounded.
   *
   * Weighting, in one place:
   *
   * - `strength` is the interpreter's own confidence in the reading.
   * - Recency halves every `ABILITY_EVIDENCE_HALF_LIFE_DAYS`, so a claim about
   *   the present tense rests on evidence about the present tense.
   * - Independence discounts what an ability *claims* and never what
   *   contradicts it: solving it with help proves less about solving it alone,
   *   and failing it with help is not less of a failure.
   *
   * Smoothed as `(supporting + 0.5) / (graded + 1)` — the same formula the
   * concept bars use, so "steady" on a concept and a proficiency on an ability
   * cannot come to mean two different things. One pass is encouraging rather
   * than conclusive, and the scale cannot reach 1.
   */
  private abilityReading(abilityId:string,now=Date.now()){
    const rows=this.evidenceForAbility(abilityId);
    let supporting=0,contradicting=0,observed=0;
    for(const row of rows){
      const age=(now-Date.parse(row.occurredAt))/86_400_000;
      const recency=Number.isFinite(age)?Math.pow(0.5,Math.max(0,age)/ABILITY_EVIDENCE_HALF_LIFE_DAYS):1;
      /* Volume is volume: an assisted solve is still something Spar watched, so
         it builds confidence even where it is discounted as proof. */
      const seen=row.strength*recency;
      observed+=seen;
      if(row.polarity==="supporting")supporting+=seen*(row.independence==="independent"?1:row.independence==="assisted"?0.5:0.8);
      else if(row.polarity==="contradictory")contradicting+=seen;
    }
    const graded=supporting+contradicting;
    return {
      proficiency:graded>0?(supporting+0.5)/(graded+1):0.5,
      confidence:Math.min(0.96,1-Math.exp(-observed/2)),
      graded,supporting,contradicting,observations:rows.length,
    };
  }

  /**
   * The status the evidence alone would give, for when the agent does not say.
   *
   * A floor rather than a verdict: the agent may set any status it likes and
   * this never runs. It exists so that the *absence* of a judgement resolves to
   * something the rows actually support instead of to how many of them there
   * are. `uncertain` when nothing has graded this at all, `independent` only
   * when the evidence both leans that way and there is enough of it.
   */
  private abilityStatusFromEvidence(abilityId:string):AbilityStatus{
    const reading=this.abilityReading(abilityId);
    if(reading.graded<=0)return "uncertain";
    return reading.proficiency>=0.7&&reading.confidence>=0.6?"independent":"developing";
  }

  private reconcileAbilityState(abilityId:string){const ability=this.abilityRow(abilityId);if(!ability)return;const evidence=this.evidenceForAbility(abilityId);const linkedCount=(JSON.parse(ability.evidence_ids) as string[]).length;const count=Math.max(linkedCount,evidence.length);const reading=this.abilityReading(abilityId);const{proficiency,confidence}=reading;const previous=this.db.prepare("SELECT proficiency,training_status FROM learner_ability_state WHERE ability_id=?").get(abilityId) as {proficiency:number;training_status:string}|undefined;const trainingStatus=ability.status==="independent"?"monitoring":ability.status==="uncertain"?count?"diagnosing":"unknown":"training";const trend=!previous?"unknown":proficiency>previous.proficiency+0.04?"improving":proficiency<previous.proficiency-0.04?"declining":"stable";const now=new Date().toISOString();const practice=JSON.parse(ability.practice) as string[];this.db.prepare("INSERT INTO learner_ability_state (ability_id,proficiency,confidence,evidence_count,last_evidence_at,training_status,trend,current_belief,next_verification,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(ability_id) DO UPDATE SET proficiency=excluded.proficiency,confidence=excluded.confidence,evidence_count=excluded.evidence_count,last_evidence_at=excluded.last_evidence_at,training_status=excluded.training_status,trend=excluded.trend,current_belief=excluded.current_belief,next_verification=excluded.next_verification,updated_at=excluded.updated_at").run(abilityId,proficiency,confidence,count,evidence[0]?.occurredAt??(count?ability.updated_at:null),trainingStatus,trend,ability.summary||firstNarrativeLine(ability.markdown),practice[0]??"Spar wants independent evidence in a different problem structure.",now);if(previous&&previous.training_status!==trainingStatus)this.addNotice(trainingStatus==="monitoring"?`Monitoring ${ability.title}`:`Training focus changed`,trainingStatus==="monitoring"?`Spar is moving ${ability.title} out of deliberate practice. Newer evidence is strong enough to monitor it instead.`:`${ability.title} is now ${trainingStatus}. The change is backed by linked attempt evidence.`,ability.track_id);
    /* Where the two channels disagree, which is the most interesting row in the
       ledger and used to be unrepresentable. Spar is not overruling the agent —
       the status stands — it is saying out loud that the document claims more
       than the rows under it support, which is either a generous reading or
       evidence that has gone stale, and both are worth a look. Filed on the
       crossing only, so it is a change of state and not a standing complaint. */
    if(ability.status==="independent"&&previous&&(previous.proficiency>=ABILITY_DIVERGENCE_FLOOR)!==(proficiency>=ABILITY_DIVERGENCE_FLOOR))this.addNotice(proficiency<ABILITY_DIVERGENCE_FLOOR?`The evidence for ${ability.title} has stopped backing it`:`The evidence for ${ability.title} has caught up`,proficiency<ABILITY_DIVERGENCE_FLOOR?`Spar still has this filed as something you can do, but the attempts behind it no longer read that way. A diagnostic would settle which is right.`:`The attempts behind this now support what the ledger already said about it.`,ability.track_id);
    /* No rating move here. Ability state is what Spar believes about the learner;
       the rating is what they have shown against problems of known difficulty.
       Driving one from the other made the rating a second view of the belief —
       it moved when the agent rewrote a document and nobody had solved
       anything. The rating moves in `rateFinishedChallenge` and nowhere else. */}
  private addNotice(title:string,body:string,trackId?:string|null){const scope=this.learningTrackId(trackId);if(!scope)return;this.db.prepare("INSERT INTO learner_notices (id,title,body,created_at,dismissed_at,track_id) VALUES (?,?,?,?,NULL,?)").run(randomUUID(),title,body,new Date().toISOString(),scope);}
  /* Written once for the account, with no Track on it: the opening rating is the
     learner's, and a Track that happens to be open when the app first starts is
     not what it is about. */
  private ensureRating(at?:string):RatingPoint{const current=this.ratingHistory().at(-1);if(current)return current;
    return this.writeRatingPoint({rating:INITIAL_RATING,deviation:INITIAL_DEVIATION,volatility:INITIAL_VOLATILITY},"Initial provisional rating",null,at??new Date().toISOString());}

  /** One point, written. The rating is stored as the integer the learner is rated
   *  at; the deviation and volatility keep their precision, because they are
   *  arithmetic rather than display and rounding them compounds. */
  private writeRatingPoint(rating:Rating,reason:string,trackId:string|null,occurredAt:string,questionId:string|null=null):RatingPoint{
    const point={id:randomUUID(),rating:Math.round(rating.rating),deviation:rating.deviation,volatility:rating.volatility,provisional:rating.deviation>ESTABLISHED_DEVIATION,reason,occurredAt} satisfies RatingPoint;
    this.db.prepare("INSERT INTO rating_points (id,rating,deviation,volatility,provisional,reason,occurred_at,track_id,question_id) VALUES (?,?,?,?,?,?,?,?,?)").run(point.id,point.rating,point.deviation,point.volatility,point.provisional?1:0,point.reason,point.occurredAt,trackId,questionId);
    return point;
  }
  /**
   * The rating, moved by a challenge the learner finished.
   *
   * This replaced `recalculateRating`, which took the confidence-weighted mean of
   * every ability's proficiency and stretched it onto a span. That number could
   * not fall on a failure, did not care how hard the challenge was, and was
   * recomputed from ability state rather than earned — three things a rating has
   * to do. What runs now is Glicko-2 against the challenge as an opponent: see
   * `@spar/domain/rating` for the system and `./rating` for how a finished
   * challenge becomes one result.
   *
   * The deviation is decayed for the time since the last point before the result
   * is applied, so a learner returning after three months is rated as somebody
   * whose standing is genuinely less certain than it was — which is what makes
   * their first few challenges back move the number properly instead of being
   * damped by a precision nobody has re-earned.
   */
  private rateFinishedChallenge(questionId:string,reason:string,trackId?:string|null,at?:string):RatingPoint{
    const prior=this.ratingHistory().at(-1)??this.ensureRating();
    /* Already paid for. `reopenAttempt` sends a solved challenge back when the
       review finds it was not solved the way the challenge asked, and the pass
       that closed it has already moved the rating; the learner solving it a
       second time is the same challenge, not a second one. */
    if(this.db.prepare("SELECT 1 FROM rating_points WHERE question_id=? LIMIT 1").get(questionId))return prior;
    const row=this.db.prepare(`SELECT q.difficulty,q.source_ref,
      (SELECT COUNT(*) FROM attempt_events he JOIN attempts ha ON ha.id=he.attempt_id WHERE ha.question_id=q.id AND he.type='hint_requested') hint_count,
      (SELECT json_extract(te.payload,'$.outcome') FROM attempt_events te JOIN attempts ta ON ta.id=te.attempt_id WHERE ta.question_id=q.id AND te.type='attempt_completed' ORDER BY te.occurred_at DESC LIMIT 1) outcome
      FROM questions q WHERE q.id=?`).get(questionId) as {difficulty:string;source_ref:string|null;hint_count:number;outcome:string|null}|undefined;
    if(!row)return prior;
    /* `at` is the replay's: a point stamped with the moment the migration ran
       would make fifty challenges spread over months read as fifty in one
       second, and the deviation decay between them — which is the whole reason a
       returning learner's next result counts properly — would be zero. */
    const now=at??new Date().toISOString();
    const decayed=decayRating({rating:prior.rating,deviation:prior.deviation,volatility:prior.volatility},elapsedDays(prior.occurredAt,now));
    const result=challengeResult({outcome:row.outcome,assisted:row.hint_count>0,difficulty:row.difficulty as "foundation"|"developing"|"proficient"|"advanced",source:parseSourceRef(row.source_ref)});
    if(!result)return prior;
    return this.writeRatingPoint(updateRating(decayed,[result]),reason,this.learningTrackId(trackId),now,questionId);
  }

  /**
   * Every graded challenge, replayed in order, as one rating curve.
   *
   * Run once when the database still holds points from the old scheme. The
   * alternative was to map the last old rating onto the new scale and carry on,
   * which would have left a curve whose shape was drawn by one system and whose
   * end was drawn by another — and the old points were never earned against
   * anything, so there is nothing in them worth preserving. The attempts are
   * real, they are all still here, and replaying them produces the curve the
   * learner would have had if Spar had rated properly from the start.
   */
  private migrateRatingHistory(){
    if(this.getSetting<boolean>(RATING_MIGRATION,false))return;
    const finished=this.db.prepare(`SELECT q.id,MAX(a.completed_at) completed_at FROM questions q JOIN attempts a ON a.question_id=q.id
      WHERE a.status='completed' AND a.completed_at IS NOT NULL GROUP BY q.id ORDER BY completed_at`).all() as Array<{id:string;completed_at:string}>;
    this.db.transaction(()=>{
      this.db.prepare("DELETE FROM rating_points").run();
      /* Stamped before the first challenge it precedes, so the curve starts
         where the learner started rather than where the migration ran. */
      this.ensureRating(finished[0]?.completed_at);
      for(const row of finished)this.rateFinishedChallenge(row.id,"Replayed from recorded attempt history",null,row.completed_at);
    })();
    this.setSetting(RATING_MIGRATION,true);
  }
  private insertEvent(event:AttemptEvent){this.db.prepare("INSERT INTO attempt_events VALUES (?,?,?,?,?,?,?,?)").run(event.id,event.attemptId,event.sequence,event.type,event.occurredAt,JSON.stringify(event.payload),event.source,event.schemaVersion);}
  private ensureColumn(table:string,column:string,declaration:string){const columns=this.db.pragma(`table_info(${table})`) as Array<{name:string}>;if(!columns.some((item)=>item.name===column))this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);}
  /* Writes made while restoring are not news. Every insert path in this class
     enqueues, which is right when the learner is the one causing it and wrong
     when the cloud is: without this guard a restore would push every row it had
     just pulled straight back, and a fresh device would spend its first minutes
     uploading the account to itself. */
  private restoring=false;
  private enqueue(kind:string,payload:unknown){if(this.restoring)return;this.db.prepare("INSERT INTO sync_outbox (id,kind,payload,created_at) VALUES (?,?,?,?)").run(randomUUID(),kind,JSON.stringify(payload),new Date().toISOString());}
  private toSession(row:SessionRow):SessionSummary{const questions=this.db.prepare("SELECT id,title,status FROM questions WHERE session_id=? ORDER BY ordinal").all(row.id) as Array<{id:string;title:string;status:SessionSummary["questionTitles"][number]["status"]}>;const active=questions.find(q=>q.status==="active");const focus=(this.db.prepare("SELECT ability_title FROM training_targets WHERE session_id=? ORDER BY created_at DESC LIMIT 3").all(row.id) as Array<{ability_title:string}>).map(v=>v.ability_title);return{id:row.id,trackId:row.track_id,context:row.context,title:row.title,originalGoal:row.original_goal,objective:row.objective,status:row.status,currentFocus:focus,completedQuestions:questions.filter(q=>q.status==="completed").length,activeQuestion:active?{id:active.id,title:active.title,ordinal:questions.indexOf(active)+1}:null,questionTitles:questions,totalSeconds:row.total_seconds,updatedAt:row.updated_at,pinnedAt:row.pinned_at,archivedAt:row.archived_at};}
}

/** A concept kind the agent named, or the safest default. "engineering" is that
 *  default rather than "dsa": an untagged concept is more often something about
 *  building software than an algorithm, and a wrong kind only mis-tints a chip. */
function conceptKind(value:unknown):ConceptKind{return value==="dsa"||value==="craft"||value==="engineering"?value:"engineering";}
/** The band, said in one word, from counts the caller already has. */
function conceptStandingOf(summary:ConceptSummary){return CONCEPT_STANDING_LABEL[conceptStanding(conceptStrength(summary))].toLowerCase();}
function trackTitle(goal:string){const clean=goal.replace(/^(i want to|i'd like to|help me)\s+/i,"").trim();return clean.length>52?`${clean.slice(0,49).trimEnd()}…`:clean.replace(/^./,(letter)=>letter.toUpperCase());}
function firstNarrativeLine(markdown:string){return markdown.split("\n").map((line)=>line.replace(/^#+\s*/,"").trim()).find((line)=>line.length>8)??"Spar is still forming a reliable belief.";}
function intentCopy(intent:TrainingTarget["action"]){return({diagnose:"Spar needs cleaner evidence before treating this as a weakness.",teach:"A prerequisite needs a short, explicit intervention.",practise:"Repeated evidence makes deliberate practice worthwhile.",transfer:"Direct execution looks reliable; the next question tests transfer.",advance:"The current level is supported strongly enough to raise the constraint.",retain:"This was previously reliable but has not been observed recently."} as const)[intent];}
type AbilityRow={id:string;track_id:string|null;title:string;markdown:string;version:number;status:AbilityStatus;updated_at:string;evidence_ids:string;summary:string;practice:string;earned_at:string|null};

/* Versioned, and bumped whenever the arithmetic behind the curve changes. The
   first cut priced a Spar-authored challenge relative to the learner's own
   rating, which ratcheted upward with every solve; a database that replayed
   under that rule holds a curve nobody earned, so the fix has to replay again
   rather than carry on from its last point. */
const RATING_MIGRATION="rating-glicko2-migration-2";

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
export function normalizeTarget(row:Record<string,unknown>):TrainingTarget{return{id:String(row.id),sessionId:String(row.session_id),abilityId:String(row.ability_id),abilityTitle:String(row.ability_title),specificGap:String(row.specific_gap),desiredEvidence:String(row.desired_evidence),avoidTesting:JSON.parse(String(row.avoid_testing)) as string[],action:String(row.action) as TrainingTarget["action"],createdAt:String(row.created_at)};}
/**
 * Whether the agent is asking what it already asked.
 *
 * Compared on what the learner would actually see — the prompts and the choices
 * offered for them — and not on the request id, which is minted fresh on every
 * call and would make every repeat look new.
 */
function sameIntake(previous:AskUserQuestionRequest,input:AskUserQuestionInput):boolean{
  const shape=(questions:AskUserQuestionRequest["questions"]|AskUserQuestionInput["questions"])=>JSON.stringify(questions.map((item)=>[item.header,item.question,item.options.map((option)=>option.label)]));
  return shape(previous.questions)===shape(input.questions);
}
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
/** How many messages keep their full step-by-step account in memory. Enough that
 *  the part of the conversation anyone is actually looking at is complete. */
const TRANSCRIPT_ACTIVITY_WINDOW=12;

/** The step count without building the steps: a length is all an unloaded row
 *  needs to offer, and parsing the array is the cost being avoided. */
function countActivity(value:string|null):number{if(!value)return 0;try{const parsed=JSON.parse(value) as unknown;return Array.isArray(parsed)?parsed.length:0;}catch{return 0;}}

function parseActivity(value:string|null):AgentActivityStep[]{if(!value)return[];try{const parsed=JSON.parse(value) as unknown;if(!Array.isArray(parsed))return[];return parsed.flatMap((entry)=>{const step=agentActivityStepSchema.safeParse(entry);return step.success?[step.data]:[];});}catch{return[];}}
