# nopeek

[![built with vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)

CLI for reducing accidental secret disclosure in LLM coding sessions.
nopeek gives agents a normal workflow for secret-dependent commands
without requiring secret values to be pasted into prompts or printed
by the loading step.

## Quick Start

For Pi and other harnesses where each tool call starts a fresh shell,
use `run` so loading and execution happen in one child process:

```text
"use npx nopeek run .env --only DATABASE_URL -- sh -c 'psql \"$DATABASE_URL\" -c \"SELECT count(*) FROM users\"'"

"use npx nopeek run .env --only STRIPE_KEY -- sh -c 'curl -H \"Authorization: Bearer $STRIPE_KEY\" https://api.example.com'"
```

`run` reports no secret values itself. The child command can still
print a secret, so choose commands and flags that do not dump their
environment, credentials, or verbose authentication data.

If your harness supports persistent env-file injection, `load` can
make selected variables available to later commands:

```text
"use npx nopeek load .env --only DATABASE_URL,API_KEY, then use those variables by name"
```

## How It Works

Shell output visible to an LLM coding agent may be sent to a model
provider and retained there. Agents also have a habit of inspecting
`.env` files or echoing variables when credentials are needed. nopeek
provides a lower-risk path for routine work:

1. It parses the requested secret file locally.
2. `run` gives selected values only to one child process, or `load`
   uses the best environment-loading method available.
3. nopeek's normal status output reports key names and loading state,
   not values.

This reduces accidental disclosure. It does not make secrets
inaccessible to the agent or to the child command that receives them.

> **Important:** Your agent does not know about nopeek unless you
> mention it. You do not need to spell out the full command, just
> mention `{npx,pnpx,bunx} nopeek` and the agent can discover the
> rest.

### Optional agent reminders

If you use a harness with persistent system-prompt extensions, add a
small reminder so the model reaches for nopeek automatically instead
of needing the Quick Start text in every prompt. For Pi users, the
`@spences10/pi-nopeek` extension does this:

```bash
pi install npm:@spences10/pi-nopeek
```

[`my-pi`](https://github.com/spences10/my-pi) already includes this
reminder by default. Its separate `pi-redact` extension also applies
best-effort, last-mile redaction to tool results before model context.
Those are optional defense-in-depth features, not capabilities of the
standalone nopeek CLI. nopeek remains harness-agnostic and works
anywhere when you mention it in the session.

`load` reports one of four methods:

| Method        | Context                                      | Availability                                                                     |
| ------------- | -------------------------------------------- | -------------------------------------------------------------------------------- |
| `env_file`    | Harness exposes an env-file injection target | Future commands in that session can use the variables                            |
| `source_file` | Agent session without env-file injection     | A self-removing `0600` file in a verified per-user `0700` root is created        |
| `name_only`   | Regular default                              | Only key names are reported; no assignments or values are emitted                |
| `export`      | Non-JSON output with `--allow-values`        | Assignments are printed; variables exist only if the parent shell evaluates them |

`load` reports its method and whether future commands can see the
variables. It cannot mutate a parent shell. Prefer `nopeek run` or use
the reported safe next step.

## Usage

No install needed. Your agent runs it directly via `npx`:

```bash
npx nopeek load .env
npx nopeek load .env --only DATABASE_URL
npx nopeek run .env --only API_KEY -- sh -c 'curl -H "Authorization: Bearer $API_KEY" https://api.example.com'
npx nopeek set MY_API_KEY --from-env
npx nopeek status
```

The safe default for an LLM coding session is `run`, or `load` when
`status` confirms env-file injection is available. Commands that emit
shell assignments require extra care, as described below.

## Commands

### `load` - Load secrets from .env or .tfvars files

```bash
npx nopeek load .env
npx nopeek load .env --only DATABASE_URL,API_KEY
npx nopeek load .env --shell bash --allow-values  # trusted shells only
npx nopeek load .env --persist  # also save to config for future sessions
npx nopeek load terraform.tfvars --only prod_password
npx nopeek load production.tfvars.json --only db_password
```

Supported files use deliberately strict, fail-closed grammars. A
malformed or unsupported value rejects the whole file before `--only`
filtering or any secret-loading side effect.

- **`.env` and `.env.*`:** blank lines, `#` comment lines, and
  `[export ]NAME=VALUE` assignments are supported. Names match
  `[A-Za-z_][A-Za-z0-9_]*`; `export` is recognized only as a separate
  prefix, so `export`, `exported`, and `export_token` remain valid
  names. Whitespace around `=` and CRLF are accepted. Values may be
  unquoted, single quoted (literal), or double quoted with `\\`, `\"`,
  `\n`, `\r`, and `\t` escapes. In unquoted values, `#` starts a
  comment only after whitespace; a value-leading `#` and `#` inside
  either quote style are data. A closed quoted value may only be
  followed by whitespace or a whitespace-prefixed `#` comment.
  Duplicate names, prototype-sensitive output names (`__proto__`,
  `prototype`, `constructor`), a UTF-8 BOM, expansion, multiline
  values, unknown escapes, malformed quotes, and other shell syntax
  are rejected.
- **`.tfvars`:** top-level assignments and nested object/map
  assignments are supported when every leaf is a double-quoted string.
  Identifier or quoted keys, `#`/`//` line comments,
  whitespace-separated multiline or same-line maps, and the same basic
  escapes as above are accepted. Nested leaf names are flattened to
  their leaf key for environment loading; duplicate assignments,
  prototype-sensitive leaf names, or any resulting leaf-key collision
  reject the file. Commas, heredocs, interpolation, expressions,
  references, functions, dynamic keys, lists, numbers, booleans, null,
  multiline strings, and a BOM are rejected.
- **`.tfvars.json`:** the root must be a JSON object whose leaves are
  strings; nested objects use the same collision-checked leaf-key
  flattening. Only JSON whitespace (space, tab, CR, LF) is accepted.
  Duplicate members at any depth, prototype-sensitive leaf names,
  flattened collisions, arrays, numbers, booleans, null, trailing
  content, and a BOM are rejected.

The `--persist` flag saves keys to `~/.config/nopeek/config.json` so a
SessionStart hook can auto-inject them on future sessions.

`load` returns `method` and `contains_values` fields in JSON output.
Structured JSON never contains values. If `method` is `env_file`, keys
are available to future session commands. `source_file` returns a safe
path to source; `name_only` may return an explicitly gated
`next_command`, for example:

```bash
eval "$(npx nopeek load .env --shell bash --allow-values)"
source <(npx nopeek load .env --shell bash --allow-values)
npx nopeek load .env --shell fish --allow-values | source
```

`--shell` supports `bash`, `zsh`, and `fish`, but assignment output
requires the explicit `--allow-values` opt-in. `--shell` takes
precedence over `--json`: that combination emits raw shell
assignments, not JSON. This mode warns on stderr and writes secret
values to stdout for a shell to consume. Detected LLM agent sessions
reject `--allow-values`; use `run`, env-file injection, or the
generated source file instead. Without opt-in, non-JSON output is
name-only even in unknown non-TTY harnesses.

### `run` - Run one command with loaded secrets

```bash
npx nopeek run .env --only API_KEY -- node ./script.js
npx nopeek run .env --only INGEST_TOKEN,FEEDGEN_SERVICE_URL -- sh -c 'curl -H "Authorization: Bearer $INGEST_TOKEN" "$FEEDGEN_SERVICE_URL"'
npx nopeek run terraform.tfvars --only prod_password -- ./deploy.sh
npx nopeek run production.tfvars.json --only DATABASE_URL -- sh -c 'psql "$DATABASE_URL" -c "select 1"'
```

`run` injects selected keys into only the child process environment
and preserves the child command exit code. Use `sh -c` when you need
shell expansion, pipes, redirects, or inline `$VARIABLE` expansion
inside the child process. The child retains normal access to its
environment and stdout: avoid `env`, `printenv`, shell tracing,
verbose HTTP authentication, and other behavior that can print
credentials.

### `set` - Store a secret key

```bash
npx nopeek set MY_API_KEY --from-env  # read from current shell env
npx nopeek set MY_API_KEY             # interactive prompt (TTY only)
```

Stores to `~/.config/nopeek/config.json` with `0600` permissions
inside an owned `0700` directory. nopeek rejects symlinks, wrong
ownership, non-regular files, corrupt JSON, and invalid config
structure without overwriting the original. Missing config reads do
not create directories. Safe owned permission drift is repaired
through verified file descriptors, and destinations are revalidated
immediately before atomic replacement. These checks do not protect
against a process running as the same user racing the final filesystem
operation. This is plaintext at rest; use `set`/`--persist` only for
secrets you are comfortable storing in your user config.

> **Note:** `--value` is rejected inside detected LLM agent sessions.
> The value would appear in the conversation. Use `--from-env`
> instead.

### `list` - Show available keys

```bash
npx nopeek list
```

Shows key names and sources without values.

### `remove` - Remove a stored key

```bash
npx nopeek remove MY_API_KEY
```

### `init` - Scan and configure cloud CLIs

```bash
npx nopeek init
```

Detects installed cloud CLIs, checks their auth configuration, and
stores profile mappings.

| CLI      | Safer pattern                                        | Detection                                          |
| -------- | ---------------------------------------------------- | -------------------------------------------------- |
| `aws`    | Named profiles (`AWS_PROFILE`)                       | `~/.aws/credentials` + env vars                    |
| `hcloud` | Named contexts (`HCLOUD_CONTEXT`)                    | `~/.config/hcloud/cli.toml`                        |
| `gcloud` | Named configurations (`CLOUDSDK_ACTIVE_CONFIG_NAME`) | active gcloud account + inline credential env vars |
| `az`     | Azure CLI cached login + active subscription         | `az account show` + inline credential env vars     |

### `status` - Show current state

```bash
npx nopeek status
```

Shows session type, stored keys, CLI profiles, and detected CLIs.

### `audit` - Scan for exposed secrets

```bash
npx nopeek audit
npx nopeek audit ./path/to/dir
```

Scans for `.env` files and reports secrets found using pattern
matching (AWS keys, bearer tokens, API keys, private keys, connection
strings, etc.). Checks `.gitignore` coverage.

## Security

- **Key name validation** - env key names are validated against
  `^[a-zA-Z_][a-zA-Z0-9_]*$` to prevent shell injection
- **Secure file permissions** - config dir is `0700`, config file is
  `0600`, temp env files are `0600`
- **Atomic writes** - config is written via temp file + rename to
  prevent corruption
- **Key validation before output** - invalid env names are rejected
  before shell exports are printed
- **Name-only normal status output** - `run` and default
  detected-agent loading report names/state rather than values;
  explicit shell-output modes and child commands can still print
  values
- **Plaintext config warning** - persisted keys are local plaintext
  secrets protected by file permissions, not encryption

## Recommended Agent Deny Rules

nopeek is a workflow control, not an access-control boundary. Deny
rules are the enforcement layer in runtimes that support them. Use
them to block agents from reading secret files or embedding
credentials inline in commands:

```jsonc
{
	"permissions": {
		"deny": [
			// Block reading secret files
			"Read(.env)",
			"Read(*.env)",
			"Read(*.tfvars)",
			"Read(*credentials*)",
			"Read(*secret*)",
			"Read(**/.config/gcloud/**)",
			"Read(**/.azure/**)",
			"Read(*service-account*.json)",

			// Block cat/head on secret files
			"Bash(cat .env)",
			"Bash(cat *.env*)",
			"Bash(cat *tfvars*)",
			"Bash(cat *credentials*)",
			"Bash(cat *secret*)",

			// Block inline credentials in commands
			"Bash(PGPASSWORD*)",
			"Bash(*HCLOUD_TOKEN*)",
			"Bash(hcloud context create*)",
			"Bash(*GOOGLE_APPLICATION_CREDENTIALS*)",
			"Bash(*CLOUDSDK_AUTH_ACCESS_TOKEN*)",
			"Bash(*GOOGLE_OAUTH_ACCESS_TOKEN*)",
			"Bash(*AZURE_CLIENT_SECRET*)",
			"Bash(*ARM_CLIENT_SECRET*)",
			"Bash(*AZURE_PASSWORD*)",
			"Bash(*AZURE_ACCESS_TOKEN*)",
			"Bash(*ARM_ACCESS_KEY*)",

			// Block fetching secret values from cloud providers
			"Bash(*secretsmanager get-secret-value*)",
			"Bash(*hetzner*secret*)",
			"Bash(*hetzner*access_key*)",
			"Bash(gcloud auth print-access-token*)",
			"Bash(gcloud auth application-default print-access-token*)",
			"Bash(az account get-access-token*)",
		],
	},
}
```

Without these rules, an agent can still read a `.tfvars` or `.env`
file directly and hardcode or print the values. Deny rules reduce that
access; nopeek gives cooperative agents a practical alternative.

## Threat Model and Non-Goals

nopeek is designed for a cooperative coding agent that needs to run a
command with credentials while avoiding accidental disclosure during
loading. It protects against common mistakes such as pasting a value
into chat, reading an entire `.env` file for one key, or printing
exports as an intermediate step when `run`/env-file injection is used.

nopeek does **not** protect secrets from:

- an agent that deliberately reads the source file or prints variables
- a child command that dumps its environment, traces commands, or logs
  credentials
- a compromised nopeek package, dependency, shell, child process, or
  user account
- another process with sufficient access to the same user-owned files

Additional limitations:

- **Pattern-based secret detection is best-effort.** `audit` scans
  `.env` files for known patterns and cannot identify every secret.
- **Agent detection is marker-based.** An unknown harness may be
  treated like a regular shell; check `nopeek status` and avoid
  assignment-emitting modes in agent-visible output.
- **Temp files are briefly plaintext.** `source_file` writes values to
  a unique `0600` file under the verified per-user `0700` directory
  `<os.tmpdir()>/nopeek-<uid>/`. The file removes itself after it is
  sourced; interrupted-session files older than 24 hours are removed
  safely on a later write, with only the removal count reported.
  nopeek refuses unsafe roots and never follows symlinks during
  cleanup. Files created by older versions under `/tmp/nopeek/` are
  intentionally not touched; inspect and remove that legacy directory
  manually after upgrading.
- **Persisted keys are plaintext.** `set` and `load --persist` store
  values in `~/.config/nopeek/config.json` with `0600` permissions.
- **Redaction is separate and best-effort.** Standalone nopeek does
  not redact arbitrary child output. Harness integrations such as
  my-pi may add a separate safety net, but cannot guarantee complete
  redaction.

## License

MIT
