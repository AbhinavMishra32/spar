# Releasing

A release is cut from a `v*` tag. Nothing else publishes.

## The contract

1. Bump the version in `package.json` and `apps/desktop/package.json` (and the
   other workspace manifests, which are kept in step) and commit it.
2. Write the release notes to `.github/release-notes/v<version>.md`.
3. Tag `v<version>` and push the tag.

The `Release` workflow then runs three stages:

- **Verify** — installs, checks that the tag agrees with the manifests, then
  `typecheck`, `test`, and `build`. A tag that disagrees with the manifests fails
  here rather than producing installers whose in-app version does not match the
  release they came from.
- **Package** — one job per platform, in parallel and independently, so a failure
  on one platform does not lose the others:

  | Platform | Runner | Artifacts |
  | --- | --- | --- |
  | macOS | `macos-15` | `.dmg` and `.zip`, arm64 and x64 |
  | Windows | `windows-2025` | NSIS `.exe`, x64 |
  | Linux | `ubuntu-24.04` | `.AppImage` and `.deb`, x64 |

  Each job builds, rebuilds the native modules for Electron, and packages with
  `--publish never`. Installers, `latest*.yml`, and blockmaps are uploaded as
  workflow artifacts.
- **Publish** — downloads every artifact and creates the GitHub release from
  `.github/release-notes/<tag>.md`, with `--verify-tag`. Re-running against an
  existing release uploads with `--clobber` instead of failing.

`workflow_dispatch` takes an existing tag and does the same thing, which is how a
release is rebuilt after a packaging failure.

## Signing

Signing is opt-in. When `MACOS_CERTIFICATE_BASE64` is present in the repository
secrets the macOS job signs with it, and passes `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` through for notarization. When
it is absent the job sets `CSC_IDENTITY_AUTO_DISCOVERY=false`, logs a warning, and
produces an unsigned build rather than failing — so the result never depends on
whatever happens to be in the runner's keychain.

Unsigned builds run, but they carry the download quarantine flag, so first launch
needs a right-click → *Open* on macOS or *Run anyway* on Windows. Say so in the
release notes for as long as that is true.

Windows builds are unsigned in all cases; there is no certificate for them yet.

## Icons

`apps/desktop/build/` holds committed icon artifacts because rendering them needs
AppKit and only the macOS job has it. Regenerate them on a Mac with
`pnpm --filter @spar/desktop icons` and commit the result — see
[`apps/desktop/scripts/icon/README.md`](../apps/desktop/scripts/icon/README.md).

## Updates

Packaged builds check for updates only when `SPAR_ENABLE_UPDATES=1` is set.
`latest*.yml` is published with every release regardless, so enabling the flag in
a later build finds a complete update feed behind it. Update artifacts are
signature-checked before installation and install on quit.
