import type { Env } from "./env.js";

/** One transactional email. Both bodies are always sent: a text part is what
 *  keeps a code readable in a client that refuses HTML, and sending HTML alone is
 *  also the single biggest thing that gets a new sending domain filtered. */
export type Message = { to: string; subject: string; html: string; text: string };

export type Mailer = {
  /** False when this deployment has no email provider configured. Sign-up asks
   *  for a code, so the rest of the auth config reads this rather than promising
   *  a verification email nothing can deliver — see `createAuth`. */
  readonly configured: boolean;
  send(message: Message): Promise<void>;
};

/** Resend, over its REST API rather than its SDK: one POST with a JSON body is
 *  the whole integration, and the API surface Spar uses here is four fields wide.
 *
 *  With no key configured the mailer writes the message to the server log instead
 *  of failing. That is for running Spar from source against a local database,
 *  where the code in the log is the code you type into the window; production is
 *  held to a real provider by `envSchema`. */
export function createMailer(env: Env, log: (message: string) => void = console.info): Mailer {
  const key = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM;
  if (!key || !from) {
    return {
      configured: false,
      async send(message) {
        log(`[mail] no RESEND_API_KEY configured — would have sent to ${message.to}: ${message.subject}\n${message.text}`);
      },
    };
  }
  return {
    configured: true,
    async send(message) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [message.to], subject: message.subject, html: message.html, text: message.text }),
      });
      if (response.ok) return;
      /* Resend reports the reason in the body — an unverified sending domain, a
         daily cap, a malformed address. Carrying it into the thrown error is what
         makes a failed sign-up debuggable from the server log alone; the caller
         never shows it to the learner. */
      const detail = await response.text().catch(() => "");
      throw new Error(`Resend rejected the message (${response.status}): ${detail.slice(0, 400)}`);
    },
  };
}

/** Why a code was sent. These are Better Auth's own OTP types, and the copy is
 *  keyed off them so that every email says what the code it carries will do. */
export type CodePurpose = "sign-in" | "email-verification" | "forget-password" | "change-email";

const PURPOSE: Record<CodePurpose, { subject: string; heading: string; lead: string }> = {
  "sign-in": { subject: "Your Spar sign-in code", heading: "Sign in to Spar", lead: "Enter this code in the Spar window to sign in." },
  "email-verification": { subject: "Confirm your email for Spar", heading: "Confirm your email", lead: "Enter this code in the Spar window to finish creating your account." },
  "forget-password": { subject: "Your Spar password reset code", heading: "Reset your password", lead: "Enter this code in the Spar window to choose a new password." },
  "change-email": { subject: "Confirm your new email for Spar", heading: "Confirm your new email", lead: "Enter this code in the Spar window to move your account to this address." },
};

/* The app icon's five-by-five grid, drawn in a table because that is the one
   layout primitive every mail client agrees on. The taper matches the icon and
   the loader in the app — dots are largest along the leading diagonal — so the
   email is stamped with the same mark the window opens with. */
const GRID = 5;
const MARK = Array.from({ length: GRID }, (_, row) =>
  Array.from({ length: GRID }, (_, column) => {
    const size = 10 - 4 * (Math.abs(row - column) / (GRID - 1));
    const opacity = 1 - 0.55 * (Math.abs(row - column) / (GRID - 1));
    return `<td width="14" height="14" align="center" valign="middle" style="padding:0"><div style="width:${size.toFixed(1)}px;height:${size.toFixed(1)}px;border-radius:50%;background:rgba(17,17,17,${opacity.toFixed(2)});font-size:0;line-height:0">&nbsp;</div></td>`;
  }).join(""),
)
  .map((row) => `<tr>${row}</tr>`)
  .join("");

/** The one email Spar sends. A code, what it is for, and how long it lasts —
 *  there is no call to action to click, because the thing that asked for it is a
 *  desktop window that is still open and waiting for six digits. */
export function codeMessage(to: string, code: string, purpose: CodePurpose, expiresInMinutes: number): Message {
  const { subject, heading, lead } = PURPOSE[purpose];
  const spaced = code.split("").join(" ");
  return {
    to,
    subject: `${subject}: ${code}`,
    text: `${heading}\n\n${lead}\n\n${code}\n\nThe code expires in ${expiresInMinutes} minutes. If you did not ask for it, you can ignore this message — nothing has changed.\n\nSpar`,
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#f6f6f5">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${lead} ${code}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f6f5">
<tr><td align="center" style="padding:40px 20px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:420px;background:#ffffff;border:1px solid #e6e5e3;border-radius:16px">
<tr><td style="padding:32px 32px 28px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111111">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0">${MARK}</table>
<div style="font-size:17px;font-weight:600;letter-spacing:-0.01em">${heading}</div>
<div style="margin:6px 0 22px 0;font-size:14px;line-height:21px;color:#5f5d59">${lead}</div>
<div style="padding:16px 0;border-top:1px solid #eeedeb;border-bottom:1px solid #eeedeb;text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:28px;font-weight:600;letter-spacing:0.28em;color:#111111">${spaced}</div>
<div style="margin:20px 0 0 0;font-size:12px;line-height:19px;color:#8a8880">The code expires in ${expiresInMinutes} minutes and can be used once. If you did not ask for it you can ignore this message — nothing has changed, and nobody can get in without it.</div>
</td></tr></table>
<div style="margin:18px 0 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;color:#a3a19a">Spar · sparring practice for engineers</div>
</td></tr></table>
</body></html>`,
  };
}
