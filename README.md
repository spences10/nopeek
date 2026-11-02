# nopeek

[![built with vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)

CLI for reducing accidental secret disclosure in LLM coding sessions.
Pass selected secrets from an existing file directly to one child
process, without printing the values during loading, creating
temporary secret files, or storing a second copy.

## Quick Start

Tell your coding agent:

> If you need a secret, use
> `pnpx nopeek run .env --only KEY -- your-command`. Do not read or
> print secret files. Prefer clients that read credentials directly
> from their environment, and do not log them.

```bash
pnpx nopeek run .env --only API_KEY -- node ./scripts/call-api.js
pnpx nopeek run .env --only DATABASE_URL -- node ./scripts/query.js
```

`npx nopeek`, `pnpx nopeek`, and `bunx nopeek` all work. The command
runs once, forwards child output and exit status, and keeps loaded
values out of nopeek's command arguments. No daemon, account, key
store, session hook, or agent detection is required.

**The child receives real credentials and can disclose them.** nopeek
is not an output redactor, secret broker, or access-control boundary.

### Optional agent reminders

An agent must know to use nopeek. Mention it in the session or add the
Quick Start instruction to your agent's project guidance. For Pi
users, the optional `@spences10/pi-nopeek` extension supplies a
reminder:

```bash
pi install npm:@spences10/pi-nopeek
```

[`my-pi`](https://github.com/spences10/my-pi) includes a reminder and
a separate `pi-redact` extension for best-effort tool-result
redaction. Update any installed instructions that still recommend
`load`, `set`, or session-wide environment injection. Harness
redaction is separate from the standalone CLI and cannot guarantee
complete protection.

### Installation trust

Package runners may download and execute code. For production secrets,
prefer a reviewed exact version in a trusted project lockfile. Replace
the version placeholder before running:

```bash
pnpm add --save-exact 'nopeek@<reviewed-version>'
pnpm install --frozen-lockfile
pnpm exec nopeek run .env --only API_KEY -- your-command
```

After installation, `pnpm install --offline --frozen-lockfile` can use
packages already in the local store. A compromised package,
dependency, child command, or user account is outside nopeek's
protection. CI builds, installs, and executes the packed artifact; npm
trusted-publishing provenance is not currently enabled.

## Commands

### `run` — Run one command with selected secrets

```bash
pnpx nopeek run .env --only API_KEY -- node ./script.js
pnpx nopeek run .env --only API_KEY,DATABASE_URL -- node ./worker.js
pnpx nopeek run terraform.tfvars --only prod_password -- ./deploy.sh
pnpx nopeek run production.tfvars.json --only DATABASE_URL -- node ./query.js
```

- `--only` selects comma-separated keys from the input file. Without
  it, all parsed entries are supplied.
- The entire source is parsed and validated before key selection or
  child execution. Malformed input fails without printing its values.
- Secrets are passed in the child process environment, not generated
  shell assignments, temporary files, or a persistent store.
- The child inherits the parent environment. **`--only` does not
  remove already-inherited credentials.** Start from a clean session.
- Child stdout and stderr pass through unchanged; nopeek preserves its
  exit code. Descendants can inherit the credentials.
- The command is executed directly, without implicit shell expansion.
  Use `sh -c` only when shell features are needed. Expanding a token
  into another program's arguments can expose it in process listings;
  prefer native environment-based authentication.
- No other agent tool call or later command receives the loaded values
  automatically. Run each authenticated command through nopeek.

### Supported source files

Supported files use deliberately strict, fail-closed grammars:

- **`.env` and `.env.*`:** blank lines, `#` comments, and
  `[export ]NAME=VALUE` assignments. Names match
  `[A-Za-z_][A-Za-z0-9_]*`. Whitespace around `=` and CRLF are
  accepted. Values may be unquoted, single quoted (literal), or double
  quoted with `\\`, `\"`, `\n`, `\r`, and `\t` escapes. Unquoted `#`
  starts a comment only after whitespace. Repeated keys use the last
  value and warn for selected keys. Expansion, multiline values,
  unknown escapes, malformed quotes, a BOM, and prototype-sensitive
  names are rejected.
- **`.tfvars`:** top-level assignments and nested object/map
  assignments with double-quoted string leaves. Nested leaf names are
  flattened to environment names. Duplicate assignments or resulting
  name collisions are rejected, as are interpolation, expressions,
  lists, non-string leaves, heredocs, multiline strings, commas, and a
  BOM.
- **`.tfvars.json`:** a JSON object with string leaves, flattened
  using the same collision rules. Duplicate members, non-string
  leaves, arrays, trailing content, a BOM, and prototype-sensitive
  leaf names are rejected.

These parsers do not evaluate shell code, Terraform expressions, or
variable interpolation.

### `init` — Audit cloud CLI authentication

```bash
pnpx nopeek init
pnpx nopeek init --no-json
```

Detects supported cloud CLIs and reports whether their authentication
needs migration. This is advisory: nopeek does not change CLI
configuration, read or write its old global store, or apply profiles
to commands.

| CLI      | Suggested native authentication                      |
| -------- | ---------------------------------------------------- |
| `aws`    | Named profiles (`AWS_PROFILE`)                       |
| `hcloud` | Named contexts (`HCLOUD_CONTEXT`)                    |
| `gcloud` | Named configurations (`CLOUDSDK_ACTIVE_CONFIG_NAME`) |
| `az`     | Cached Azure CLI login and selected subscription     |

Configure profiles directly with the relevant CLI. Remove obsolete
inline credentials from shell startup files, open a fresh shell, and
rerun `nopeek init`. Native CLI credential files remain managed by
those CLIs, not nopeek.

### `audit` — Scan secret files and Git coverage

```bash
pnpx nopeek audit
pnpx nopeek audit ./path/to/dir
pnpx nopeek audit --no-json
```

Recursively scans `.env*`, `.tfvars`, and `.tfvars.json` files and
reports secret-pattern categories without printing matched values. Git
classification uses Git itself, including nested ignore rules and
negation: sources are `tracked`, `untracked`, `ignored`, or `unknown`.
Example, sample, and template filenames are not assumed safe.

The scan is a bounded heuristic, not proof that a repository is safe.
It does not follow symlinks; skips dependency, build, VCS metadata,
and framework output directories; visits at most 10,000 directories to
a depth of 32; examines at most 1,000 candidates; and reads at most 1
MiB per file. Unreadable, binary, oversized, malformed, symlinked, or
limit-exceeding candidates are reported without source contents and
make the scan fail closed.

Advisory commands output JSON by default; `--no-json` selects text.
`run` forwards the child's output rather than wrapping it in JSON.

## Threat model

nopeek is designed for a cooperative agent avoiding accidental secret
exposure while running authenticated commands. It avoids a common
intermediate mistake: reading or printing an entire secret file just
to run one command.

It does **not** protect against:

- An agent reading the original secret file or printing its
  environment.
- A child logging credentials, tracing commands, writing secrets to
  files, or expanding them into arguments.
- Inherited credentials from an already-contaminated session.
- Same-user or privileged processes with access to files or process
  environments, where the OS permits it.
- A compromised package, dependency, shell, child, or user account.

Use your harness's filesystem/sandbox controls to restrict direct
secret-file access where supported. Separate tool-result redaction can
reduce accidental disclosure but is best-effort, not a replacement for
access control. Pattern-based `audit` detection cannot find every
secret.

## Migrating from older versions

**Breaking change:** `load`, `set`, `list`, `remove`, `status`, and
`template` have been removed. They fail with guidance to use `run`.
There is no persistent key store, temporary env-file loader, shell
assignment output, or template rendering that writes resolved secrets.

Replace `load` followed by a command with:

```bash
pnpx nopeek run .env --only REQUIRED_KEY -- your-command
```

Keep your original secret source file. nopeek no longer reads, writes,
migrates, or deletes legacy storage. Review these old plaintext
locations manually without printing their contents:

- `$XDG_CONFIG_HOME/nopeek/config.json`, or
  `~/.config/nopeek/config.json` when XDG_CONFIG_HOME is unset.
- Leftover `.tmp-*` files in that config directory.
- `<os.tmpdir()>/nopeek-<uid>/env-*.sh` and older
  `<os.tmpdir()>/nopeek/` files.

These files are **not automatically cleaned up**. Review and
explicitly remove obsolete files yourself after retaining any
credentials you still need; removing a file is not secure erasure or
credential revocation.

Update or disable old plugins, skills, and SessionStart hooks: an old
plugin may still read global storage independently of this CLI.
Restart affected sessions and child processes. Rotate credentials
exposed in transcripts, logs, arguments, or other artifacts. Upgrading
nopeek does not erase existing copies or clear inherited environments.

The [earlier cross-agent assessment](docs/agent-secret-boundaries.md)
is retained as a historical record, not a description of the current
command surface or current vendor guarantees.

## Development and validation

```bash
pnpm test
pnpm run check
pnpm run test:integration
```

The integration suite runs the built CLI with synthetic credentials in
isolated working, home, config, and temporary directories. It checks
that `run` creates no extra files, leaves legacy storage and
session-env targets untouched, rejects retired commands, preserves
exit status and literal arguments, and keeps secrets out of process
arguments. Linux `/proc` checks have a deliberate-exposure positive
control. The tests also preserve the explicit limitations: parent
credentials are inherited and deliberate child output is not redacted.

No additional shell is required for assignment round trips: shell
assignment output has been removed. CI also installs and exercises the
packed CLI.

## License

MIT
