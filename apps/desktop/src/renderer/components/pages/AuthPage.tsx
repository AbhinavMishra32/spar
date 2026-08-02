import { useState } from "react";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import type { SparApi } from "../../../shared/api";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import { message } from "@/lib/format";
import { SparWordmark } from "../common/SparWordmark";

type Mode = "sign-in" | "sign-up";

/** Mirrors the check the API runs in `apps/api/src/auth.ts`, so the field that is
 *  wrong is marked here rather than surfacing as a round-trip error banner. */
function problemWith(email: string, password: string): { field: "email" | "password"; text: string } | null {
  if (!/^\S+@\S+\.\S+$/.test(email.trim())) return { field: "email", text: "Enter a valid email address." };
  if (password.length < 8) return { field: "password", text: "Passwords are at least 8 characters." };
  return null;
}

/** Sign-in is the whole window: the wordmark, the two fields, the one action.
 *  There is nothing to explain here — the app is already installed — so the page
 *  carries no marketing copy and no second column.
 *
 *  The submit button is deliberately never disabled on validity. Disabling it
 *  until both fields pass leaves the primary action dead on arrival, which reads
 *  as a broken window rather than as a hint, and a password manager that fills
 *  the fields without firing React's change events leaves it dead even once the
 *  form is complete. Validation runs on submit instead and marks the field. */
export function AuthPage({
  api,
  error,
  onAuthenticated,
  onError,
}: {
  api: SparApi | undefined;
  error: string | null;
  onAuthenticated(): Promise<void>;
  onError(value: string): void;
}) {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const problem = attempted ? problemWith(email, password) : null;
  const notice = problem?.text ?? error;

  const change = (set: (value: string) => void) => (event: React.ChangeEvent<HTMLInputElement>) => {
    set(event.target.value);
    if (error) onError("");
  };

  const switchTo = (next: Mode) => {
    setMode(next);
    setAttempted(false);
    onError("");
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (!api || busy || problemWith(email, password)) return;
    onError("");
    setBusy(true);
    void api
      .passwordAuth(mode, email.trim(), password)
      /* Credentials live in the keychain now, but the account only reaches the app
         through a fresh bootstrap — the spinner stays up across it so the button
         never sits idle on a window that has not moved on yet. */
      .then(() => onAuthenticated())
      .catch((cause) => onError(message(cause)))
      /* A no-op once the bootstrap has swapped this page out; it matters only when
         the refresh comes back without an account, so the form stays usable. */
      .finally(() => setBusy(false));
  };

  const field =
    "h-11 w-full bg-transparent px-3.5 text-content outline-none placeholder:text-muted-foreground/60 disabled:opacity-60";

  return (
    <div className="app-drag app-pane grid h-full place-items-center px-6">
      <div className="app-no-drag w-full max-w-[19rem] pb-[var(--titlebar-height)]">
        <SparWordmark className="block text-center text-[2.1rem] leading-none text-foreground" />

        <Segmented<Mode>
          ariaLabel="Sign in or create an account"
          className="mt-7 w-full"
          disabled={busy}
          onChange={switchTo}
          options={[
            { value: "sign-in", label: "Sign in" },
            { value: "sign-up", label: "Create account" },
          ]}
          value={mode}
        />

        <form className="mt-3" onSubmit={submit} noValidate>
          {/* One sunken group with a hairline between the rows, the way a macOS
              sheet stacks a credential pair — two separately outlined boxes at
              this size read as a form, and the point is that it does not. */}
          <div
            className={cn(
              "overflow-hidden rounded-xl bg-[var(--color-background-elevated-secondary)] transition-shadow",
              "shadow-[inset_0_0_0_0.5px_var(--border-strong)]",
              "focus-within:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_26%,transparent)]",
              problem && "shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--destructive)_55%,transparent)]",
            )}
          >
            <input
              aria-invalid={problem?.field === "email"}
              aria-label="Email"
              autoComplete="email"
              autoFocus
              className={field}
              disabled={busy}
              onChange={change(setEmail)}
              placeholder="Email"
              type="email"
              value={email}
            />
            <div className="flex items-center border-t border-border">
              <input
                aria-invalid={problem?.field === "password"}
                aria-label="Password"
                autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                className={field}
                disabled={busy}
                onChange={change(setPassword)}
                placeholder="Password"
                type={reveal ? "text" : "password"}
                value={password}
              />
              <button
                aria-label={reveal ? "Hide password" : "Show password"}
                className="mr-2 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => setReveal((value) => !value)}
                tabIndex={-1}
                type="button"
              >
                {reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
          </div>

          {/* The size is written out rather than reached for through `text-content`:
              tailwind-merge reads that token as a colour and drops the button's own
              `text-primary-foreground`, leaving the label unreadable on the fill. */}
          <Button className="mt-3 h-11 w-full text-[0.8125rem]" disabled={busy} size="lg" type="submit">
            {busy ? (
              <>
                <Loader2 className="animate-spin" />
                {mode === "sign-in" ? "Signing in…" : "Creating account…"}
              </>
            ) : (
              <>
                {mode === "sign-in" ? "Sign in" : "Create account"}
                <ArrowRight data-icon="inline-end" />
              </>
            )}
          </Button>
        </form>

        {/* Reserved whether or not it is filled: the block below the button must
            not shift the form up and down as messages come and go. */}
        <p
          aria-live="polite"
          className={cn(
            "mt-2.5 min-h-4 text-center text-ui",
            notice ? "text-destructive" : "text-muted-foreground/70",
          )}
          role="status"
        >
          {notice ?? (mode === "sign-up" ? "At least 8 characters." : "")}
        </p>
      </div>
    </div>
  );
}
