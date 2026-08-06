# Threat model

The primary trust boundaries are renderer-to-main IPC, generated-code execution, OAuth callbacks, provider credentials, and backend resource ownership.

- Electron uses context isolation, renderer sandboxing, no Node integration, a restrictive CSP, and an allowlisted preload API.
- IPC payloads are schema-validated. Workspace paths are resolved beneath an account-specific root.
- Generated programs execute in a utility process with command allowlists, timeouts, output limits, and process-tree termination. Production packaging can replace the local runner adapter with a hardened macOS sandbox without changing domain contracts.
- OAuth uses PKCE, state, an application callback protocol, and server-minted short-lived access tokens.
- BYOK secrets are stored through macOS Keychain and never serialized into renderer state.
- Backend queries are scoped by authenticated user id. Snapshot downloads use short-lived signed URLs.
- Attempt events are immutable and idempotent by event id.
- A practice source's session is a live browser credential for someone's account on a third-party site, and is treated as one. Sign-in runs in a sandboxed window on its own persisted partition — no preload, no Node integration, context isolation on — so the site's cookie jar is isolated from the app's. The session is stored in the OS keychain, never reaches the renderer or the local database, and is cleared on disconnect, sign-out and account deletion along with the partition itself.
- The agent is given the source's read tools only. Running and submitting exist on the MCP server for external clients driven by a person; nothing in Spar's own loop can execute or submit code on the learner's account at a source.
- Cached source problems are account data, not a public cache: the stored copy records what this learner has solved, so it is dropped with the rest of their state.

