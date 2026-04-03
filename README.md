# nopeek

[![built with vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)

CLI for Claude Code secret safety. Secure proxy between Claude Code
and your secrets — Claude knows key _names_, never key _values_.

## Quick Start

Tell Claude to load secrets from your `.env` file:

> "Use npx nopeek to load ANTHROPIC_API_KEY from .env and curl the API
> to check it works"

Claude runs `npx nopeek load .env --only ANTHROPIC_API_KEY`, gets back
the key name only, then uses `$ANTHROPIC_API_KEY` in commands without
ever seeing the value.

## How It Works

```
You: "load the DATABASE_URL from .env and run a query"

Claude runs:  npx nopeek load .env --only DATABASE_URL
nopeek:       writes value to secure temp file
              prints: source /tmp/nopeek/env-abc123.sh
Claude runs:  source /tmp/nopeek/env-abc123.sh
Claude runs:  psql $DATABASE_URL -c "SELECT count(*) FROM users"
```

The secret value never appears in the conversation, Anthropic's API,
or local transcripts. Claude only sees the variable name.

Three modes depending on environment:

| Context                              | What happens                                  |
| ------------------------------------ | --------------------------------------------- |
| Claude Code (with `CLAUDE_ENV_FILE`) | Writes directly to env file — most secure     |
| Claude Code (without hook)           | Writes to temp file, outputs `source` command |
| Regular shell                        | Prints `export` statements for `eval`         |

## Install

```bash
npx nopeek            # run directly
pnpx nopeek           # or with pnpm
npm install -g nopeek # or install globally
```

## Commands

### `load` — Load secrets from .env files

```bash
npx nopeek load .env
npx nopeek load .env --only DATABASE_URL,API_KEY
npx nopeek load .env --persist  # also save to config for future sessions
```

The `--persist` flag saves keys to `~/.config/nopeek/config.json` so a
SessionStart hook can auto-inject them on future sessions.

### `set` — Store a secret key

```bash
npx nopeek set MY_API_KEY --from-env  # read from current shell env
npx nopeek set MY_API_KEY             # interactive prompt (TTY only)
```

Stores to `~/.config/nopeek/config.json` with `0600` permissions.

> **Note:** Avoid `--value` inside Claude Code — the value would
> appear in the conversation. Use `--from-env` instead.

### `list` — Show available keys

```bash
npx nopeek list
```

Shows key names and sources without values.

### `remove` — Remove a stored key

```bash
npx nopeek remove MY_API_KEY
```

### `init` — Scan and configure cloud CLIs

```bash
npx nopeek init
```

Detects installed cloud CLIs, checks their auth configuration, and
stores profile mappings.

| CLI      | Safe pattern                      | Detection                       |
| -------- | --------------------------------- | ------------------------------- |
| `aws`    | Named profiles (`AWS_PROFILE`)    | `~/.aws/credentials` + env vars |
| `hcloud` | Named contexts (`HCLOUD_CONTEXT`) | `~/.config/hcloud/cli.toml`     |

### `status` — Show current state

```bash
npx nopeek status
```

Shows session type, stored keys, CLI profiles, and detected CLIs.

### `audit` — Scan for exposed secrets

```bash
npx nopeek audit
npx nopeek audit ./path/to/dir
```

Scans for `.env` files and reports secrets found using pattern
matching (AWS keys, bearer tokens, API keys, private keys, connection
strings, etc.). Checks `.gitignore` coverage.

## Security

- **Key name validation** — env key names are validated against
  `^[a-zA-Z_][a-zA-Z0-9_]*$` to prevent shell injection
- **Secure file permissions** — config dir is `0700`, config file is
  `0600`, temp env files are `0600`
- **Atomic writes** — config is written via temp file + rename to
  prevent corruption
- **No values in stdout** — inside Claude Code, values are written to
  temp files, only `source` path or key names reach stdout

## Limitations

- **Pattern-based secret detection is best-effort.** The audit
  patterns catch known formats but can't catch every possible secret.
- **Temp files exist on disk briefly.** Written to `/tmp/nopeek/` with
  `0600` perms, but values are on disk until the file is cleaned up.
- **No output redaction yet.** Redaction hooks will be available via
  [claude-code-toolkit](https://github.com/spences10/claude-code-toolkit).

## License

MIT
