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
figma-cli gives coding agents with shell access small Figma operations: every result is compact JSON on stdout, every error is compact JSON on stderr, and writes have `--dry-run` previews.

## Generated from the official schema

The API client is generated from Figma's maintained [OpenAPI specification](https://github.com/figma/rest-api-spec).

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
```

Each command's `--help` names the token scope it needs.

### Authentication

figma-cli authenticates with a [personal access token](https://developers.figma.com/docs/rest-api/authentication/). Generate one in Figma under Settings > Security > Personal access tokens. `auth login` uses `current_user:read` to verify the token before storing it; grant the other scopes the commands you run need.

```bash
figma-api auth login --profile work
op read "op://Private/Figma/credential" | figma-api auth login --profile work --with-token
figma-api auth status
figma-api profile list
```

The CLI never accepts a token as a command argument, which shells and process lists record. `auth login` prompts for it without echoing it, or reads it from standard input with `--with-token`. Stored tokens live in `~/.config/figma-cli/credentials.json` with mode `600`.

A command uses the first token it finds in this order:

1. The stored profile named by `--profile`.
2. `FIGMA_ACCESS_TOKEN`, for a process that a secret manager starts with the token.
3. The stored profile named by `FIGMA_PROFILE`.
4. The default profile, or the only stored one.

Personal access tokens expire within 90 days. When Figma rejects one, store a new token with `auth login --replace`.

### Files

`--file` takes a file key, or a URL copied from the file or a layer. A URL's `node-id` selects the node for commands that act on nodes, and pins a new comment.

```bash
figma-api file meta --file "https://www.figma.com/design/<key>/<name>"
figma-api file show --file <key> --depth 1
figma-api file nodes --file "https://www.figma.com/design/<key>/<name>?node-id=1-2"
figma-api version list --file <key> --limit 10
```

A file's full document can be very large. Limit `file show` with `--depth` or `--node`.

### Images

```bash
figma-api image export --file <key> --node 1:2 --node 3:4 --scale 2 --output-dir exports
figma-api image export --file <key> --node 1:2 --image-format svg
figma-api image fills --file <key>
```

Without `--output-dir`, `image export` prints download URLs, which expire. With it, the images are saved as `<node id>.<format>` and existing files are never overwritten. The downloads go to Figma's image storage without the token. When Figma returns no image for some nodes, the command saves the others, prints every result, and fails with `PARTIAL_SUCCESS`, or with `UPSTREAM_FAILURE` when no node rendered.

### Libraries

```bash
figma-api component list --file <key>
figma-api style list --file <key>
```

Both list only what a library file publishes; a file that publishes nothing lists nothing. Each variant of a component set is its own component, and names its set in `containing_frame.containingComponentSet`.

### Comments

```bash
figma-api comment list --file <key> --unresolved
figma-api comment create --file <key> --node 1:2 --message "Align this with the grid" --dry-run
figma-api comment create --file <key> --reply-to 123456 --message "Fixed"
figma-api comment delete --file <key> --id 123456
figma-api comment reaction add --file <key> --comment-id 123456 --emoji ":+1:"
```

Comments and reactions are posted as the token's user. A new thread is pinned to `--node`, or to the node in a `--file` URL, offset by `--x` and `--y`; `--reply-to` adds to an existing thread and keeps its position. Only the author can delete a comment.

### Errors and retries

Errors are one line of JSON on stderr with a stable `code`, the exit code, and `why` and `hint` fields. Reads are retried on transient failures. When Figma asks to wait more than a minute, the command fails at once with `RATE_LIMITED` and the wait in its hint. Writes are never retried. An `OUTCOME_UNKNOWN` error means Figma may have accepted the write; read the comments before trying again.

## Calling from Agents

```bash
gh skill install Hiro5409/figma-cli figma-cli
```

## Development

Install and [activate mise](https://mise.jdx.dev/getting-started.html), then:

```bash
mise trust
mise install
bun install --frozen-lockfile
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
