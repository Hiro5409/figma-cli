<h1 align="center">figma-cli</h1>

<p align="center">
  An unofficial CLI for the <a href="https://developers.figma.com/docs/rest-api/">Figma REST API</a>.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@hiro5409/figma-cli"><img src="https://img.shields.io/npm/v/@hiro5409/figma-cli" alt="npm version"></a>
  <a href="https://github.com/Hiro5409/figma-cli/actions/workflows/ci.yml"><img src="https://github.com/Hiro5409/figma-cli/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/Hiro5409/figma-cli" alt="License: MIT"></a>
</p>

## Why a CLI?

Figma already provides an [official MCP server](https://developers.figma.com/docs/figma-mcp-server/), which works on the canvas.
It cannot post comments or read version history; the REST API can.
figma-cli gives coding agents with shell access small Figma operations: every result is compact JSON on stdout, every error is one line of JSON on stderr, and every API command accepts `--dry-run`.

## Generated from the official schema

Every operation in Figma's [OpenAPI specification](https://github.com/figma/rest-api-spec) that accepts a personal or plan access token is a command named `figma-api <resource> <action>`. Operations that accept only OAuth tokens are not commands, because figma-cli sends `X-Figma-Token`.

```bash
figma-api file show --file-key <key> --depth 1
figma-api file node list --file-key <key> --ids 1:2,3:4
figma-api image render --file-key <key> --ids 1:2 --format svg
figma-api file version list --file-key <key> --all
figma-api file comment create --file-key <key> --body '{"message":"Align this with the grid","client_meta":{"node_id":"1:2","node_offset":{"x":0,"y":0}}}' --dry-run
figma-api file comment reaction create --file-key <key> --comment-id 123456 --body '{"emoji":":+1:"}'
```

Path and query parameters are flags, and a request body is one `--body` JSON object, given inline, as `@<path>` to a file, or as `-` for standard input. Numbers in flags and the body must be finite, and integers must lie within ±(2^53 - 1). `figma-api schema <resource> <action>` prints the JSON Schema of the request, and every request is validated against it before it is sent. Each command's `--help` names the token scope that Figma's schema lists for it, and whether it needs a plan access token.

`--dry-run` prints the request, including its body, without sending it. Pass a secret in a body, such as the token filter of `developer-log list`, as `@<path>` or `-` rather than inline. `--all` reads every page of a list that Figma pages, following the next page that Figma returns. Writes are never retried automatically; an `OUTCOME_UNKNOWN` error means Figma may have applied the write, so read the affected resource before retrying.

A figma.com URL holds the IDs these commands take: `https://www.figma.com/design/<key>/<name>?node-id=1-2` names file key `<key>` and node ID `1:2`. A branch URL, `https://www.figma.com/design/<key>/branch/<branch key>/<name>`, is addressed by its branch key.

`image render` returns image URLs that expire. Downloading them needs no token, for example with `curl -o frame.png "<url>"`.

## Quick Start

```bash
bunx --package @hiro5409/figma-cli figma-api auth login
```

## Installation

```bash
bun add -g @hiro5409/figma-cli
```

The command is `figma-api`. The `figma` command belongs to Figma's [Code Connect](https://github.com/figma/code-connect) CLI, and the two can be installed side by side.

## Usage

```bash
figma-api --help
figma-api <command> --help
figma-api schema file comment create
```

### Authentication

figma-cli authenticates with a [personal access token](https://developers.figma.com/docs/rest-api/authentication/). Generate one in Figma under Settings > Security > Personal access tokens. `auth login` uses `current_user:read` to verify the token before storing it; grant the other scopes the commands you run need.

```bash
figma-api auth login --profile work
op read "op://Private/Figma/credential" | figma-api auth login --profile work --with-token
figma-api auth status
figma-api profile list
```

The CLI never takes the token it authenticates with as a command argument, which shells and process lists record. `auth login` prompts for it without echoing it, or reads it from standard input with `--with-token`. Stored tokens live in `~/.config/figma-cli/credentials.json` with mode `600`.

A command uses the first token it finds in this order:

1. The stored profile named by `--profile`.
2. `FIGMA_ACCESS_TOKEN`, for a process that a secret manager starts with the token.
3. The stored profile named by `FIGMA_PROFILE`.
4. The default profile, or the only stored one.

A plan access token, which commands such as `activity-log list` need, works through `FIGMA_ACCESS_TOKEN`; `auth login` stores only personal access tokens. Personal access tokens expire within 90 days. When Figma rejects one, store a new token with `auth login --replace`.

### Errors and retries

Errors are one line of JSON on stderr with a stable `code`, the exit code, and `why` and `hint` fields. Reads are retried on transient failures. When Figma asks to wait more than a minute, the command fails at once with `RATE_LIMITED` and the wait in its hint.

## Calling from Agents

```bash
gh skill install Hiro5409/figma-cli figma-cli
```

## Development

Install and [activate mise](https://mise.jdx.dev/getting-started.html), then:

```bash
mise trust
mise install
bun ci
lefthook install
bun run check
```

## Releases

A maintainer releases from `main`: commit the new `version` in `package.json`, push the commit to `main`, then push the annotated tag for that version:

```bash
git tag -a v1.2.3 --cleanup=verbatim -F - <<'NOTES'
## Changes

- Describe a change a user will notice.
NOTES
git push origin v1.2.3
```

The tag message lists, as Markdown, the changes a user will notice, and becomes the GitHub Release notes. Git reads it from standard input, and `--cleanup=verbatim` keeps lines that start with `#`, such as headings, which Git otherwise strips as comments.

Release configuration includes these settings outside the repository:

- An npm [trusted publisher](https://docs.npmjs.com/trusted-publishers/) for user `Hiro5409`, repository `figma-cli`, and workflow filename `release.yml`, with no environment.
- [Immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases) for the repository, so that the tag and the attached artifact of a published GitHub Release cannot change.
- An active tag ruleset for `v*` that restricts updates and deletions, allows creation, and has no bypass actors. Tags are protected from the moment they are pushed, including while CI and npm publication are in progress.

To retry a failed run, run the workflow again from its tag. It publishes and releases only what is still missing. Release tags are never moved; to change a released commit, release a new version.

```bash
gh workflow run release.yml --ref v1.2.3
```

## License

MIT
