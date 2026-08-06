import { useEffect, useRef, useState } from "react";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { motion } from "motion/react";
import type { AuthCodePurpose, AuthRequest, SparApi } from "../../../shared/api";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import { message } from "@/lib/format";
import { SparDots } from "../common/SparDots";
import { SparWordmark } from "../common/SparWordmark";
import { CodeField } from "../auth/CodeField";
import { LINKS, PANEL, STEP, TEXT, useMarkPass } from "../auth/arrival";
import { PasswordStrength } from "../auth/PasswordStrength";

type Mode = "sign-in" | "sign-up";
/** Which of the four things the window is currently asking for. Everything else
 *  — the email, the password, the code — is a field that survives the step it was
 *  typed in, because moving between these is not starting again. */
type Step =
  | { name: "credentials"; mode: Mode }
  /** Six digits, either to finish a sign-up or to sign in without a password. */
  | { name: "code"; purpose: Extract<AuthCodePurpose, "sign-in" | "email-verification"> }
  /** Which address to send a reset code to. */
  | { name: "forgot" }
  /** The reset code and the password it buys. */
  | { name: "reset" };

/** How long before another code can be asked for. The API allows four in five
 *  minutes; this is the window's own manners, and it exists mostly so that
 *  someone waiting on a slow mail server does not spend their allowance in ten
 *  seconds and get a rate limit instead of an email. */
const RESEND_SECONDS = 30;

/** Mirrors the checks the API runs, so the field that is wrong is marked here
 *  rather than coming back as a round-trip error banner. */
function problemWith(step: Step, email: string, password: string, code: string): { field: "email" | "password" | "code"; text: string } | null {
  if (step.name !== "code" && step.name !== "reset" && !/^\S+@\S+\.\S+$/.test(email.trim())) return { field: "email", text: "Enter a valid email address." };
  if ((step.name === "code" || step.name === "reset") && !/^\d{6}$/.test(code.trim())) return { field: "code", text: "The code is six digits." };
  if ((step.name === "reset" || step.name === "credentials") && password.length < 8) return { field: "password", text: "Passwords are at least 8 characters." };
  return null;
}

/** What each step is called and what it says about itself. Kept out of the render
 *  so the four flows can be read side by side.
 *
 *  The address is set in the window's own text colour wherever it appears: it is
 *  the one word on these screens someone has to actually check, because a code
 *  that never arrives is nearly always a code that went somewhere else. */
function copyFor(step: Step, email: string) {
  const at = <span className="whitespace-nowrap text-foreground">{email.trim() || "your email"}</span>;
  switch (step.name) {
    case "credentials":
      return { title: null, caption: step.mode === "sign-in" ? "Sign in to pick up where you left off." : "Create an account and start sparring.", action: step.mode === "sign-in" ? "Sign in" : "Create account", busy: step.mode === "sign-in" ? "Signing in…" : "Creating account…" };
    case "code":
      return step.purpose === "email-verification"
        ? { title: "Confirm your email", caption: <>We sent a six-digit code to {at}.</>, action: "Confirm and sign in", busy: "Confirming…" }
        : { title: "Check your email", caption: <>A sign-in code is on its way to {at}.</>, action: "Sign in", busy: "Signing in…" };
    case "forgot":
      return { title: "Reset your password", caption: "We will email you a code to set a new one.", action: "Email me a code", busy: "Sending…" };
    case "reset":
      return { title: "Choose a new password", caption: <>Enter the code we sent to {at}, and the password you want.</>, action: "Save and sign in", busy: "Saving…" };
  }
}

/** Sign-in is the whole window: the wordmark, what is being asked for, and one
 *  action. There is nothing to explain here — the app is already installed — so
 *  the page carries no marketing copy and no second column.
 *
 *  Four flows share it. Signing in and creating an account are the two on the
 *  front; behind them, confirming a new address and recovering a forgotten
 *  password are steps of those same two rather than places of their own, which is
 *  why the email and password fields keep their values across all of them.
 *
 *  The submit button is deliberately never disabled on validity. Disabling it
 *  until the fields pass leaves the primary action dead on arrival, which reads as
 *  a broken window rather than as a hint, and a password manager that fills the
 *  fields without firing React's change events leaves it dead even once the form
 *  is complete. Validation runs on submit instead and marks the field. */
