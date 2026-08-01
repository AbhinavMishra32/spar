import keytar from "keytar";

const service = "ai.spar.desktop";
export class AuthService {
  constructor(private readonly apiOrigin: string) {}
  async account() { const raw = await keytar.getPassword(service, "account"); return raw ? JSON.parse(raw) as { id: string; displayName: string; email: string } : null; }
  async accessToken() { return keytar.getPassword(service, "access-token"); }
  async password(mode: "sign-in" | "sign-up", email: string, password: string) {
    const response = await fetch(`${this.apiOrigin}/v1/auth/password/${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    const payload = await response.json() as { accessToken?: string; account?: { id: string; displayName: string; email: string }; error?: string };
    if (!response.ok || !payload.accessToken || !payload.account) throw new Error(payload.error ?? `Authentication failed (${response.status})`);
    await keytar.setPassword(service, "access-token", payload.accessToken); await keytar.setPassword(service, "account", JSON.stringify(payload.account));
    return payload.account;
  }
  async signOut() { await keytar.deletePassword(service, "access-token"); await keytar.deletePassword(service, "account"); }
  saveSecret(account: string, secret: string) { return keytar.setPassword(service, `provider:${account}`, secret).then(() => undefined); }
  readSecret(account: string) { return keytar.getPassword(service, `provider:${account}`); }
  deleteSecret(account: string) { return keytar.deletePassword(service, `provider:${account}`).then(() => undefined); }
  saveProviderOAuth(provider: string, credentials: unknown) { return keytar.setPassword(service, `provider-oauth:${provider}`, JSON.stringify(credentials)).then(() => undefined); }
  async readProviderOAuth<T>(provider: string): Promise<T | null> {
    const raw = await keytar.getPassword(service, `provider-oauth:${provider}`);
    if (!raw) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  }
  deleteProviderOAuth(provider: string) { return keytar.deletePassword(service, `provider-oauth:${provider}`).then(() => undefined); }
}
