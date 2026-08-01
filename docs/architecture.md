# Architecture decision record

## Process ownership

```text
Sandboxed renderer
  -> narrow typed preload API
    -> Electron main (auth, windows, IPC authorization, persistence coordination)
      -> agent utility process (Mastra orchestration only)
      -> execution utility process (allowlisted runners and process limits)
      -> local SQLite working state
      -> authenticated cloud API
```

The renderer is treated as untrusted presentation code. IPC handlers validate every input and never expose generic filesystem, shell, or network primitives.

## Provider reuse decision

Construct's current TypeScript implementation was inspected before this layer was designed. Spar adapts its useful boundaries:

- host-owned provider settings injected into the utility process;
- normalized streaming text, reasoning, tool-call, tool-result, finish, error, and usage events;
- provider-independent model selection;
- OpenAI-compatible gateway/BYOK modes;
- trace identifiers and cumulative token usage.

Construct's concrete configuration and Flow types are not imported because they are application-specific and live in another repository. The shared behavior is represented by the provider contracts in `packages/provider` so this repository does not depend on Construct's release lifecycle.

## Persistence

PostgreSQL is the canonical account and learning-history store. SQLite is a local-first working copy. Attempt events are append-only; interpretations are versioned documents. Object storage owns immutable challenge artifacts and workspace snapshots.

## Training agent

There is one pedagogical agent. It receives a compact checkpoint and must retrieve history through focused tools. Deterministic services validate questions, execute code, enforce permissions, and commit state transitions.

