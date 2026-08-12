import { rm } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, session as electronSession, type Session } from "electron";
import { parseCodeforcesCookies, parseLeetCodeCookie, practiceSource, verifyLeetCodeSession, type CodeforcesSession, type LeetCodeSession, type PracticeRegion } from "@spar/practice";
import { launchCodeforcesBrowser } from "./codeforcesBrowser.js";

/**
 * Signing in to a practice source.
 *
 * LeetCode has no OAuth, no device flow and no API tokens: a browser session is
 * the credential, and every working client authenticates with the cookies the
 * site sets. That leaves exactly one honest way for a desktop app to obtain one —
 * open the site's own sign-in page and let the learner sign in to it.
 *
 * Spar therefore never sees a password, never types into the page, and never
 * needs to know which method was used: a password, Google, GitHub and a
 * passkey all work, because all of them are LeetCode's own flows running in
 * LeetCode's own page. What Spar does is watch its cookie jar and ask LeetCode,
 * each time the cookies change, whether it now considers this browser signed in.
 *
 * Asking is not optional. LeetCode issues both `csrftoken` and `LEETCODE_SESSION`
 * to anonymous visitors as soon as the page loads, so a flow that waits for those
 * two names finishes instantly — before the learner has typed anything — stores a
 * session that belongs to nobody, and then fails everywhere downstream with an
 * error about a sign-in that visibly worked. The cookies are necessary and prove
 * nothing; `userStatus.isSignedIn` is the only completion test there is.
 *
 * The window is deliberately its own `persist:` partition rather than the app's
 * default session. Two reasons, and both matter:
 *
 *   - Spar's own window must never share a cookie jar with a site it renders.
 *     The partition is a wall between the learner's LeetCode session and
 *     everything else the app does.
 *   - It persists, so "sign in again" after an expiry is usually one click on a
 *     page that still knows who you are, rather than a full sign-in.
 *
 * `signOut` clears that partition, because leaving a live LeetCode session in a
 * jar the learner believes they disconnected would be the app lying to them.
 */

const PARTITION: Record<PracticeRegion, string> = {
  global: "persist:spar-leetcode",
  cn: "persist:spar-leetcode-cn",
};

/** How the cookie jar is polled while the learner works through the sign-in.
 *  Cheap — an in-process read of Chromium's own store — so it can be frequent
 *  enough that the window closes the instant the session lands. */
const POLL_MS = 700;
/** Long enough for a password manager, an email round trip and a 2FA code. The
 *  window is the learner's to close early, so this only bounds the case where
 *  they walked away. */
const TIMEOUT_MS = 10 * 60 * 1_000;

export type PracticeSignInResult =
  | { status: "connected"; session: LeetCodeSession; username: string }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

export function practiceSignInSession(region: PracticeRegion): Session {
  return electronSession.fromPartition(PARTITION[region]);
}

export async function signInToLeetCode(input: {
  region: PracticeRegion;
  parent: BrowserWindow | null;
  /** Aborted when Settings changes region or the app shuts down. */
  signal?: AbortSignal;
  /** Progress for the Settings row, so the learner is not watching a dead button
   *  while a window they may have sent behind the app waits for them. */
  onProgress?: (message: string) => void;
}): Promise<PracticeSignInResult> {
  const { region, parent, signal, onProgress } = input;
  const source = practiceSource("leetcode");
  const partition = practiceSignInSession(region);

  const window = new BrowserWindow({
    width: 980,
    height: 780,
    ...(parent ? { parent } : {}),
    show: false,
    autoHideMenuBar: true,
    title: `Sign in to ${source.name}`,
    webPreferences: {
      partition: PARTITION[region],
      /* The page is somebody else's. Nothing of Spar's is exposed to it: no
         preload is set, no node integration, and context isolation is on. This
         window renders a website and returns two cookies; it has no other job. */
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  onProgress?.(`Opening ${source.name}'s sign-in page…`);

  return new Promise<PracticeSignInResult>((resolve) => {
    let settled = false;
    const finish = (result: PracticeSignInResult) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      window.removeAllListeners("closed");
      if (!window.isDestroyed()) window.close();
      resolve(result);
    };

    /* The cookie jar is polled cheaply; LeetCode is asked only when the jar has
       actually changed. Without that guard a sign-in page left open would ask the
       service who is signed in every 700ms for ten minutes. */
    let checkedCookie = "";
    let checking = false;
    const attempt = async (): Promise<boolean> => {
      if (checking) return false;
      const session = await readSession(partition, region).catch(() => null);
      if (!session || session.cookie === checkedCookie) return false;
      checking = true;
      try {
        const identity = await verifyLeetCodeSession(session, region);
        /* Recorded only after the answer, so a cookie that changes while the
           request is in flight is checked again rather than skipped. */
        checkedCookie = session.cookie;
        if (!identity) return false;
        onProgress?.(`Signed in to ${source.name} as ${identity.username}.`);
        finish({ status: "connected", session, username: identity.username });
        return true;
      } finally {
        checking = false;
      }
    };

    const poll = setInterval(() => { void attempt(); }, POLL_MS);

    const timer = setTimeout(() => finish({ status: "failed", message: `The ${source.name} sign-in window timed out after ten minutes.` }), TIMEOUT_MS);
    const abort = () => finish({ status: "cancelled" });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) return abort();

    window.once("ready-to-show", () => window.show());
    window.on("closed", () => {
      /* Closed by hand. Asked once more first: signing in often navigates to the
         home page, and someone who closes the window at that point has in fact
         finished — but the answer still has to come from LeetCode rather than
         from the cookies being present. */
      checkedCookie = "";
      void attempt().then((done) => { if (!done) finish({ status: "cancelled" }); }).catch(() => finish({ status: "cancelled" }));
    });
    window.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3) return; // -3 is an aborted navigation, which every redirect produces.
      finish({ status: "failed", message: `Could not load ${url || source.name}: ${description}.` });
    });
    /* Everything that is not the source stays outside the app. LeetCode's sign-in
       hands off to Google and GitHub, so those have to open here rather than in
       the system browser — a handoff that opened externally would land in a
       different cookie jar and never come back. Anything else is a link the page
       offered, and it goes to the real browser. */
    window.webContents.setWindowOpenHandler(({ url }) => (isSignInHost(url, region) ? { action: "allow" } : { action: "deny" }));

    void window.loadURL(source.signInUrl[region]).catch((error: unknown) => {
      finish({ status: "failed", message: `Could not open ${source.name}: ${error instanceof Error ? error.message : String(error)}` });
    });
  });
}

