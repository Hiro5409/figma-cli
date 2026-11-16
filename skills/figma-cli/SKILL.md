---
name: figma-cli
description: Use figma-cli to read Figma files, versions, comments, and a library's published components and styles, export node images, and post or delete comments and reactions through the Figma REST API.
license: MIT
compatibility: Requires the figma-api command and a Figma personal access token, stored with an interactive login or supplied as FIGMA_ACCESS_TOKEN.
metadata:
  source: https://github.com/Hiro5409/figma-cli
---

# figma-cli

Discover supported commands with `figma-api --help` and unfamiliar arguments with the selected command's `--help`, which also names the token scope the command needs. The upstream API schema and generated client cover more than the CLI exposes. Results are JSON on stdout and errors are JSON on stderr.

Pass `--file` the URL the user shared when there is one: a URL's `node-id` selects the node for commands that act on nodes, and pins a new comment to it. A file's full document can be very large, so read it with `file show --depth` or `file nodes` rather than all at once.

Comments, replies, and reactions appear under the token owner's name and can notify the file's collaborators. Present the exact messages, their files, and the nodes they pin to, then wait for explicit user approval before posting. `--dry-run` shows the request a write would send without sending it. Approval covers the unchanged batch only; ask again if the text, target, or placement changes.

Verify each write from its structured result or a follow-up `comment list`. If a write's outcome is uncertain, read the comments before retrying: Figma may already have posted it.
