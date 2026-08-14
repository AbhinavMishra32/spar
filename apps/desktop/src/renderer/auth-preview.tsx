import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { AuthRequest, AuthResult, SparApi } from "../shared/api";
import { AuthPage } from "./components/pages/AuthPage";
import { OnboardingPage } from "./components/pages/OnboardingPage";
import "./theme.css";

/* A harness for looking at the two screens someone arrives through, in a browser
   and without an API, an Electron window or a real account. Not shipped; it is
   here for the same reason harness.html is. */

const sourceConnections = new Set<"leetcode" | "codeforces">();

const api = {
  async auth(request: AuthRequest): Promise<AuthResult> {
    await new Promise((resolve) => setTimeout(resolve, 700));
    if (request.action === "send-code") return { status: "code-sent", purpose: request.purpose };
    if (request.action === "sign-up") return { status: "code-sent", purpose: "email-verification" };
    if (request.action === "sign-in" && request.password === "unverified") return { status: "code-sent", purpose: "email-verification" };
    if (request.action === "sign-in" && request.password !== "correct-password") throw new Error("That email and password do not match an account.");
    if ("code" in request && request.code !== "123456") throw new Error("That code is not right. Check it, or ask for a new one.");
    return { status: "signed-in" };
  },
  async listProviders() {
    return {
      providers: [
        { id: "openai-codex", name: "ChatGPT", description: "", kind: "subscription", state: "disconnected", selectedModel: "gpt-5", baseUrl: "", models: [] },
        { id: "claude-code", name: "Claude Code", description: "", kind: "subscription", state: "disconnected", selectedModel: "opus", baseUrl: "", models: [] },
        { id: "anthropic", name: "Anthropic", description: "", kind: "api-key", state: "connected", selectedModel: "opus", baseUrl: "", models: [] },
      ],
      ready: true,
      defaultModel: { provider: "anthropic", model: "opus", reasoningEffort: "medium" },
    };
  },
  async saveProfile(input: unknown) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return { ...(input as object), completedAt: new Date().toISOString() };
  },
  async suggestSessions() {
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    return {
      source: "agent",
      suggestions: [
        { title: "Restore an invariant under mutation", why: "You said you get stuck knowing what needs awaiting; this starts one level below that.", goal: "..." },
        { title: "Cancel work that is already in flight", why: "The next thing that breaks after the first one is understood.", goal: "..." },
        { title: "Read a stack trace back to its cause", why: "Cheap to practise, and it makes every later session faster.", goal: "..." },
      ],
    };
  },
  /* The practice source, as the intake's last step reads it: connected or not,
     and how much the account has behind it. The sign-in itself is a real window
     in the app, so here it is a pause and a name. */
  async practiceSources() {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return (["leetcode", "codeforces"] as const).map((source) => sourceConnections.has(source)
      ? {
          source,
          name: source === "leetcode" ? "LeetCode" : "Codeforces",
          state: "connected",
          account: {
            username: "AbhinavMishra3322",
            premium: false,
            avatarUrl: "",
            solved: { total: 412, easy: 210, medium: 170, hard: 32 },
            available: { total: 3_612, easy: 892, medium: 1_884, hard: 836 },
            skills: [{ slug: "arrays", name: "Arrays", solved: 96, band: "fundamental" }],
            streak: 12,
          },
        }
      : { source, name: source === "leetcode" ? "LeetCode" : "Codeforces", state: "disconnected", account: null });
  },
  async connectPracticeSource(source: "leetcode" | "codeforces") {
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    sourceConnections.add(source);
    return { status: "connected", username: "AbhinavMishra3322" };
  },
  async disconnectPracticeSource(source: "leetcode" | "codeforces") {
    await new Promise((resolve) => setTimeout(resolve, 400));
    sourceConnections.delete(source);
  },
  onProviderOAuthEvent: () => () => undefined,
  onAgentEvent: () => () => undefined,
  onRunnerEvent: () => () => undefined,
  onMenuCommand: () => () => undefined,
  onNativeSurface: () => () => undefined,
  onSyncState: () => () => undefined,
  chrome: { platform: "darwin", surface: "none", controls: "left" },
} as unknown as SparApi;

(window as unknown as { spar: SparApi }).spar = api;

function Harness() {
  const [error, setError] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  const [page, setPage] = useState<"auth" | "onboarding">("auth");
  document.documentElement.classList.toggle("dark", dark);
  return (
    <div className="h-screen w-screen">
      <div className="fixed top-3 right-3 z-50 flex gap-1.5">
        <button className="rounded border border-border bg-background px-2 py-1 text-ui" onClick={() => setPage((value) => (value === "auth" ? "onboarding" : "auth"))} type="button">
          {page === "auth" ? "Onboarding" : "Sign in"}
        </button>
        <button className="rounded border border-border bg-background px-2 py-1 text-ui" onClick={() => setDark((value) => !value)} type="button">
          {dark ? "Light" : "Dark"}
        </button>
      </div>
      {page === "auth" ? (
        <AuthPage
          api={api}
          error={error}
          onAuthenticated={async () => setError("→ signed in (harness stops here)")}
          onError={(value) => setError(value || null)}
          serverConfigured
        />
      ) : (
        <OnboardingPage api={api} displayName="abhinav" onBaseline={async () => undefined} onDone={async () => undefined} onStartSession={async () => undefined} />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
