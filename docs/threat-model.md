# Threat model

The primary trust boundaries are renderer-to-main IPC, generated-code execution, OAuth callbacks, provider credentials, and backend resource ownership.

- Electron uses context isolation, renderer sandboxing, no Node integration, a restrictive CSP, and an allowlisted preload API.
- IPC payloads are schema-validated. Workspace paths are resolved beneath an account-specific root.
- Generated programs execute in a utility process with command allowlists, timeouts, output limits, and process-tree termination. Production packaging can replace the local runner adapter with a hardened macOS sandbox without changing domain contracts.
- OAuth uses PKCE, state, an application callback protocol, and server-minted short-lived access tokens.
- BYOK secrets are stored through macOS Keychain and never serialized into renderer state.
- Backend queries are scoped by authenticated user id. Snapshot downloads use short-lived signed URLs.
- Attempt events are immutable and idempotent by event id.

