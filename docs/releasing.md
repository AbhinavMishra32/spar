# Releasing

Releases are created only from `v*` tags after CI passes. The GitHub environment must contain a Developer ID Application certificate, its password, Apple ID app-specific password, and team id. Electron Builder signs and submits the hardened runtime build for notarization, then publishes DMG, ZIP, and updater metadata to the private GitHub repository.

Automatic updates are enabled in packaged builds with `PRACTICE_ENABLE_UPDATES=1`. Update artifacts are signature-checked before installation and install on quit after download.
