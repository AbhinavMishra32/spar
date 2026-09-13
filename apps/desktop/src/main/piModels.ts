import type { AuthContext, Credential, CredentialInfo, CredentialStore, MutableModels, OAuthCredentials } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";

/**
 * pi's auth surface, over Spar's own credential storage.
 *
 * pi used to expose `getOAuthApiKey(providerId, credentials)` — hand it the
 * tokens, get back a key and any rotation, and store the rotation yourself. It
 * now owns refresh, and reads and writes through a `CredentialStore` the host
 * provides, so that two concurrent requests cannot both refresh a rotated
 * token. That is a better contract and it is also the only one left, so this
 * is the store.
 *
 * Nothing moves house. The learner's tokens stay exactly where they already are
 * — the OS keychain, under Spar's own provider ids — because a migration that
 * signs everyone out of their Claude and ChatGPT subscriptions in order to
 * change an internal interface is not a migration anyone asked for. This maps
 * between the two namings and adds the type tag pi wants; the bytes in the
 * keychain are the same bytes they were before.
 */

/** The slice of Spar's `AuthService` this needs. Narrow on purpose: it is the
 *  whole contract, so a test double is three functions. */
export type OAuthVault = {
  readProviderOAuth<T>(provider: string): Promise<T | null>;
  saveProviderOAuth(provider: string, credentials: unknown): Promise<unknown>;
  deleteProviderOAuth(provider: string): Promise<void>;
};

/**
 * Spar's provider id for one of pi's.
 *
 * Only Claude differs: Spar calls the subscription `claude-code` because that
 * is what the learner signed into, and pi calls the runtime `anthropic`
 * because that is whose API it speaks. Every other id is the same word on both
 * sides. Spar's own `anthropic` provider is the API-key one, which never comes
 * through here — it is a keychain secret, resolved without pi.
 */
export const sparProviderId = (runtimeId: string) => (runtimeId === "anthropic" ? "claude-code" : runtimeId);

/** The providers Spar stores OAuth for, for `list()`. Read rather than indexed:
 *  a second list of who is signed in is a second thing that can be wrong about
 *  the keychain. */
const OAUTH_PROVIDERS = ["anthropic", "openai-codex", "github-copilot"] as const;

/** pi tags a stored credential with its kind; Spar's keychain entries predate
 *  the tag and are OAuth by construction — `provider-oauth:<id>` is written by
 *  one code path. So the tag is added on the way out and stripped on the way
 *  in, and no existing entry needs rewriting to be readable. */
const tagged = (credentials: OAuthCredentials): Credential => ({ type: "oauth", ...credentials });

export function sparCredentialStore(vault: OAuthVault): CredentialStore {
  /* One in-flight write per provider. pi's contract is that `modify` is
     serialized, because the writes that matter are read-modify-writes — a
     refresh and a login can land together, and the second must see what the
     first wrote. A promise chain per id is that guarantee within this process,
     which is the only process holding Spar's keychain open. */
  const queues = new Map<string, Promise<unknown>>();

  const read = async (runtimeId: string): Promise<Credential | undefined> => {
    const stored = await vault.readProviderOAuth<OAuthCredentials>(sparProviderId(runtimeId));
    return stored ? tagged(stored) : undefined;
  };

  return {
    read,
    async list(): Promise<readonly CredentialInfo[]> {
      const found = await Promise.all(OAUTH_PROVIDERS.map(async (id): Promise<CredentialInfo | null> =>
        (await vault.readProviderOAuth(sparProviderId(id))) ? { providerId: id, type: "oauth" } : null));
      return found.filter((entry): entry is CredentialInfo => entry !== null);
    },
    modify(runtimeId, fn) {
      const run = (queues.get(runtimeId) ?? Promise.resolve()).then(async () => {
        const current = await read(runtimeId);
        const next = await fn(current);
        /* Undefined means "leave it alone", which is not "delete it": a refresh
           that finds the token still valid returns nothing. */
        if (next === undefined) return current;
        const { type: _type, ...credentials } = next as Credential & Record<string, unknown>;
        await vault.saveProviderOAuth(sparProviderId(runtimeId), credentials);
        return next;
      });
      /* The queue holds the settled chain, not the result: one failed write must
         not poison every write after it, while the caller still sees its own
         rejection. */
      queues.set(runtimeId, run.catch(() => undefined));
      return run;
    },
    async delete(runtimeId) {
      await vault.deleteProviderOAuth(sparProviderId(runtimeId));
    },
  };
}

/**
 * Deliberately blind to the machine.
 *
 * pi falls back to ambient credentials — environment variables, `~/.aws`,
 * application default credentials — when the host has nothing stored. Spar does
 * not: a learner's provider is the one they connected in Settings, and picking
 * up an `ANTHROPIC_API_KEY` that happens to be exported in the shell that
 * launched the app would bill a key they never chose and cannot see. Spar's own
 * fallback order lives in `provider.ts` and stays the only one.
 */
const sealedContext: AuthContext = {
  env: async () => undefined,
  fileExists: async () => false,
};

export function createSparModels(vault: OAuthVault): MutableModels {
  return builtinModels({ credentials: sparCredentialStore(vault), authContext: sealedContext });
}
