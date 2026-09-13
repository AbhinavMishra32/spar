<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/icon-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/icon-light.png">
    <img src="docs/assets/icon-dark.png" alt="Spar" width="128" height="128">
  </picture>
</p>

<h1 align="center">Spar</h1>

<p align="center">
  A coding gym that watches you work and writes your next exercise.
  <br>
  macOS · Windows · Linux — <a href="https://github.com/AbhinavMishra32/spar/releases/latest">download the latest release</a>
</p>

---

Practice sites hand everyone the same ladder, and nothing about the next problem
knows what happened in the last one. Spar works the other way round: it watches
how an attempt actually goes — what you wrote, what you ran, where you stalled,
what finally passed — and writes your next exercise against the specific thing it
thinks you can't do yet.

<p align="center">
  <img src="docs/assets/screenshots/workspace.png" alt="A Spar challenge open: the problem statement and sample cases on the left, the file being repaired in the editor, and the declared test cases below it." width="900">
</p>

<p align="center">
  <sub>A challenge Spar wrote after watching four earlier attempts. The bug is real,
  the tests are committed, and the clock top-right has been running since the
  attempt opened.</sub>
</p>

## Getting Spar

Grab the build for your machine from the
[latest release](https://github.com/AbhinavMishra32/spar/releases/latest) — a
`.dmg` for Mac (Apple silicon or Intel), an `.exe` for Windows, an `.AppImage` or
`.deb` for Linux.

**Builds are not code-signed yet**, so your OS will say so in its usual alarming
way. On a Mac, right-click the app and choose *Open* the first time, or run
`xattr -d com.apple.quarantine /Applications/Spar.app`. On Windows, choose *More
info* → *Run anyway*.

Two things are yours to bring. **A model:** Spar doesn't ship one or resell one —
point it at something you already pay for or run yourself. **A backend:** Spar
signs you in against the Spar API, and there is no Spar-operated service, so you
deploy it or run it locally. [`docs/hosting.md`](docs/hosting.md) covers both in
a few commands.

## Your first session

You answer seven questions once per account: who you are, what you want to get
better at, where you tend to get stuck, which language, which model, and
optionally a problem provider. The one about getting stuck is worth answering
properly — *"I can read async code but I never know what actually needs awaiting"*
gives Spar somewhere to start, and *"I'm bad at algorithms"* doesn't.

Then you get a challenge: a problem statement, a workspace with real files, a
test suite, and a terminal. Not a text box with a function signature in it. You
work, and the attempt is recorded as it happens — edits, runs, what the tests
said, how long you sat on each part. You submit, the tests decide, and Spar tells
you what your attempt was evidence of and what it wants to check next. That
becomes the target for the next one.

## What's in the app

### Challenges written for you, proven before you see them

Every challenge is generated for the target Spar picked, so nobody else is
getting your exercise and you can't look up the answer.

Generated exercises have an obvious failure mode — wrong tests, impossible
problems, a "correct" solution that doesn't pass. So before a challenge reaches
you it has to survive a mechanical check: the reference solution passes every
test; deliberately broken versions pass the *visible* tests, proving that suite
is genuinely incomplete; those broken versions fail the hidden ones; and the
files, commands and language all agree. A challenge that fails any of these never
reaches you.

### Verdicts you can trust

Your submission is graded by running the committed tests and reading the exit
code. There is no model in that path. Nothing you write to the agent, and nothing
it decides it likes about you, can turn a failing program into a passing
submission — or the reverse.

This is the line Spar draws down the middle of itself: the agent proposes what
you should practise and explains what your work shows, and it is never the
authority on whether your code is correct. A tutor that can be talked into
agreeing with you is not measuring anything.

<p align="center">
  <video src="https://tryspar.dev/submission.mp4" poster="https://github.com/AbhinavMishra32/spar/raw/main/docs/assets/screenshots/submission.webp" controls muted loop playsinline width="780"></video>
</p>

<p align="center">
  <sub>A submission going through: the tests run, each case reports back, and the
  first failure is selected for you with its input, your output and the expected
  value side by side.</sub>
</p>

### The workspace

A file tree, a real editor, the problem statement, test results and a terminal,
in resizable panes in one window. Alongside them sits the agent: you can ask it
things mid-attempt, and it can ask you things back. It says what it is about to
do before each phase, so you are never watching a spinner wondering what is
happening.

The panel under the editor is where a run lands. **Testcase** is what the visible
suite declares before you run anything. **Test Result** fills in per-case
verdicts, selecting the first failure rather than making you hunt for it.
**Attempt** is the replay: every edit and run, timestamped from the moment the
attempt opened.

### The ability ledger

The page that answers "what am I actually good at now".

It keeps two things strictly apart. An **earned** ability is one your submissions
have demonstrated, more than once. An **uncertain** one is a hypothesis Spar
wrote when it set a target. They are drawn differently and never merged, because
a page that shows a guess in the same style as three passing submissions is
claiming things on your behalf.

<p align="center">
  <img src="docs/assets/screenshots/ability-detail.png" alt="An ability page: the claim, its status, evidence counts, the concepts it covers, suggested next goals, and the list of challenges that earned it." width="900">
</p>

Open one and it shows its work: the claim in plain language — *you can repair
TypeScript loop boundaries across scalar counters and array scans* — and under it
the receipt. How much evidence backs it, which version of the claim this is, and
the exact attempts that earned it. **Go further** turns it into the next
session's goal.

### Concepts

Every challenge is tagged with what it exercises. Hover a tag anywhere in the app
for a straight answer about that concept — passed, failed, still open, and the
attempts behind each. Click through for everything you have ever done under it,
and a button that starts a session aimed squarely at it. This is how you find out
whether "closures" is a real gap or one bad afternoon.

<p align="center">
  <img src="docs/assets/screenshots/concept-sheet.png" alt="The concept sheet for loop boundary tracing: a Steady verdict across 8 challenges and 52 test runs, the abilities covering it, the full challenge list, and a Practise this button." width="760">
</p>

Work is organised into sessions, and nothing is thrown away — a session you
abandoned is still evidence. Every challenge Spar has ever written for you stays
in the history, filterable by open, passed, or replaced.

### Real problems, when a real problem fits

Connect LeetCode or Codeforces in Settings and the agent can set you real
problems alongside the ones it invents — same target, same ability ledger, same
history. You sign in on the source's own page; Spar never sees your password.

The agent is *made* to look: on any turn that sets a challenge it searches the
source first, then either assigns what it found or consciously writes its own.
That is a property of the controller, not a line in a prompt. A sourced problem
brings a difficulty other people calibrated and hidden cases nobody in Spar
wrote; a written one brings something no library has.

Submit a sourced problem and it goes to that judge, runs against every hidden
case, and appears on your account there like any other submission. Not connected?
Fine — Spar checks against the examples published with the problem and will never
describe that as an acceptance. A problem it can neither judge nor run is refused
rather than set.

### Bring your own model

**A subscription you already have** — OpenAI Codex, Claude Code or GitHub
Copilot, through their own sign-in. **An API key** for OpenAI, Anthropic, Google,
xAI, DeepSeek, Moonshot, Z.ai, MiniMax, OpenRouter, Cline, Vercel or Cloudflare
AI Gateway, or any OpenAI-compatible endpoint. **Or locally** with Ollama or LM
Studio, and never send your work anywhere.

Keys are held in your operating system's keychain, not in a config file in your
home directory.

## Current limits

- **Ten languages** for Spar-authored challenges: JavaScript, TypeScript, Python,
  Java, C, C++, Go, Rust, Swift, Ruby.
- **Two practice sources.** LeetCode and Codeforces; HackerRank and CodeChef are
  planned, not working.
- **Hosting is yours to set up.** There is no Spar-operated service.
- **Unsigned builds.** Your OS will complain on first launch.
- **macOS is the polished one.** Windows and Linux builds are real, but the Mac
  is where the chrome and materials have had the attention.

## Where your work lives

**On your machine:** the challenge files, your in-flight attempt, your settings,
and a working copy of your history. Model keys go to the system keychain.

**On the backend you point Spar at:** your account and the canonical copy of your
learning history, so it survives a reinstall and follows you to another machine.

**To your model provider:** the challenge and your conversation with the agent,
because that is what running a model means. If that matters for your work, run a
local model.

Spar has no analytics and no telemetry.

## For developers

This repository is the whole product: the desktop app, the API, the deterministic
challenge compiler, and the landing page.

- [`docs/architecture.md`](docs/architecture.md) — how the processes are split and
  why the renderer is treated as untrusted
- [`docs/threat-model.md`](docs/threat-model.md) — what runs untrusted code and
  what contains it
- [`docs/practice-sources.md`](docs/practice-sources.md) — how a source of real
  problems is plugged in, and who grades what
- [`docs/hosting.md`](docs/hosting.md) — deploying the API, and how a build learns
  which one to talk to
- [`docs/releasing.md`](docs/releasing.md) — how a release is cut

Running it locally, on macOS with Node 22 and pnpm 10.13.1:

```bash
corepack pnpm install
corepack pnpm dev
```

The first run asks for a PostgreSQL connection URL and object-storage
credentials, writes them to a git-ignored `.env.local`, applies migrations,
creates the bucket, and starts the API and the app together. After that,
`corepack pnpm dev` is the whole command.
