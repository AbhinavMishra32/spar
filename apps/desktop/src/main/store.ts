import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { AttemptEvent, SessionCheckpoint, SessionSummary } from "@pracai/domain";

export class LocalStore {
  private readonly db: Database.Database;
  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, original_goal TEXT NOT NULL, objective TEXT NOT NULL, status TEXT NOT NULL, current_focus TEXT NOT NULL, questions TEXT NOT NULL, total_seconds INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS checkpoints (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, version INTEGER NOT NULL, event_sequence INTEGER NOT NULL, payload TEXT NOT NULL, saved_at TEXT NOT NULL, UNIQUE(session_id, version));
      CREATE TABLE IF NOT EXISTS attempt_events (id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, sequence INTEGER NOT NULL, type TEXT NOT NULL, occurred_at TEXT NOT NULL, payload TEXT NOT NULL, source TEXT NOT NULL, schema_version INTEGER NOT NULL, UNIQUE(attempt_id, sequence));
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_outbox (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);
    `);
    this.seed();
  }

  listSessions(): SessionSummary[] {
    return this.db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC").all().map((row) => toSession(row as Row));
  }

  createSession(goal: string): { sessionId: string } {
    const sessionId = randomUUID();
    const now = new Date().toISOString();
    const title = goal.length > 44 ? `${goal.slice(0, 41)}...` : goal;
    this.db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(sessionId, title, goal, "Investigate prior evidence and establish the first training target.", "planning", "[]", "[]", 0, now, now);
    this.enqueue("session", { sessionId });
    return { sessionId };
  }

  readSession(id: string) { const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Row | undefined; return row ? { summary: toSession(row), checkpoint: this.latestCheckpoint(id) } : null; }
  latestCheckpoint(sessionId: string): SessionCheckpoint | null { const row = this.db.prepare("SELECT payload FROM checkpoints WHERE session_id = ? ORDER BY version DESC LIMIT 1").get(sessionId) as { payload: string } | undefined; return row ? JSON.parse(row.payload) as SessionCheckpoint : null; }

  saveCheckpoint(value: SessionCheckpoint) {
    this.db.transaction(() => {
      this.db.prepare("INSERT OR IGNORE INTO checkpoints VALUES (?, ?, ?, ?, ?, ?)").run(value.id, value.sessionId, value.version, value.eventSequence, JSON.stringify(value), value.savedAt);
      this.db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(value.savedAt, value.sessionId);
      this.enqueue("checkpoint", value);
    })();
  }

  appendEvent(event: AttemptEvent) {
    this.db.transaction(() => {
      const latest = this.db.prepare("SELECT MAX(sequence) AS value FROM attempt_events WHERE attempt_id = ?").get(event.attemptId) as { value: number | null };
      if (latest.value !== null && event.sequence > latest.value + 1) throw new Error(`Attempt event gap: expected ${latest.value + 1}, received ${event.sequence}`);
      this.db.prepare("INSERT OR IGNORE INTO attempt_events VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(event.id, event.attemptId, event.sequence, event.type, event.occurredAt, JSON.stringify(event.payload), event.source, event.schemaVersion);
      this.enqueue("attempt-event", event);
    })();
  }

  getSetting<T>(key: string, fallback: T): T { const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined; return row ? JSON.parse(row.value) as T : fallback; }
  setSetting(key: string, value: unknown) { this.db.prepare("INSERT INTO settings VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(key, JSON.stringify(value), new Date().toISOString()); }
  pendingSync(limit=100) { return this.db.prepare("SELECT id, kind, payload, attempts FROM sync_outbox ORDER BY created_at LIMIT ?").all(limit) as Array<{id:string;kind:string;payload:string;attempts:number}>; }
  acknowledgeSync(ids:string[]) { const remove=this.db.prepare("DELETE FROM sync_outbox WHERE id = ?"); this.db.transaction(()=>ids.forEach(id=>remove.run(id)))(); }
  markSyncFailed(id:string) { this.db.prepare("UPDATE sync_outbox SET attempts = attempts + 1 WHERE id = ?").run(id); }
  close() { this.db.close(); }
  private enqueue(kind: string, payload: unknown) { this.db.prepare("INSERT INTO sync_outbox (id, kind, payload, created_at) VALUES (?, ?, ?, ?)").run(randomUUID(), kind, JSON.stringify(payload), new Date().toISOString()); }

  private seed() {
    const count = (this.db.prepare("SELECT COUNT(*) count FROM sessions").get() as { count: number }).count;
    if (count) return;
    const id = randomUUID(); const now = new Date().toISOString();
    const questions = [{ id: randomUUID(), title: "Shared Configuration", status: "completed" }, { id: randomUUID(), title: "Promise Relay", status: "completed" }, { id: randomUUID(), title: "Event Queue Repair", status: "active" }];
    this.db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, "Deep JavaScript Runtime", "Understand JavaScript runtime behavior deeply", "Build reliable reasoning about reference ownership and asynchronous state.", "active", JSON.stringify(["References", "Mutation", "Async ownership"]), JSON.stringify(questions), 6142, now, now);
  }
}

type Row = { id: string; title: string; original_goal: string; objective: string; status: SessionSummary["status"]; current_focus: string; questions: string; total_seconds: number; updated_at: string };
function toSession(row: Row): SessionSummary {
  const questions = JSON.parse(row.questions) as SessionSummary["questionTitles"];
  const active = questions.find((question) => question.status === "active");
  return { id: row.id, title: row.title, originalGoal: row.original_goal, objective: row.objective, status: row.status, currentFocus: JSON.parse(row.current_focus) as string[], completedQuestions: questions.filter((question) => question.status === "completed").length, activeQuestion: active ? { id: active.id, title: active.title, ordinal: questions.indexOf(active) + 1 } : null, questionTitles: questions, totalSeconds: row.total_seconds, updatedAt: row.updated_at };
}
