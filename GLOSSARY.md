# Figma CLI

The CLI calls the Figma REST API as the user or organization that owns the token: it reads Files and what a Library publishes, and it writes Comments, Variables, webhooks, and dev resources.

## Language

**File**:
A Figma design, FigJam board, or Slides deck, addressed by its file key. A branch is a file with its own key.
_Avoid_: Document, project

**Node**:
An item in a File's document tree, such as a page or a layer, addressed by an ID such as `1:2`. Figma URLs write the same ID as `1-2`.
_Avoid_: Layer ID, element

**Comment**:
A message in a File. A root comment starts a thread, can be pinned to a Node, and alone carries the thread's resolution; a reply is created by sending its root's ID as `comment_id`, names that root as `parent_id`, and has no position of its own.
_Avoid_: Thread, annotation

**Version**:
A saved point in a File's history, either autosaved or named by a user.
_Avoid_: Revision, snapshot

**Library**:
A File that publishes Components, Styles, and Variables for other Files to use. Only published items are listed.
_Avoid_: Design system

**Component**:
A reusable design element that a Library publishes. Each variant of a component set is its own Component.
_Avoid_: Symbol

**Style**:
A named color, text, effect, or grid setting that a Library publishes.
_Avoid_: Design token, variable

**Variable**:
A named value, such as a color or a number, in one of a File's variable collections. A Library can publish Variables.
_Avoid_: Design token

**Personal access token**:
A token that acts as the Figma user who generated it, within the scopes chosen when it was generated, until it expires or is revoked.
_Avoid_: API key, password

**Plan access token**:
A token that acts for an organization's plan rather than a user, within its scopes. Some operations, such as activity logs, accept only this kind.

**Profile**:
A named local entry that stores one Personal access token. Several Profiles can belong to the same Figma user.
_Avoid_: Account, user
