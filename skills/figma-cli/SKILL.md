---
name: figma-cli
description: Use figma-cli to call the Figma REST API, such as reading files, nodes, versions, comments, published components and styles, and variables, rendering node images, and posting or deleting comments and reactions.
license: MIT
compatibility: Requires the figma-api command and a Figma personal access token, stored with an interactive login or supplied as FIGMA_ACCESS_TOKEN. Commands whose help names a plan access token need one in FIGMA_ACCESS_TOKEN.
metadata:
  source: https://github.com/Hiro5409/figma-cli
---

# figma-cli

Every Figma REST API operation that accepts a personal or plan access token is a command named `figma-api <resource> <action>`. Discover commands with `--help`, which also names the token scope that Figma's schema lists, and read a request body's shape with `figma-api schema <resource> <action>` before composing `--body`. Results are compact JSON on stdout, and errors are one line of JSON on stderr.

Take IDs from the URL the user shared: `https://www.figma.com/design/<key>/<name>?node-id=1-2` names file key `<key>` and node ID `1:2`, and a branch URL, `.../design/<key>/branch/<branch key>/<name>`, is addressed by its branch key. A file's full document can be very large, so read it with `file show --depth` or `file node list --ids` rather than all at once. Only a thread's root comment carries `resolved_at`, and a reply's `parent_id` names its root; a reply is created by sending the root's ID as `comment_id`. Pass a secret in a body, such as a developer log token filter, through `-` or `@<path>`, and keep it out of shared previews.

Comments, replies, and reactions appear under the token owner's name and can notify the file's collaborators. Present each write exactly, with its file and the node a comment pins to, then wait for explicit user approval. `--dry-run` shows the request a write would send without sending it. Approval covers the unchanged batch only; ask again if the text, target, or placement changes.

Verify each write from its structured result or a follow-up read. If a write's outcome is uncertain, read the affected resource before retrying: Figma may already have applied it.
