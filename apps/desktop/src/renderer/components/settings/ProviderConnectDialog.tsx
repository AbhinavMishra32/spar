import { useEffect, useState } from "react";
import { Check, Loader2, Trash2 } from "lucide-react";
import type { ProviderId, ProviderInventory, ProviderOAuthEvent, SparApi } from "../../../shared/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { message } from "@/lib/format";
import { credentialStore } from "@/lib/platform";
import { ProviderGlyph } from "../common/ProviderGlyph";
import { SparWordmark } from "../common/SparWordmark";
import { ModelSelectField } from "./ModelSelect";

export type Provider = ProviderInventory["providers"][number];

/**
 * The one place a provider is connected. Settings and onboarding both open it,
 * so the OAuth handshake, the key form, and the disconnect path exist once —
 * a second copy of this would be a second set of ways to leave a flow half-done.
 *
 * It owns the whole exchange and reports back through `onConnected`; the caller
 * only decides which provider is open.
 */
export function ProviderConnectDialog({
  api,
  provider,
  onClose,
  onConnected,
  allowDisconnect = true,
}: {
  api: SparApi | undefined;
  provider: Provider | null;
  onClose(): void;
  onConnected(): Promise<void> | void;
  allowDisconnect?: boolean;
}) {
  const [secret, setSecret] = useState("");
  const [modelId, setModelId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [oauth, setOauth] = useState<ProviderOAuthEvent | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Reset per provider rather than per open: reopening the same row should not
  // discard a code the learner is midway through pasting.
  useEffect(() => {
    if (!provider) return;
    setSecret("");
    setModelId(provider.selectedModel || provider.models[0]?.id || "");
    setBaseUrl(provider.baseUrl);
    setOauth(null);
    setManualCode("");
    setError("");
  }, [provider?.id]);

  useEffect(() => {
    if (!api) return;
    return api.onProviderOAuthEvent((event) => {
      setOauth((current) => (current?.flowId === event.flowId || !current ? event : current));
      if (event.status === "connected") {
        void onConnected();
        setBusy(false);
      }
      if (event.status === "error" || event.status === "cancelled") setBusy(false);
    });
  }, [api, onConnected]);

  if (!provider) return null;

  const close = (next: boolean) => {
    if (next) return;
    if (api && oauth && !["connected", "cancelled", "error"].includes(oauth.status)) void api.cancelProviderOAuth(oauth.flowId);
    setOauth(null);
    setBusy(false);
    setError("");
    onClose();
  };

  const save = async () => {
    if (!api || provider.kind === "subscription") return;
    setBusy(true);
    setError("");
    try {
      await api.saveProviderSecret({
        provider: provider.id as Exclude<ProviderId, "openai-codex" | "claude-code" | "github-copilot">,
        model: modelId.trim(),
        baseUrl: baseUrl.trim(),
        secret,
      });
      await onConnected();
      onClose();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const startOAuth = async () => {
    if (!api || provider.kind !== "subscription") return;
    setBusy(true);
    setError("");
    try {
      const value = await api.startProviderOAuth(provider.id as "openai-codex" | "claude-code" | "github-copilot");
      setOauth((current) => (current?.flowId === value.flowId ? current : { flowId: value.flowId, provider: provider.id, status: "starting", message: "Opening sign-in…" }));
    } catch (cause) {
      setBusy(false);
      setError(message(cause));
    }
  };

  const disconnect = async () => {
    if (!api) return;
    setError("");
    try {
      await api.disconnectProvider(provider.id);
      await onConnected();
      onClose();
    } catch (cause) {
      setError(message(cause));
    }
  };

  return (
    <Dialog onOpenChange={close} open>
      <DialogContent className="sm:max-w-[30rem]">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <span className="grid size-6 shrink-0 place-items-center text-foreground/85">
              <ProviderGlyph className="size-[1.15rem]" provider={provider.id} />
            </span>
            <DialogTitle>{provider.state === "connected" ? `Update ${provider.name}` : `Connect ${provider.name}`}</DialogTitle>
          </div>
          {/* Inline flow, not flex: the wordmark opens the sentence, so it has to sit on the
              first line's baseline rather than centre itself against the wrapped block. */}
          <DialogDescription>
            <SparWordmark className="text-foreground" />{" "}
            {provider.kind === "subscription" ? `will use your subscription to reach ${provider.name} models. Sign in to connect the account.` : provider.description}
          </DialogDescription>
        </DialogHeader>

        {provider.kind === "subscription" ? (
          <div className="space-y-3">
            {oauth && (
              <div className="rounded-xl border border-border bg-[var(--color-background-elevated-secondary)] p-3 text-ui">
                <p className="flex items-center gap-1.5 font-medium">
                  {!["connected", "error", "cancelled"].includes(oauth.status) && <Loader2 className="size-3 animate-spin" />}
                  {oauth.status === "connected" ? "Connected" : oauth.status === "error" ? "Sign-in failed" : "Waiting for sign-in"}
                </p>
                <p className="mt-1 text-muted-foreground">{oauth.message}</p>
              </div>
            )}
            {oauth?.status === "prompt" && (
              <div className="space-y-2 rounded-xl border border-border p-3">
                <label className="text-ui font-medium" htmlFor="provider-oauth-code">Authorization code</label>
                <Input autoFocus id="provider-oauth-code" onChange={(event) => setManualCode(event.target.value)} placeholder={oauth.placeholder ?? "Paste code or redirect URL"} value={manualCode} />
                <Button disabled={busy || (!manualCode.trim() && !oauth.allowEmpty)} onClick={() => { if (api) void api.submitProviderOAuth(oauth.flowId, manualCode); }} size="sm">Continue</Button>
              </div>
            )}
            {oauth?.status === "connected" && <p className="inline-flex items-center gap-1 text-ui text-success"><Check className="size-3.5" />Your subscription is ready for Spar.</p>}
          </div>
        ) : (
          <div className="space-y-3">
            {provider.keyUrl && <p className="text-ui text-muted-foreground">Get a key from <button className="underline underline-offset-2 hover:text-foreground" onClick={() => void api?.openExternal(provider.keyUrl!)} type="button">{provider.name}</button>.</p>}
            {/* A datalist stood here, which meant the one field with hundreds of
                right answers was the one field with no way to see them. */}
            <div className="space-y-1.5">
              <label className="block text-ui font-medium" htmlFor={`model-${provider.id}`}>Model</label>
              <ModelSelectField id={`model-${provider.id}`} models={provider.models} onChange={setModelId} value={modelId} />
            </div>
            <label className="block space-y-1.5 text-ui font-medium">Base URL<Input onChange={(event) => setBaseUrl(event.target.value)} value={baseUrl} /></label>
            {provider.kind !== "local" && <label className="block space-y-1.5 text-ui font-medium">API Key<Input autoComplete="off" onChange={(event) => setSecret(event.target.value)} placeholder={provider.state === "connected" ? "Leave blank to keep the current key" : `Stored only in ${credentialStore}`} type="password" value={secret} /></label>}
          </div>
        )}

        {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-ui text-destructive">{error}</p>}
        <DialogFooter className="justify-between sm:justify-between">
          <div>{allowDisconnect && provider.state === "connected" && <Button disabled={busy} onClick={() => void disconnect()} variant="destructive"><Trash2 />Disconnect</Button>}</div>
          <div className="flex gap-2">
            <Button onClick={() => close(false)} variant="secondary">Cancel</Button>
            {provider.kind === "subscription"
              ? <Button disabled={busy || (!!oauth && !["error", "cancelled"].includes(oauth.status))} onClick={() => void startOAuth()}>{busy && <Loader2 className="animate-spin" />}Connect</Button>
              : <Button disabled={busy || !modelId.trim() || !baseUrl.trim() || (provider.kind === "api-key" && provider.state !== "connected" && !secret.trim())} onClick={() => void save()}>{busy && <Loader2 className="animate-spin" />}{provider.state === "connected" ? "Update" : "Connect"}</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