export function AuthPage({
  api,
  error,
  serverConfigured,
  onAuthenticated,
  onError,
}: {
  api: SparApi | undefined;
  error: string | null;
  /** False when this build has no Spar server to sign in against. */
  serverConfigured: boolean;
  onAuthenticated(): Promise<void>;
  onError(value: string): void;
}) {
  const [step, setStep] = useState<Step>({ name: "credentials", mode: "sign-in" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  /* Something worth saying that is not a failure: a code has gone out. Cleared by
     the next attempt, so it never sits under an error explaining the opposite. */
  const [sent, setSent] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const passwordRef = useRef<HTMLInputElement>(null);
  /* The mark runs one pass for every choice the learner makes, and keeps passing
     while a request is in flight. */
  const { pass, awake, rouse } = useMarkPass(busy);
  const copy = copyFor(step, email);
  /* What the window is currently saying, as opposed to which step it is on:
     signing in and creating an account are one step in two voices. */
  const voice = step.name === "credentials" ? step.mode : step.name;
  const problem = attempted ? problemWith(step, email, password, code) : null;
  /* A build with nowhere to sign in cannot be fixed by trying again, so it is said
     before the attempt rather than reported as its failure — otherwise the learner
     reads a refused connection to localhost as Spar being broken. */
  const unconfigured = !serverConfigured
    ? "This build has no Spar server configured, so there is nothing to sign in to. See docs/hosting.md."
    : null;
  const notice = problem?.text ?? error ?? unconfigured;

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const go = (next: Step) => {
    rouse();
    setStep(next);
    setAttempted(false);
    setSent(null);
    onError("");
    /* A code belongs to the step that asked for it. Carrying one into the next
       step would auto-submit it against a flow it was never issued for. */
    setCode("");
  };

  /** Runs a request and moves the window to wherever it lands. Every flow ends in
   *  one of two places, so this is the only place either is decided. */
  const send = (request: AuthRequest, onCodeSent?: () => void) => {
    if (!api || busy) return;
    onError("");
    setSent(null);
    setBusy(true);
    void api
      .auth(request)
      .then(async (result) => {
        if (result.status === "signed-in") {
          /* Credentials are in the keychain now, but the account only reaches the
             app through a fresh bootstrap — the spinner stays up across it so the
             button never sits idle on a window that has not moved on yet. */
          await onAuthenticated();
          return;
        }
        setCooldown(RESEND_SECONDS);
        /* Arriving at a step nobody has attempted yet: the code cannot already be
           wrong, and a validation message waiting on an empty field reads as one. */
        setAttempted(false);
        onCodeSent?.();
        setStep((current) => (current.name === "credentials" && result.purpose !== "forget-password" ? { name: "code", purpose: result.purpose } : current));
      })
      .catch((cause) => onError(message(cause)))
      /* A no-op once the bootstrap has swapped this page out; it matters only when
         the refresh comes back without an account, so the form stays usable. */
      .finally(() => setBusy(false));
  };

  /** The current step's own request. Reached from the button and, on the code
   *  steps, from the sixth digit landing. */
  const attempt = () => {
    rouse();
    setAttempted(true);
    if (!api || busy || problemWith(step, email, password, code)) return;
    const address = email.trim();
    if (step.name === "credentials") return send({ action: step.mode, email: address, password });
    if (step.name === "code") return send(step.purpose === "email-verification" ? { action: "verify-email", email: address, code } : { action: "sign-in-code", email: address, code });
    if (step.name === "forgot") return send({ action: "send-code", email: address, purpose: "forget-password" }, () => go({ name: "reset" }));
    return send({ action: "reset-password", email: address, code, password });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    attempt();
  };

  /** Another code, for whatever the current step is waiting on. */
  const resend = () => {
    const purpose: AuthCodePurpose = step.name === "reset" ? "forget-password" : step.name === "code" ? step.purpose : "sign-in";
    setCode("");
    send({ action: "send-code", email: email.trim(), purpose }, () => setSent("A new code is on its way."));
  };

  const field = "h-11 w-full bg-transparent px-3.5 text-content outline-none placeholder:text-muted-foreground/60 disabled:opacity-60";
  /* One sunken group with a hairline between the rows, the way a macOS sheet
     stacks a credential pair — two separately outlined boxes at this size read as
     a form, and the point is that it does not. */
  const group = cn(
    "overflow-hidden rounded-xl bg-[var(--color-background-elevated-secondary)] transition-shadow",
    "shadow-[inset_0_0_0_0.5px_var(--border-strong)]",
    "focus-within:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_26%,transparent)]",
    problem && problem.field !== "code" && "shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--destructive)_55%,transparent)]",
  );

  const emailInput = (
    <input
      aria-invalid={problem?.field === "email"}
      aria-label="Email"
      autoComplete="email"
      autoFocus
      className={field}
      disabled={busy}
      onChange={(event) => { setEmail(event.target.value); if (error) onError(""); }}
      placeholder="Email"
      type="email"
      value={email}
    />
  );

  const passwordInput = (label: string, hint: "current-password" | "new-password") => (
    <div className="flex items-center">
      <input
        aria-invalid={problem?.field === "password"}
        aria-label={label}
        autoComplete={hint}
        className={field}
        disabled={busy}
        onChange={(event) => { setPassword(event.target.value); if (error) onError(""); }}
        placeholder={label}
        ref={passwordRef}
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
  );

  /* Whether the password on screen is one being chosen. A strength reading is
     help while you invent a password and a verdict you cannot act on while you
     recall one. */
  const choosing = step.name === "reset" || (step.name === "credentials" && step.mode === "sign-up");

  return (
    <div className="app-drag app-pane relative grid h-full place-items-center overflow-hidden px-6">
      {/* The mark's own grid at the scale of the room — see `.auth-field` in
          theme.css. Behind everything, absent under the form, and carrying one
          slow diagonal pass so the window is never quite still. */}
      <div aria-hidden className="auth-field text-foreground" />

      <motion.div className="app-no-drag relative w-full max-w-[20.5rem] pb-[var(--titlebar-height)]" layout transition={PANEL}>
        {/* Mark and wordmark on one line, the way the lockup is set everywhere
            else. Stacked, they eat a third of a window that is deliberately small
            while nobody is signed in. */}
        <motion.div className="flex items-center justify-center gap-2.5" layout="position" transition={PANEL}>
          {/* The mark wakes up while a request is in flight. It is the only
              spinner on this window: a second one inside the button would be two
              things saying the same thing, half an inch apart. */}
          <SparDots key={pass} pattern={awake ? "pass" : "still"} size={30} {...(busy ? { label: copy.busy } : {})} />
          <SparWordmark className="block text-[2rem] leading-none text-foreground" />
        </motion.div>

        {/* One step replaces another: the outgoing one is gone the moment the
            learner has moved on, the panel resizes around what is left, and the
            new step rises into it. Deliberately no exit animation — a step that
            has to finish leaving before the next can arrive is a step that can be
            left half-gone if anything interrupts it, and on a form someone is
            typing into, something always does. */}
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          initial={{ opacity: 0, y: 6 }}
          key={step.name}
          transition={STEP}
        >
            {/* Keyed on the voice rather than the step, so switching between
                signing in and creating an account fades the one line that
                actually changed instead of swapping it mid-sentence.

                Deliberately not an `AnimatePresence`: there is nothing to watch
                leave, the two lines occupy the same slot, and a swap that has to
                wait for an exit to finish is a swap that can be left half-done if
                the exit is interrupted — which, on a form someone is typing into,
                it will be. */}
            <motion.div animate={{ opacity: 1 }} initial={{ opacity: 0 }} key={voice} transition={TEXT}>
              {copy.title ? (
                <div className="mt-5 text-center">
                  <h1 className="text-content font-medium text-foreground">{copy.title}</h1>
                  <p className="mx-auto mt-1 max-w-[17.5rem] text-ui text-muted-foreground">{copy.caption}</p>
                </div>
              ) : (
                <p className="mt-2 text-center text-ui text-muted-foreground">{copy.caption}</p>
              )}
            </motion.div>

            {step.name === "credentials" && (
              <Segmented<Mode>
                ariaLabel="Sign in or create an account"
                className="mt-4 w-full"
                disabled={busy}
                onChange={(mode) => go({ name: "credentials", mode })}
                options={[
                  { value: "sign-in", label: "Sign in" },
                  { value: "sign-up", label: "Create account" },
                ]}
                value={step.mode}
              />
            )}

            <form className="mt-3" onSubmit={submit} noValidate>
              {step.name === "credentials" && (
                <div className={group}>
                  {emailInput}
                  <div className="border-t border-border">{passwordInput("Password", step.mode === "sign-up" ? "new-password" : "current-password")}</div>
                </div>
              )}
              {step.name === "forgot" && <div className={group}>{emailInput}</div>}
              {step.name === "code" && <CodeField autoFocus disabled={busy} invalid={problem?.field === "code"} onChange={setCode} onComplete={attempt} value={code} />}
              {step.name === "reset" && (
                <div className="space-y-2.5">
                  {/* A finished code moves on to the password rather than
                      submitting: the code is half of this step, and the learner
                      is about to type the other half anyway. */}
                  <CodeField autoFocus disabled={busy} invalid={problem?.field === "code"} onChange={setCode} onComplete={() => passwordRef.current?.focus()} value={code} />
                  <div className={group}>{passwordInput("New password", "new-password")}</div>
                </div>
              )}

              {/* Only once there is something to say about. An empty bar under an
                  empty field is a requirement nobody has been given yet, and it
                  opens rather than appears so the button below it slides. */}
              {choosing && password.length > 0 && (
                <motion.div animate={{ opacity: 1 }} initial={{ opacity: 0 }} transition={TEXT}>
                  <PasswordStrength className="px-0.5 pt-2" password={password} />
                </motion.div>
              )}

              {/* The size is written out rather than reached for through
                  `text-content`: tailwind-merge reads that token as a colour and
                  drops the button's own `text-primary-foreground`, leaving the
                  label unreadable on the fill. */}
              <Button className="mt-3 h-11 w-full text-[0.8125rem]" disabled={busy} size="lg" type="submit">
                <motion.span
                  animate={{ opacity: 1 }}
                  className="inline-flex items-center gap-1.5"
                  initial={{ opacity: 0 }}
                  key={busy ? copy.busy : copy.action}
                  transition={TEXT}
                >
                  {busy ? copy.busy : <>{copy.action}<ArrowRight data-icon="inline-end" /></>}
                </motion.span>
              </Button>
            </form>
        </motion.div>

        {/* Reserved whether or not it is filled: the block below the button must
            not shift the form up and down as messages come and go. */}
        <p
          aria-live="polite"
          className={cn("mt-2.5 min-h-4 text-center text-ui", notice ? "text-destructive" : "text-muted-foreground/70")}
          role="status"
        >
          {notice ?? sent ?? (choosing && !password ? "At least 8 characters." : "")}
        </p>

        {/* The ways out of the current step. Every one of them is a link rather
            than a button: there is one action on this window, and it is above.
            Each opens and closes on its own height, so switching to creating an
            account — which has no way out but the segment above — closes the pair
            below instead of dropping them and letting the card jump. */}
        <motion.div className="mt-3 flex flex-col items-center gap-1.5 text-ui" layout transition={LINKS}>
          {step.name === "credentials" && step.mode === "sign-in" && (
            <motion.div animate={{ opacity: 1 }} className="flex flex-col items-center gap-1.5" initial={{ opacity: 0 }} key="recover" transition={TEXT}>
              <Link disabled={busy} onClick={() => go({ name: "forgot" })}>Forgot your password?</Link>
              <Link disabled={busy || !/^\S+@\S+\.\S+$/.test(email.trim())} onClick={() => send({ action: "send-code", email: email.trim(), purpose: "sign-in" })}>
                Email me a code instead
              </Link>
            </motion.div>
          )}
          {(step.name === "code" || step.name === "reset") && (
            <motion.div animate={{ opacity: 1 }} initial={{ opacity: 0 }} key="resend" transition={TEXT}>
              <Link disabled={busy || cooldown > 0} onClick={resend}>
                {cooldown > 0 ? `Send another code in ${cooldown}s` : "Send another code"}
              </Link>
            </motion.div>
          )}
          {step.name !== "credentials" && (
            <motion.div animate={{ opacity: 1 }} initial={{ opacity: 0 }} key="back" transition={TEXT}>
              <Link disabled={busy} onClick={() => go({ name: "credentials", mode: "sign-in" })}>
                Back to sign in
              </Link>
            </motion.div>
          )}
        </motion.div>
      </motion.div>
    </div>
  );
}

/** A quiet textual control. Muted until it is wanted, and disabled rather than
 *  hidden while a request is in flight, so the row it sits in never reflows. */
function Link({ children, disabled = false, onClick }: { children: React.ReactNode; disabled?: boolean; onClick(): void }) {
  return (
    <button
      className="rounded text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-45"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
