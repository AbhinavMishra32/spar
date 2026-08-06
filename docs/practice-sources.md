# Practice sources

Spar writes challenges. A practice source is somewhere problems already exist,
and this is how one is plugged in.

The word is deliberate. In Spar, *provider* already means the model a turn runs
on, and putting LeetCode in that list would say the two are the same kind of
thing. They are not: a provider decides what thinks, a source decides what you
are asked.

LeetCode is the first source. The design below is what a second one would have
to satisfy, and nothing above the source layer knows LeetCode exists.

## What a source is

`packages/practice` holds the abstraction and the one implementation.

| Module | What it owns |
| --- | --- |
| `types.ts` | The vocabulary: a problem, a case, a verdict, a source's capabilities. Mentions no particular site. |
| `sources.ts` | The registry, and the only place that decides what a source may claim it can do. |
| `concepts.ts` | Translation between the source's tags and Spar's concept vocabulary, both directions. |
| `harness.ts` | Turning a problem into a workspace the local runner can grade, and the marker contract that keeps the learner's file submittable. |
| `gateway.ts` | The seam every consumer talks to a source through. |
| `leetcode/*` | Every fact about LeetCode's API. |
| `mcp/*` | The tools, as an MCP server. |

Sources differ in exactly one interesting way: how much of the loop they can
close. LeetCode can search, describe, judge and record a solve. A scraped corpus
can only describe. So everything downstream branches on
`PracticeSourceCapabilities` rather than on the source's name:

```ts
type PracticeSourceCapabilities = {
  remoteJudge: boolean;        // the source will grade a submission
  officialTestcases: boolean;  // the problem ships its own inputs
  search: boolean;
  progress: boolean;           // what this learner has already done there
  submissionHistory: boolean;
};
```

`effectiveCapabilities` intersects that with the connection state, because a
disconnected LeetCode still describes problems — its statements are public — and
loses only the parts that are about *this learner*.

## Signing in

LeetCode has no OAuth, no device flow and no API tokens. A browser session is the
credential: `LEETCODE_SESSION` proves who you are and `csrftoken` is echoed as a
header on every mutating request. Every client that works in the field does this,
including the two Spar's implementation is derived from.

That leaves one honest way for a desktop app to obtain one. Spar opens LeetCode's
own sign-in page in a window and watches the cookie jar:

- **Spar never sees a password.** The learner types into leetcode.com. Password,
  Google, GitHub and passkeys all work, because all of them are LeetCode's flows
  in LeetCode's page.
- **The window is sandboxed and partitioned.** Its own `persist:` partition, no
  preload, no node integration, context isolation on. The site's cookie jar is
  walled off from everything else the app does.
- **Cookies are not the completion test.** LeetCode issues both cookies to
  anonymous visitors, so waiting for them finishes before the learner has typed
  anything. Spar polls the jar cheaply and asks `userStatus` whenever it changes;
  the flow completes when LeetCode names an account.
- **Disconnecting clears the partition**, not just the keychain entry.

The session is stored in the OS keychain beside the model provider keys, keyed by
region, and is dropped on sign-out and account deletion. It never crosses into
the renderer, the local database, or a worker process.

## Who grades what

The most important fact about a sourced challenge, and the one thing the app must
never get wrong.

| Situation | Graded by | What a pass means |
| --- | --- | --- |
| Source connected, judging preference `source` | LeetCode | Every hidden case the problem has passed. It counts on the learner's account. |
| Source disconnected, or preference `local` | Spar's runner | The examples published with the problem passed. Nothing more. |
| Neither available | Nothing | The problem is refused at assignment time rather than set. |

The answer is resolved once, at mount, and stamped onto the challenge as a
`ChallengeSource` — including `judge`, the sentence the learner reads. A
challenge solved offline still reports honestly a month later instead of
implying an acceptance that never happened.

