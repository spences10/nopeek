# Coding-agent credential boundaries

Assessed 2026-09-27 for nopeek issues
[#107](https://github.com/spences10/nopeek/issues/107) and
[#108](https://github.com/spences10/nopeek/issues/108).

## Conclusion

Do not make an agent's entire session credential-bearing merely to run
one authenticated command. Deliver selected credentials to the
narrowest possible child process, separately from command text. This
is useful across agents, but is **not** a guarantee that arbitrary
commands cannot read or disclose those credentials.

Claude's reported inline-export mechanism was verified. The research
did **not** establish that every other agent has that exact defect.
Other agents have different environment, filtering, redaction, and
proxy designs. The common risks are environment inheritance, child
argument expansion, file access, and model-visible output—not which
model brand is running.

## Evidence and limitations

- Inspected nopeek source, the installed Claude plugin (0.0.23), and
  Claude Code's installed 2.1.283 executable's embedded shell-building
  code.
- Reproduced Claude-style argv construction using isolated synthetic
  credentials and inspected only our test processes. This was not an
  authenticated, end-to-end Claude conversation.
- Compared release-tagged source for Codex rust-v0.157.1, Gemini CLI
  v0.61.0, and OpenCode v1.18.32. Initial main/dev discovery was not
  treated as evidence of released behaviour where a release source was
  available.
- Executed Gemini's standalone sanitizer with a synthetic API_KEY,
  with filtering enabled and disabled. Other agents' full runtimes
  were not run.
- Cursor findings are vendor documentation claims, not a source audit
  or penetration test. Cloud Agent behaviour must not be assumed for
  desktop.
- No live credentials, account APIs, or private transcript bodies were
  used in these experiments. No conclusion about historical compromise
  of a specific credential follows from these mechanism tests alone.

## Agent comparison

### Claude Code 2.1.283: confirmed inline-export exposure

The
[official hook documentation](https://code.claude.com/docs/en/hooks#persist-environment-variables)
instructs SessionStart hooks to write export statements into
`CLAUDE_ENV_FILE`. The inspected executable reads the file contents,
appends them to its command string, and passes that string with shell
`-c` arguments. Thus literal secrets in those exports become process
arguments. Ordinary process inspection can copy them into tool output.

The
[old nopeek hook](https://github.com/spences10/claude-code-toolkit/blob/9185e13e4350530776a4625406eda561e2e7ee8c/plugins/nopeek/hooks/session-load.sh)
exported every global stored key and profile, regardless of project.
The
[old CLI injection path](https://github.com/spences10/nopeek/blob/f5e6e33f9a5770bd19fb6c322df770928564109c/src/core/session.ts#L38)
did the same literal-export delivery for ordinary `load`, even without
persistence. Both sides must be updated.

The old redaction hook did not wrap `ps`/`pgrep`, left stderr
untouched, and skipped pipelines/redirections. Its regex filters
cannot provide a reliable repair for exposing credentials in the first
place.

### Codex rust-v0.157.1: explicit policies and broker support

[Shell environment policy](https://github.com/openai/codex/blob/rust-v0.157.1/codex-rs/config/src/shell_environment_policy.rs)
constructs an explicit child environment. In this release's conversion
code, inheritance defaults to `All` and `ignore_default_excludes`
defaults to `true`; do not assume secret-looking names are always
removed. Configuration and enforced policy can change the resulting
environment.

The inspected
[executor snapshot path](https://github.com/openai/codex/blob/rust-v0.157.1/codex-rs/exec-server/src/shell_snapshot.rs)
passes restoration state in environment variables and places variable
references in command text, rather than interpolating those values
into argv. This is evidence against assuming Claude's exact mechanism
here, not proof that every Codex path is free of exposure.

Codex also contains a
[credential broker](https://github.com/openai/codex/blob/rust-v0.157.1/codex-rs/network-proxy/src/credential_broker.rs)
with real/dummy credential records and host bindings. Protection
depends on configuration and supported routes/providers. It is not
evidence that all locally readable files or arbitrary credentials are
protected.

### Gemini CLI v0.61.0: optional environment filtering

The
[shell service](https://github.com/google-gemini/gemini-cli/blob/v0.61.0/packages/core/src/services/shellExecutionService.ts)
passes a sanitized environment separately to the spawned process. The
[sanitizer](https://github.com/google-gemini/gemini-cli/blob/v0.61.0/packages/core/src/services/environmentSanitization.ts)
removes entries by name/value when enabled; it does not redact
arbitrary stdout after a child deliberately loads a new credential
itself.

There is an important documentation nuance: the
[configuration page](https://geminicli.com/docs/reference/configuration)
describes automatic redaction, but the setting's listed default is
false. The
[release settings schema](https://github.com/google-gemini/gemini-cli/blob/v0.61.0/packages/cli/src/config/settingsSchema.ts)
and sanitizer confirm that ordinary local filtering is opt-in. Special
GitHub execution contexts force stricter filtering.

Synthetic check: API_KEY was retained with filtering disabled and
omitted with filtering enabled. PATH was retained in both cases. This
establishes the sanitizer behaviour, not whole-agent secrecy.

### OpenCode v1.18.32: inherited environment plus plugin additions

The
[released shell tool](https://github.com/anomalyco/opencode/blob/v1.18.32/packages/opencode/src/tool/shell.ts)
merges `process.env` with `shell.env` plugin additions and supplies
the map to process creation. No equivalent blanket serialization of
these values into shell exports was found in that inspected path.
Inherited credentials remain available to children.

[Permissions documentation](https://opencode.ai/docs/permissions)
describes per-tool controls, including default `.env` read denial. A
read-tool rule is not proof that an allowed shell cannot access the
same file or print an inherited credential; shell permission is a
separate boundary.

### Cursor: distinguish desktop and Cloud Agents

[Desktop terminal documentation](https://cursor.com/docs/agent/tools/terminal)
says commands run in the terminal, subject to run-mode and sandbox
controls. It does not establish a universal guarantee against
credential disclosure through arguments or output. The desktop
implementation was not inspected.

[Cloud Agent documentation](https://cursor.com/docs/cloud-agent/security-network)
distinguishes ordinary environment variables from Runtime Secrets. It
says Runtime Secret values are redacted from tool results,
transcripts, commits, and commit messages. They remain environment
variables visible through the terminal. This is a stronger documented
output defence than a selective cloud-CLI regex hook, but it must not
be generalized to desktop or treated as protection against every
transformation or exfiltration route.

## Design decisions for nopeek

1. **No session env injection in any harness.** Treat
   `CLAUDE_ENV_FILE` as an agent marker only, never a credential
   destination. Do not replace it with another agent's persistence
   hook without verifying its full path.
2. **No global auto-loader.** Retire the SessionStart hook, including
   profile injection. Preserve an inert compatibility entry point for
   older manual registrations. Do not silently migrate or delete
   stored credentials.
3. **Per-command delivery.** Prefer `run --only` and pass credentials
   as process environment, not generated shell assignments or literal
   arguments. `--only` filters the source file, not the inherited
   parent environment.
4. **Explicit storage.** Require `--only` with `load --persist`; warn
   that storage is global plaintext, not project-scoped, and not
   automatically loaded. `run` does not read that store. Project
   storage can be a separate design if it is actually needed, not a
   prerequisite for this security fix.
5. **Fallback without inline values.** Retain the existing private,
   self-removing source-file fallback. Source the path in the same
   shell as the command; never inline the contents or register it for
   future tool calls.
6. **Do not oversell marker detection.** Known markers block
   explicitly value-emitting modes; unrecognized harnesses still
   default to name-only output. `run` works without recognizing the
   harness. Detection is not a security boundary and can be altered by
   a child.

## What remains outside this fix

- `run` inherits the parent's environment. Restart contaminated
  sessions; `--only` does not remove already-inherited keys, PORT,
  ORIGIN, or DB paths.
- A child can print values to stdout/stderr, write files, or pass
  secrets as arguments to its own children. In particular,
  `curl -H "$TOKEN"` and database URLs expanded into CLI arguments can
  recreate argv exposure. Prefer clients that read credentials
  natively from environment or a reviewed script that reads
  environment without logging values.
- Same-user processes may inspect environments/files where OS
  permissions allow. Environment transport removes a common argv
  accident; it does not make credentials inaccessible to the user
  account or privileged processes.
- Existing histories, transcripts, snapshots, and hook files are not
  erased. Rotation is the remedy for compromised credentials, not
  deleting a log alone.
- Regex output redaction remains defence in depth. A future
  value-aware redactor would need streaming, chunk-boundary,
  binary-output, and encoding tests; it still could not guarantee
  secrecy under arbitrary transformations.

For stronger isolation, a separate broker design would keep real
credentials outside the agent/child boundary, authenticate only
allowed destinations, restrict operations/egress, and issue
short-lived scoped credentials. That is a substantially different
security product—not a claim this CLI should make merely because it
loads an environment file quietly.

## Validation contract

The CLI regression suite checks unchanged/absent session env targets,
explicit persistence selection, no global-store loading into another
project, known-agent disclosure gating, and Linux process arguments
for `run`. The argv check includes a deliberate-exposure positive
control so a broken probe cannot pass vacuously. Tests also preserve
the explicit limitations: inherited variables and deliberate child
disclosure are possible.

The plugin's isolated tests check no SessionStart registration, no
exports for either of two project directories, no profile injection,
unchanged stored config, and harmless execution of the retired hook
with malformed config. All regression credentials are synthetic.
Cross-agent marker tests are not misrepresented as end-to-end tests of
those agents.
