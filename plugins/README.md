# Webcake Landing — public plugin source

`webcake-landing/` is the portable Agent Plugins 1.0 package for the existing
production MCP. It contains no server binary, account credentials, app binding,
or lifecycle hook. The MCP remains hosted separately.

Build the archive from the repository root:

```sh
npm run pack:plugin
```

The command validates the files, creates an archive in `artifacts/plugins/`,
then reads back the ZIP and verifies its exact inventory and bytes. It does not
upload, create a private plugin, submit, or publish anything.

Package versioning is independent of the npm MCP server version. Bump the
version in `webcake-landing/plugin.json` when changing the package after upload.
Add the actual verified recording URL at
`extensions.com.openai.review.demo_recording_url` when available, then rebuild.

This is a **preparation archive**, not a declaration of submission readiness.
See [submission packet](../docs/submission-packet.md) for actual verification,
missing review materials, the recording walkthrough, and final portal setup.