`errored` is a third verdict outcome, separate from `failed`. A rate limit, an
outage or a dead session is the judge failing, not the learner, and it is never
written into the attempt's evidence.

## Running a problem locally

A sourced problem has to be runnable without spending a submission. The harness
generates the same layout a Spar-written challenge has — implementation under
`src/`, tests under `tests/`, graded by exit code — so the runner, the result
panel and the replay need no special case.

Two constraints shape it.

**The learner's file stays submittable.** Whatever sits between the markers is
what gets posted to the judge, byte for byte:

```js
// spar:solution:start
var twoSum = function(nums, target) {
};
// spar:solution:end

export { twoSum as entry };   // outside the region, never submitted
```

**A case Spar cannot express is refused, not approximated.** A design problem
with no single entry point, or a signature taking a `TreeNode*`, comes back
`supported: false` with the reason, and the source's judge carries it. Emitting a
harness that tests the wrong thing is the one failure a learner cannot diagnose.

The expected answers are the interesting part. LeetCode publishes a problem's
sample *inputs* through its API and its expected *outputs* only in the statement
prose — the site computes them with the judge — so `statement.ts` recovers the
examples from the HTML. Without that, no problem could be run at all offline.

## The MCP surface

The tools are a bounded, described, schema-validated surface over somebody else's
service, which is what the protocol is for. One registry serves two callers:

- **Spar's agent**, over an in-memory transport (`connectPracticeMcp`). Real
  protocol — described tools, validated arguments, a listing the host does not
  hardcode — without a subprocess to spawn, ship and supervise.
- **Any other MCP client**, over stdio (`spar-practice-mcp`). Point Claude Code
  at it and you get the same tools.

The split between them is which tools each gets:

| Tool | Spar's agent | stdio |
| --- | --- | --- |
| `search_practice_problems`, `read_practice_problem`, `read_practice_source`, `read_practice_progress`, `read_practice_submissions`, `read_daily_practice_problem` | yes | yes |
| `run_practice_code`, `submit_practice_solution` | **no** | yes |

Spar's agent may learn anything the source knows and change nothing there. The
difference is who asked: a person typing into an MCP client is deciding to submit
their own work, where Spar's agent would be putting its code on somebody's
LeetCode record. A coding gym whose tutor can solve for you is not measuring you.

Running the stdio server:

```bash
LEETCODE_SESSION="…" LEETCODE_CSRF="…" npx spar-practice-mcp
```

Credentials come from the environment and nowhere else — no config file to leak a
credential that can spend an account. Statements are public, so search and reads
work unauthenticated; the learner's history and the judge do not.

## How the agent uses it

The guarantee that Spar actually uses real problems lives in the stage machine
(`workers/agentPolicy.ts`), not in the prompt, because a prompt is a request and
a stage is a fact. On any turn that will set a challenge, a connected source adds:

1. one **required** `search_practice_problems` before the decision, then
2. `assign_practice_problem` and `create_question` offered **together**, still
   required.

So a turn cannot end without either setting a real problem or consciously writing
one — and it cannot write one without having first looked at what already exists.
A model that ignores its instructions cannot skip either step.

`assign_practice_problem` is held to the same lifecycle rules as
`create_question` — one open challenge, no repeating a problem already set — plus
one of its own: it refuses a problem nothing could grade. It takes the *aim* as
well as the slug, because a challenge in the ledger with no statement of what it
was testing is evidence no later turn can read.

The deterministic compiler is not run over a sourced design. There is nothing to
compile: no reference solution to check the tests against, and the visible suite
is whatever the source published. What replaces that guarantee is the source's
own judge, stated rather than assumed.

## Adding a second source

1. Implement `PracticeGateway` for it.
2. Add a descriptor to `PRACTICE_SOURCES` with honest `capabilities`.
3. Map its tags in `concepts.ts`, both directions.
4. Give it a mark in `SourceGlyph.tsx`.

Nothing else should need to change. If it does, the seam is in the wrong place.
