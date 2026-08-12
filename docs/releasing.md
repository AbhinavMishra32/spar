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

Signing is mandatory for macOS and Windows releases. This is not cosmetic:
`electron-updater` verifies that a replacement binary belongs to the same
publisher before handing it to the native installer. Publishing an unsigned
installer would therefore publish an update that the in-app experience cannot
honestly promise to install.

The macOS job requires `MACOS_CERTIFICATE_BASE64`,
`MACOS_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and
`APPLE_TEAM_ID`. It signs with Developer ID and notarizes with Apple. The Windows
job requires `WINDOWS_CERTIFICATE_BASE64` and
`WINDOWS_CERTIFICATE_PASSWORD` for Authenticode signing. A missing release
identity fails its platform job before an unsigned artifact can reach GitHub.

## Icons

`apps/desktop/build/` holds committed icon artifacts because rendering them needs
AppKit and only the macOS job has it. Regenerate them on a Mac with
`pnpm --filter @spar/desktop icons` and commit the result — see
[`apps/desktop/scripts/icon/README.md`](../apps/desktop/scripts/icon/README.md).

## Updates

Every packaged build checks the GitHub release feed after launch and every six
hours while it remains open. The notification asks before downloading; there is
no setting that can silently disable checks. After the learner accepts, Spar
shows byte-level progress, waits for signature/checksum verification, flushes
active checkpoints, then closes, installs, and relaunches.

The same `.github/release-notes/v<version>.md` file used for the GitHub release is
embedded into every `latest*.yml` feed. The app stores those notes with the
download and shows them only after that exact version launches successfully.
Fresh installations do not receive a fake post-update changelog.

Each package job validates its feed before upload: version parity, embedded
release notes, and both Apple Silicon and Intel ZIP entries on macOS. Linux
self-update is available to AppImage installations; package-manager installs
continue to follow their package manager when the runtime reports self-update as
unsupported.
