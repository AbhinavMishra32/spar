import type { BootstrapData, PracticeApi } from "../shared/api";

const sessionId = "53c6646f-0498-4de1-b20c-5e2514ca8b31";
const data: BootstrapData = { account: { id: "5f6a31e3-ce4a-4196-a4d9-3c87f4174400", displayName: "Abhinav", email: "abhinav@example.com" }, theme: "system", syncState: "synced", sessions: [{ id: sessionId, title: "Deep JavaScript Runtime", originalGoal: "Understand JavaScript runtime behavior deeply", objective: "Build reliable reasoning about reference ownership and asynchronous state.", status: "active", currentFocus: ["References", "Mutation", "Async ownership"], completedQuestions: 2, activeQuestion: { id: "79732371-f317-4ca3-b3cb-3e1165adc1cc", title: "Event Queue Repair", ordinal: 3 }, questionTitles: [{ id: "a151339c-a690-4f2d-bb50-9f0f5816af3b", title: "Shared Configuration", status: "completed" }, { id: "c7c4db9c-a5c6-4efc-a404-2f11dce42b33", title: "Promise Relay", status: "completed" }, { id: "79732371-f317-4ca3-b3cb-3e1165adc1cc", title: "Event Queue Repair", status: "active" }], totalSeconds: 6142, updatedAt: new Date(Date.now() - 7_200_000).toISOString() }] };

export function browserDemoApi(): PracticeApi {
  return { bootstrap: async () => data, createSession: async () => ({ sessionId }), openSession: async (id) => ({ summary: data.sessions.find((s) => s.id === id) }), saveCheckpoint: async () => {}, appendAttemptEvent: async () => {}, readWorkspaceFile: async () => "", writeWorkspaceFile: async () => {}, run: async () => ({ id: crypto.randomUUID() }), sendAgentMessage: async () => ({ runId: crypto.randomUUID() }), startAuth: async () => {}, signOut: async () => {}, saveProviderSecret: async () => {}, onAgentEvent: () => () => {}, onRunnerEvent: () => () => {} };
}

