import { randomBytes, createHash } from "node:crypto";
import { shell } from "electron";
import keytar from "keytar";

const service = "ai.practice.desktop";
export class AuthService {
  constructor(private readonly apiOrigin: string) {}
  async account() { const raw = await keytar.getPassword(service, "account"); return raw ? JSON.parse(raw) as { id: string; displayName: string; email: string } : null; }
  async accessToken() { return keytar.getPassword(service, "access-token"); }
  async start(provider: "email" | "google" | "github", email?: string) {
    const verifier = randomBytes(32).toString("base64url"); const challenge = createHash("sha256").update(verifier).digest("base64url"); const state = randomBytes(24).toString("hex");
    await keytar.setPassword(service, `oauth:${state}`, verifier);
    const url = new URL(`${this.apiOrigin}/v1/auth/${provider}/start`); url.searchParams.set("redirect_uri", "practice-ai://auth/callback"); url.searchParams.set("state", state); url.searchParams.set("code_challenge", challenge); url.searchParams.set("code_challenge_method", "S256"); if (email) url.searchParams.set("email", email);
    await shell.openExternal(url.toString());
  }
  async complete(callbackUrl: string) {
    const url = new URL(callbackUrl); const code = url.searchParams.get("code"); const state = url.searchParams.get("state"); if (!code || !state) throw new Error("Invalid authentication callback");
    const verifier = await keytar.getPassword(service, `oauth:${state}`); if (!verifier) throw new Error("Authentication state expired");
    const response = await fetch(`${this.apiOrigin}/v1/auth/exchange`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, state, verifier, redirectUri: "practice-ai://auth/callback" }) });
    if (!response.ok) throw new Error(`Authentication exchange failed (${response.status})`);
    const payload = await response.json() as { accessToken: string; account: { id: string; displayName: string; email: string } };
    await keytar.setPassword(service, "access-token", payload.accessToken); await keytar.setPassword(service, "account", JSON.stringify(payload.account)); await keytar.deletePassword(service, `oauth:${state}`);
    return payload.account;
  }
  async signOut() { await keytar.deletePassword(service, "access-token"); await keytar.deletePassword(service, "account"); }
  saveSecret(account: string, secret: string) { return keytar.setPassword(service, `provider:${account}`, secret).then(() => undefined); }
  readSecret(account: string) { return keytar.getPassword(service, `provider:${account}`); }
}

