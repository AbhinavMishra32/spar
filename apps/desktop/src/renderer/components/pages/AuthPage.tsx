import { useState } from "react";
import { AlertCircle, ArrowRight, Sparkles } from "lucide-react";
import type { SparApi } from "../../../shared/api";
import { Button } from "@/components/ui/button";
import { message } from "@/lib/format";
import { SparWordmark } from "../common/SparWordmark";

const PRINCIPLES = [
  ["Evidence first", "The agent reads what you have actually done before it decides what to test."],
  ["One target at a time", "Every challenge declares the single gap it is trying to close."],
  ["Nothing is guessed", "Attempts, runs, and outcomes are recorded as an immutable trace."],
];

export function AuthPage({ api, error, onError }: { api: SparApi | undefined; error: string | null; onError(value: string): void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = /^\S+@\S+\.\S+$/.test(email) && password.length >= 8;

  const submit = (mode: "sign-in" | "sign-up") => {
    if (!api || !valid) return;
    setBusy(true);
    void api
      .passwordAuth(mode, email, password)
      .catch((cause) => onError(message(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="app-drag app-pane grid h-full grid-cols-[minmax(0,26rem)_1fr]">
      <div className="app-no-drag flex flex-col justify-center border-r border-border px-10">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-[10px] bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </span>
          <SparWordmark className="text-[1.3rem]" />
        </div>
        <h1 className="mt-5 text-[1.6rem] font-semibold tracking-[-0.03em]">Train how you think.</h1>
        <p className="mt-1.5 text-content leading-[1.6] text-muted-foreground">
          Your sessions, attempts, and ability evidence stay attached to your account.
        </p>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-ui text-destructive">
            <AlertCircle className="mt-px size-3.5 shrink-0" />
            <span className="min-w-0">{error}</span>
          </div>
        )}

        <form
          className="mt-5 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit("sign-in");
          }}
        >
          <label className="block">
            <span className="mb-1.5 block text-ui font-medium">Email address</span>
            <input
              autoComplete="email"
              className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-ui outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-[var(--border-strong)]"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              type="email"
              value={email}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-ui font-medium">Password</span>
            <input
              autoComplete="current-password"
              className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-ui outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-[var(--border-strong)]"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              type="password"
              value={password}
            />
          </label>
          <Button className="w-full" disabled={!valid || busy} type="submit">
            {busy ? "Signing in…" : "Sign in"}
            <ArrowRight data-icon="inline-end" />
          </Button>
          <Button className="w-full" disabled={!valid || busy} onClick={() => submit("sign-up")} type="button" variant="outline">
            Create account
          </Button>
        </form>
      </div>

      <div className="flex flex-col justify-center px-14">
        <span className="text-ui-sm font-semibold tracking-[0.14em] text-muted-foreground">PERSONALIZED CODING GYM</span>
        <h2 className="mt-3 max-w-[24ch] text-[2.4rem] font-semibold leading-[1.08] tracking-[-0.045em]">
          Evidence before conclusions.
        </h2>
        <dl className="mt-8 max-w-[34rem] space-y-4">
          {PRINCIPLES.map(([term, description]) => (
            <div key={term} className="border-l-2 border-border pl-3">
              <dt className="text-content font-medium">{term}</dt>
              <dd className="mt-0.5 text-ui leading-[1.65] text-muted-foreground">{description}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
