---
'nopeek': minor
---

Make `run` the only credential-loading path. Remove `load`, `set`,
`list`, `remove`, `status`, and `template`, along with plaintext temp
env files, shell assignment output, and persistent key storage.
Retired commands fail with migration guidance. `init` is now strictly
advisory and never reads or rewrites legacy nopeek config.

Existing stored secrets and temporary files are not read, migrated, or
deleted automatically. Update legacy plugins and agent instructions,
review obsolete plaintext files manually, and use
`nopeek run <file> --only KEY -- <command>` for authenticated
commands.
