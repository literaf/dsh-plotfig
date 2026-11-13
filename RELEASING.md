# Release policy

- Routine edits stay under `Unreleased`; do not bump a version for every local installation.
- Use distinct `beta.N` / `rc.N` versions for distinct prerelease distributions. Public prereleases use `--tag beta` or `--tag rc`, leaving `latest` on a stable release.
- Publish a stable version only when requested by the user. Patch versions fix compatible behavior; minor versions add capabilities. A 0.x release may introduce schema changes, which must be explained.
- Published versions and their tags are immutable. Compare release notes with the previous public release, not the last local archive.

Before publishing:

1. Update package metadata, README files and CHANGELOG. Record actual limitations and separate real API checks from simulated model/UI checks.
2. Run `pnpm run prepublishOnly` and native page checks. Inspect the package allowlist; report files, credentials, development fixtures and local profiles must never be shipped.
3. Run Node 22/24 and native-page checks on the exact release commit. Publish source and tags only when the user explicitly requests that destination; npm-only releases may keep the source repository local.
4. Publish npm; complete any required official login/second-factor authorization. Do not repeat a pending publish.
5. Verify the registry version, `latest`, downloaded tarball integrity and source bytes. Check npmmirror separately; a mirror delay is not an npm publication failure.
6. Include release notes in the package and update any requested directory entry only after the package is available. Verify the public page/feed and install identity.

Creating a local test package is not an npm release. A readiness question alone is not a publication request.
