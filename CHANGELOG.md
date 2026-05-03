# nopeek

## 0.0.13

### Patch Changes

- 69e9d5a: Expand nopeek audit secret detection coverage for common token
  variants and log-style disclosure patterns.

## 0.0.12

### Patch Changes

- 991a0d9: Fix secret key validation, Pi agent detection, JSON
  cleanliness, audit behavior, and vulnerable transitive dependencies.

## 0.0.11

### Patch Changes

- 3e5c49e: Add Google Cloud and Azure CLI detection plus audit
  patterns for their common credential formats.

## 0.0.10

### Patch Changes

- 0a9a0fe: Generalize nopeek messaging from Claude Code-specific
  wording to LLM coding agent secret loading.

## 0.0.9

### Patch Changes

- 263f74a: Remove chalk dependency, default to JSON output, add fail()
  helper for clean error paths

## 0.0.8

### Patch Changes

- 160762c: Add .env discovery hints to set/status commands and new
  template command for secret injection

## 0.0.7

### Patch Changes

- 11eb1cc: Extract string values from nested maps in .tfvars and
  nested objects in .tfvars.json

## 0.0.6

### Patch Changes

- 996b5ed: Add .tfvars and .tfvars.json support to load command

## 0.0.5

### Patch Changes

- cba6568: Add shields.io badges, npm metadata for repository,
  homepage, author, and files.

## 0.0.4

### Patch Changes

- d20a582: Rewrite README with Claude Code workflow examples, security
  section, and persist flag docs.

## 0.0.3

### Patch Changes

- 61a1bcc: Fix Hetzner token false positives, add --persist flag to
  load for future sessions.

## 0.0.2

### Patch Changes

- 1d4d2fa: Add key name validation to prevent shell injection, secure
  config directory permissions.
- 23ab334: Add secure temp file loading for Claude Code sessions
  without CLAUDE_ENV_FILE hook.
- 1519297: Migrate to Vite+ for build, format, lint, type-check, and
  add tests with Vitest.

## 0.0.1

### Patch Changes

- f935aa8: Add nopeek CLI with load, set, list, remove, init, status,
  and audit commands.
