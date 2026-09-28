import { BrowserWindow, session as electronSession } from "electron";
import type { LeetCodeSession, PracticeRegion } from "@spar/practice";
import { browserSafeHeaders } from "./codeforcesBrowser.js";

/**
 * A LeetCode page nobody sees, for the requests Cloudflare will not take from
 * Node.
 *
 * Cloudflare's firewall in front of LeetCode reads the code in a run or a
 * submission, and some perfectly ordinary code trips it — a comment with a run
 * of colons in it was enough. It answers with a challenge that Node's HTTP stack
 * can never pass, however good the cookie. The same request made by Chromium from
 * a leetcode.com document goes through, which is also why leetcode.com's own
 * editor never shows it.
 *
 * Electron is that Chromium, so this is a hidden window in its own in-memory
 * partition, carrying the stored session's cookies and User-Agent — no window,
 * no second browser, no Dock icon. It loads robots.txt because the document only
 * has to be on LeetCode's origin: the problem page would cost seconds of script
 * for nothing. It is a child of the app window, so it never outlives it and
 * never counts as the window the app reopens or quits on.
 */
export class LeetCodePage {
  private constructor(private readonly window: BrowserWindow, private readonly origin: string) {}

  static async open(region: PracticeRegion, session: LeetCodeSession, parent: BrowserWindow | null): Promise<LeetCodePage> {
    const origin = region === "cn" ? "https://leetcode.cn" : "https://leetcode.com";
    const partition = electronSession.fromPartition(`leetcode-page-${region}`);
    await partition.clearStorageData({ storages: ["cookies"] });
    if (session.userAgent) partition.setUserAgent(session.userAgent);
    const domain = `.${new URL(origin).hostname}`;
    for (const pair of session.cookie.split(/;\s*/)) {
      const split = pair.indexOf("=");
      if (split <= 0) continue;
      await partition.cookies.set({ url: origin, domain, path: "/", secure: true, name: pair.slice(0, split), value: pair.slice(split + 1) });
    }
    const window = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      ...(parent && !parent.isDestroyed() ? { parent } : {}),
      webPreferences: { partition: `leetcode-page-${region}`, backgroundThrottling: false, sandbox: true, contextIsolation: true },
    });
    try {
      await window.loadURL(`${origin}/robots.txt`);
      return new LeetCodePage(window, origin);
    } catch (error) {
      window.destroy();
      throw error;
    }
  }

  get closed(): boolean { return this.window.isDestroyed(); }

  /** `fetch` from the page. Chromium supplies Cookie, User-Agent, Origin and
   *  Referer itself, so those are left out of what is passed in. */
  async request(url: string, init: RequestInit = {}): Promise<Response> {
    if (new URL(url).origin !== this.origin) throw new Error("The LeetCode page can only request LeetCode URLs.");
    if (this.closed) throw new Error("The LeetCode page has closed.");
    const request = {
      url,
      method: init.method ?? "GET",
      headers: browserSafeHeaders(init.headers),
      body: typeof init.body === "string" ? init.body : undefined,
    };
    const value = await this.window.webContents.executeJavaScript(`(async () => {
      const request = ${JSON.stringify(request)};
      const response = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body, credentials: "include" });
      return { status: response.status, statusText: response.statusText, headers: [...response.headers.entries()], body: await response.text() };
    })()`) as { status: number; statusText: string; headers: Array<[string, string]>; body: string };
    return new Response(value.body, { status: value.status, statusText: value.statusText, headers: value.headers });
  }

  close(): void {
    if (!this.closed) this.window.destroy();
  }
}
