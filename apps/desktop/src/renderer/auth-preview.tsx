import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { AuthRequest, AuthResult, SparApi } from "../shared/api";
import { AuthPage } from "./components/pages/AuthPage";
import "./theme.css";

/* A harness for looking at the sign-in window in a browser. Not shipped: it is
   here so the four flows can be walked through without an API, an Electron
   window or a real account. Delete freely. */

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
} as unknown as SparApi;

function Harness() {
  const [error, setError] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  document.documentElement.classList.toggle("dark", dark);
  return (
    <div className="h-screen w-screen">
      <button className="fixed top-3 right-3 z-50 rounded border border-border px-2 py-1 text-ui" onClick={() => setDark((value) => !value)} type="button">
        {dark ? "Light" : "Dark"}
      </button>
      <AuthPage
        api={api}
        error={error}
        onAuthenticated={async () => setError("→ signed in (harness stops here)")}
        onError={(value) => setError(value || null)}
        serverConfigured
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
