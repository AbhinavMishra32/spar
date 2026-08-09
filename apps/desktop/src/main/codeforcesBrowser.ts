import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import path from "node:path";

const START_TIMEOUT_MS = 15_000;

export type CodeforcesBrowserIdentity = { handle?: string; csrf?: string; challenge: boolean; webdriver: boolean; userAgent: string };
type DevToolsTarget = { id: string; type: string; url: string; webSocketDebuggerUrl?: string };

/** Launches an app-owned real-browser profile. This keeps the debugging endpoint
 * away from the learner's ordinary browsing session while allowing Codeforces'
 * managed browser check to use a browser it supports. */
export async function launchCodeforcesBrowser(profileDir: string): Promise<CodeforcesBrowser> {
  const executable = await findChromiumBrowser();
  if (!executable) throw new Error("Codeforces requires Google Chrome, Microsoft Edge, Brave, or Chromium to connect. Install one and try again.");
  /* Chrome deliberately exposes navigator.webdriver when the magic value
     --remote-debugging-port=0 is used. Cloudflare then grants a clearance but
     rejects it on the redirect back to /enter. Reserve an ordinary ephemeral
     loopback port first, then give Chrome that non-zero value. */
  const port = await reserveLoopbackPort();
  const child = spawn(executable, [
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window",
    "about:blank",
  ], { stdio: "ignore" });
  try {
    await waitForDevTools(port, child);
    const browser = new CodeforcesBrowser(child, port);
    await browser.openSignIn();
    return browser;
  } catch (error) {
    child.kill();
    throw error;
  }
}

export class CodeforcesBrowser {
  constructor(private readonly child: ChildProcess, private readonly port: number) {}
  get closed(): boolean { return this.child.exitCode !== null || this.child.signalCode !== null; }

  /** Challenge cookies produced while webdriver was accidentally enabled can
   * never validate under the corrected browser identity. Clear only that state;
   * a still-valid Codeforces login remains available for an easy reconnect. */
  async openSignIn(): Promise<void> {
    const target = await this.pageTarget(false);
    if (!target?.webSocketDebuggerUrl) throw new Error("The Codeforces browser did not open a page.");
    const client = await CdpClient.connect(target.webSocketDebuggerUrl);
    try {
      const result = await client.command<{ cookies?: Array<{ name: string }> }>("Network.getCookies", { urls: ["https://codeforces.com/"] });
      const challengeNames = [...new Set((result.cookies ?? []).map((cookie) => cookie.name).filter(isCloudflareCookie))];
      for (const name of challengeNames) await client.command("Network.deleteCookies", { name, url: "https://codeforces.com/" });
      await client.command("Page.navigate", { url: "https://codeforces.com/enter" });
    } finally { client.close(); }
  }

  async identity(): Promise<CodeforcesBrowserIdentity | null> {
    const target = await this.target();
    if (!target?.webSocketDebuggerUrl) return null;
    const client = await CdpClient.connect(target.webSocketDebuggerUrl);
    try {
      const result = await client.command<{ result?: { value?: CodeforcesBrowserIdentity } }>("Runtime.evaluate", {
        expression: `(() => {
          const own = document.querySelector('.lang-chooser a[href^="/profile/"], .personal-sidebar a[href^="/profile/"]');
          const logout = [...document.querySelectorAll('.lang-chooser a, .personal-sidebar a')].some(a => /logout|sign out/i.test(a.textContent || '') || /\\/logout/.test(a.getAttribute('href') || ''));
          const csrf = document.querySelector('meta[name="X-Csrf-Token"]')?.getAttribute('content') || document.querySelector('input[name="csrf_token"]')?.getAttribute('value') || '';
          const text = document.body?.innerText || '';
          const challenge = location.search.includes('__cf_chl_') || location.pathname.includes('/cdn-cgi/challenge-platform/') || /verifying you are human|performing security verification|just a moment/i.test(document.title + ' ' + text);
          return logout && own
            ? { handle: (own.textContent || '').trim(), csrf, challenge: false, webdriver: navigator.webdriver, userAgent: navigator.userAgent }
            : { challenge, webdriver: navigator.webdriver, userAgent: navigator.userAgent };
        })()`,
        returnByValue: true,
      });
      return result.result?.value ?? null;
    } finally { client.close(); }
  }

  async cookieHeader(): Promise<string> {
    const target = await this.target();
    if (!target?.webSocketDebuggerUrl) return "";
    const client = await CdpClient.connect(target.webSocketDebuggerUrl);
    try {
      const result = await client.command<{ cookies?: Array<{ name: string; value: string }> }>("Network.getCookies", { urls: ["https://codeforces.com/"] });
      return (result.cookies ?? []).map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
    } finally { client.close(); }
  }

  async close(): Promise<void> {
    const target = await this.target().catch(() => null);
    if (target) await fetch(`http://127.0.0.1:${this.port}/json/close/${encodeURIComponent(target.id)}`).catch(() => undefined);
    if (!this.closed) this.child.kill();
  }

  private async target(): Promise<DevToolsTarget | null> {
    return this.pageTarget(true);
  }

  private async pageTarget(codeforcesOnly: boolean): Promise<DevToolsTarget | null> {
    const response = await fetch(`http://127.0.0.1:${this.port}/json/list`).catch(() => null);
    if (!response?.ok) return null;
    const targets = await response.json() as DevToolsTarget[];
    return targets.find((entry) => entry.type === "page" && (!codeforcesOnly || isCodeforcesUrl(entry.url))) ?? null;
  }
}

export function browserCandidates(platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.SPAR_CODEFORCES_BROWSER) return [env.SPAR_CODEFORCES_BROWSER];
  if (platform === "darwin") return [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    path.join(homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  if (platform === "win32") return [
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
    env.PROGRAMFILES && path.join(env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
    env["PROGRAMFILES(X86)"] && path.join(env["PROGRAMFILES(X86)"], "Microsoft/Edge/Application/msedge.exe"),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "BraveSoftware/Brave-Browser/Application/brave.exe"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/microsoft-edge", "/usr/bin/brave-browser", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
}

export function isCodeforcesUrl(value: string): boolean {
  try { const host = new URL(value).hostname; return host === "codeforces.com" || host.endsWith(".codeforces.com"); }
  catch { return false; }
}

export function isCloudflareCookie(name: string): boolean {
  return name === "cf_clearance" || name === "__cf_bm" || name.startsWith("cf_chl_");
}

async function findChromiumBrowser(): Promise<string | null> {
  for (const candidate of browserCandidates()) if (await access(candidate).then(() => true).catch(() => false)) return candidate;
  return null;
}

async function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForDevTools(port: number, child: ChildProcess): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < START_TIMEOUT_MS) {
    if (child.exitCode !== null) throw new Error("The Codeforces browser closed before it was ready.");
    const response = await fetch(`http://127.0.0.1:${port}/json/version`).catch(() => null);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The Codeforces browser did not start its secure local connection.");
}

class CdpClient {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message?: string } };
      if (!message.id) return;
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message || "Chrome rejected the browser request."));
      else request.resolve(message.result);
    });
    socket.addEventListener("close", () => {
      for (const request of this.pending.values()) request.reject(new Error("The Codeforces browser connection closed."));
      this.pending.clear();
    });
  }
  static async connect(url: string): Promise<CdpClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("Could not connect to the Codeforces browser.")), { once: true });
    });
    return new CdpClient(socket);
  }
  command<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close(): void { this.socket.close(); }
}