/** Clears the partition, so disconnecting really disconnects rather than leaving
 *  a live session behind the next sign-in button. */
export async function clearLeetCodeSignIn(region: PracticeRegion): Promise<void> {
  const partition = practiceSignInSession(region);
  await partition.clearStorageData({ storages: ["cookies", "localstorage", "indexdb", "serviceworkers", "cachestorage"] }).catch(() => undefined);
}

const CODEFORCES_PARTITION = "persist:spar-codeforces";
export type CodeforcesSignInResult =
  | { status: "connected"; session: CodeforcesSession; username: string }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

/** Codeforces rejects the clearance produced by Electron's embedded Chromium,
 * so this source uses an app-owned profile in an installed Chromium browser.
 * It never attaches to the learner's normal browser profile. Completion is read
 * from the signed-in Codeforces page: its profile link names the handle and its
 * CSRF meta tag is required for an explicit later submission. */
export async function signInToCodeforces(input: { parent: BrowserWindow | null; signal?: AbortSignal; onProgress?: (message: string) => void }): Promise<CodeforcesSignInResult> {
  const source = practiceSource("codeforces");
  input.onProgress?.(`Opening ${source.name} in your browser…`);
  const launched = await launchCodeforcesBrowser(path.join(app.getPath("userData"), "codeforces-browser"))
    .then((browser) => ({ browser })).catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
  if ("error" in launched) return { status: "failed", message: launched.error };
  const { browser } = launched;
  return new Promise<CodeforcesSignInResult>((resolve) => {
    let settled = false;
    let checking = false;
    let challengeReported = false;
    let signInReported = false;
    const finish = (result: CodeforcesSignInResult) => { if (settled) return; settled = true; clearInterval(poll); clearTimeout(timer); input.signal?.removeEventListener("abort", abort); void browser.close(); resolve(result); };
    const attempt = async () => {
      if (checking) return false;
      if (browser.closed) { finish({ status: "cancelled" }); return false; }
      checking = true;
      try {
        const identity = await browser.identity().catch(() => null);
        if (identity?.challenge) {
          if (!challengeReported) { challengeReported = true; input.onProgress?.(`${source.name} is checking this browser…`); }
          return false;
        }
        if (!identity?.handle || !identity.csrf) {
          if (identity && !signInReported) { signInReported = true; input.onProgress?.(`Sign in to ${source.name} in the browser window…`); }
          return false;
        }
        const session = parseCodeforcesCookies(await browser.cookieHeader(), identity.handle, identity.csrf, identity.userAgent);
        input.onProgress?.(`Signed in to ${source.name} as ${identity.handle}.`);
        finish({ status: "connected", session, username: identity.handle });
        return true;
      } finally { checking = false; }
    };
    const poll = setInterval(() => { void attempt(); }, POLL_MS);
    const timer = setTimeout(() => finish({ status: "failed", message: `The ${source.name} sign-in window timed out after ten minutes.` }), TIMEOUT_MS);
    const abort = () => finish({ status: "cancelled" });
    input.signal?.addEventListener("abort", abort, { once: true });
    if (input.signal?.aborted) return abort();
    void attempt();
  });
}

export async function clearCodeforcesSignIn(): Promise<void> {
  await electronSession.fromPartition(CODEFORCES_PARTITION).clearStorageData({ storages: ["cookies", "localstorage", "indexdb", "serviceworkers", "cachestorage"] }).catch(() => undefined);
  await rm(path.join(app.getPath("userData"), "codeforces-browser"), { recursive: true, force: true }).catch(() => undefined);
}

/** The session in a partition's cookie jar, or null while it is not there yet. */
async function readSession(partition: Session, region: PracticeRegion): Promise<LeetCodeSession | null> {
  const domain = region === "cn" ? "leetcode.cn" : "leetcode.com";
  const cookies = await partition.cookies.get({ domain });
  if (!cookies.length) return null;
  const header = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  const parsed = parseLeetCodeCookie(header, region);
  return "error" in parsed ? null : parsed.session;
}

/** Hosts the sign-in flow is allowed to reach inside the app window. */
function isSignInHost(url: string, region: PracticeRegion): boolean {
  try {
    const host = new URL(url).hostname;
    return [
      region === "cn" ? "leetcode.cn" : "leetcode.com",
      "accounts.google.com",
      "github.com",
      "www.linkedin.com",
      "www.facebook.com",
    ].some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}
