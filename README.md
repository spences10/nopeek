# nopeek

CLI for Claude Code secret safety. Secure proxy between Claude Code and your secrets — Claude knows key *names*, never key *values*.

## Install

```bash
npx nopeek
```

## Commands

### `load` — Load secrets from .env files

```bash
# Load all keys from .env into the session
npx nopeek load .env

# Load specific keys only
npx nopeek load .env --only DATABASE_URL,API_KEY
```

Inside a Claude Code session, values are injected via `CLAUDE_ENV_FILE` — they never appear in conversation context or transcripts. Outside Claude Code, prints eval-able `export` statements to stdout.

### `set` — Store arbitrary keys

```bash
npx nopeek set MY_API_KEY --from-env    # reads from current shell env
npx nopeek set MY_API_KEY --value "abc" # inline (for scripting)
npx nopeek set MY_API_KEY               # interactive prompt (TTY only)
```

Stores to `~/.config/nopeek/config.json` with `0600` permissions.

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

Detects installed cloud CLIs (aws, hcloud), checks their auth configuration, and stores profile mappings. Currently supports:

| CLI | Safe pattern | Detection |
|-----|-------------|-----------|
| `aws` | Named profiles (`AWS_PROFILE`) | `~/.aws/credentials` + env vars |
| `hcloud` | Named contexts (`HCLOUD_CONTEXT`) | `~/.config/hcloud/cli.toml` |

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

Scans for `.env` files and reports secrets found using pattern matching (AWS keys, bearer tokens, API keys, private keys, connection strings, etc.). Checks `.gitignore` coverage.

## How it works

1. **Claude asks nopeek for secrets** — runs `npx nopeek load .env`
2. **nopeek reads the file** — parses keys and values
3. **Values go to `CLAUDE_ENV_FILE`** — available as env vars in subsequent commands
4. **Only key names go to stdout** — Claude never sees the values

This means secrets never appear in:
- Anthropic's API (conversation context)
- Local transcript files
- Terminal scrollback (within Claude Code)

## Limitations

- **Pattern-based secret detection is best-effort.** The audit and redaction patterns catch known formats but can't catch every possible secret.
- **`CLAUDE_ENV_FILE` values exist on disk briefly.** The file is session-scoped and cleaned up, but values are written to a temp file.
- **No output redaction yet.** Redaction hooks will be available via [claude-code-toolkit](https://github.com/spences10/claude-code-toolkit).

## License

MIT
