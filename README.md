# nopeek

[![built with vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)

CLI for LLM agent secret safety. nopeek loads environment secrets for
coding agents without exposing secret values in tool output or chat
context. Agents see key _names_, not key _values_.

## Quick Start

In an LLM coding session, tell the agent to use nopeek:

```
"run npx nopeek load .env then use $DATABASE_URL to query the users table"

"use npx nopeek load .env --only STRIPE_KEY and then curl the billing API"

"run npx nopeek load .env --only API_KEY,API_SECRET and test the auth endpoint"
```

The agent runs the command, gets back only the key name, and uses the
variable in subsequent commands without seeing the actual value.

## How It Works

Shell command output visible to an LLM coding agent may be sent to a
model provider and retained by that provider. nopeek prevents secrets
from appearing in that output.

**Step 1.** Tell your agent to use nopeek. It just needs to run the
command; it will self-discover subcommands and flags from the CLI
output:

```bash
npx nopeek load .env --only DATABASE_URL
```

**Step 2.** nopeek injects the value into the session environment and
prints only the key name:

```
Loaded 1 key from .env: DATABASE_URL
```

**Step 3.** The agent can now use the variable by name without ever
seeing the value:

```bash
psql $DATABASE_URL -c "SELECT count(*) FROM users"
```

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
reminder by default. This is optional: nopeek remains harness-agnostic
and still works anywhere when you mention it in the session.

Three modes depending on environment:

| Context                                       | What happens                                  |
| --------------------------------------------- | --------------------------------------------- |
| Agent session with env-file injection support | Writes directly to env file, most secure      |
| Agent session without env-file injection      | Writes to temp file, outputs `source` command |
| Regular shell                                 | Prints `export` statements for `eval`         |

## Usage

No install needed. Your agent runs it directly via `npx`:

```bash
npx nopeek load .env
npx nopeek load .env --only DATABASE_URL
npx nopeek set MY_API_KEY --from-env
npx nopeek status
```

All commands are designed to be run inside an LLM coding session. Just
mention `nopeek` in your prompt. The agent will discover the right
subcommand from the CLI output.

## Commands

### `load` - Load secrets from .env or .tfvars files

```bash
npx nopeek load .env
npx nopeek load .env --only DATABASE_URL,API_KEY
npx nopeek load .env --persist  # also save to config for future sessions
npx nopeek load terraform.tfvars --only prod_password
npx nopeek load production.tfvars.json --only db_password
```

Supported formats:

| Extension        | Format                        |
| ---------------- | ----------------------------- |
| `.env`, `.env.*` | `KEY=value`                   |
| `.tfvars`        | `key = "value"` (HCL strings) |
| `.tfvars.json`   | JSON top-level strings        |

For `.tfvars` files, only top-level quoted string values are loaded.
Maps, lists, numbers, and booleans are skipped.

The `--persist` flag saves keys to `~/.config/nopeek/config.json` so a
SessionStart hook can auto-inject them on future sessions.

### `set` - Store a secret key

```bash
npx nopeek set MY_API_KEY --from-env  # read from current shell env
npx nopeek set MY_API_KEY             # interactive prompt (TTY only)
```

Stores to `~/.config/nopeek/config.json` with `0600` permissions. This
is plaintext at rest; use `set`/`--persist` only for secrets you are
comfortable storing in your user config.

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
- **No values in stdout** - in detected agent sessions, values are
  written to env files or temp files; only `source` paths or key names
  reach stdout
- **Plaintext config warning** - persisted keys are local plaintext
  secrets protected by file permissions, not encryption

## Recommended Agent Deny Rules

nopeek is the primary defense, but deny rules are a useful safety net
in any agent runtime that supports them. Block the agent from reading
secret files or embedding credentials inline in commands:

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
file directly and hardcode the values into a shell command. nopeek
prevents secrets from appearing in _output_, but deny rules prevent
the agent from _reading_ the files in the first place.

## Limitations

- **Pattern-based secret detection is best-effort.** The audit
  patterns catch known formats but cannot catch every possible secret.
- **Agent detection is marker-based.** nopeek detects common agent
  environment markers and env-file injection, but no CLI can guarantee
  every harness is identified.
- **Temp files exist on disk briefly.** Written to `/tmp/nopeek/` with
  `0600` perms, but values are on disk until the file is cleaned up.
- **Persisted keys are plaintext.** `set` and `load --persist` store
  values in `~/.config/nopeek/config.json` with `0600` permissions.
- **Output redaction is not comprehensive.** Prefer loading secrets as
  environment variables so values never need to be printed.

## License

MIT
