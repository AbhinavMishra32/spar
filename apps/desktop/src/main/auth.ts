import keytar from "keytar";

const service = "ai.practice.desktop";
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
}
