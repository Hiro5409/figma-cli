# Figma CLI

The CLI reads Figma files, their comments, and the components and styles a library publishes, and posts comments, as the user who owns the token.

## Language

**File**:
A Figma design, FigJam board, or Slides deck, addressed by its file key. A branch is a file with its own key.
_Avoid_: Document, project

**Node**:
An item in a File's document tree, such as a page or a layer, addressed by an ID such as `1:2`. Figma URLs write the same ID as `1-2`.
_Avoid_: Layer ID, element

**Comment**:
A message in a File. A root comment starts a thread and can be pinned to a Node; a reply belongs to its root's thread and has no position of its own.
_Avoid_: Thread, annotation

**Version**:
A saved point in a File's history, either autosaved or named by a user.
_Avoid_: Revision, snapshot

**Library**:
A File that publishes Components and Styles for other Files to use. Only published items are listed.
_Avoid_: Design system

**Component**:
A reusable design element that a Library publishes. Each variant of a component set is its own Component.
_Avoid_: Symbol

**Style**:
A named color, text, effect, or grid setting that a Library publishes.
_Avoid_: Design token, variable

**Personal access token**:
A token that acts as the Figma user who generated it, within the scopes chosen when it was generated, until it expires or is revoked.
_Avoid_: API key, password

**Profile**:
A named local entry that stores one Personal access token. Several Profiles can belong to the same Figma user.
_Avoid_: Account, user
