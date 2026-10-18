# Release Process

This project publishes via GitHub Actions on tag push.

## Flow

1. Ensure the target milestone work is merged to `main`.
2. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. The `Release` workflow (`.github/workflows/release.yml`) builds installers for Windows (NSIS), macOS (DMG), and Linux (AppImage + deb), then publishes them to a GitHub Release via `electron-builder --publish always`.
4. Verify the release assets and edit the release notes before announcing.

## Required Secrets

| Secret                        | Purpose                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `GH_TOKEN`                    | Publishing release artifacts (provided automatically as `secrets.GITHUB_TOKEN`).      |
| `CSC_LINK`                    | Code-signing certificate (base64 or URL); enables Windows signing and macOS identity. |
| `CSC_KEY_PASSWORD`            | Password for the `CSC_LINK` certificate.                                              |
| `APPLE_ID`                    | Apple ID email used for macOS notarization.                                           |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for notarization.                                               |
| `APPLE_TEAM_ID`               | Apple Developer Team ID.                                                              |

## Unsigned Builds

All signing/notarization credentials are injected via environment variables only; nothing is hard-coded. If `CSC_LINK` / `CSC_KEY_PASSWORD` are not set, artifacts are built without code signing. If the Apple variables are not set, macOS builds skip notarization.

In that case, add this line at the top of the GitHub Release notes:

> ⚠️ This build is unsigned and not notarized.
