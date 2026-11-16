export function figmaFile(overrides: Record<string, unknown> = {}) {
  return {
    name: "Test",
    role: "owner",
    lastModified: "2026-11-16T00:00:00Z",
    editorType: "figma",
    thumbnailUrl: "https://example.com/thumb.png",
    version: "1",
    document: { id: "0:0", name: "Document", type: "DOCUMENT", children: [] },
    components: {},
    componentSets: {},
    schemaVersion: 0,
    styles: {},
    ...overrides,
  };
}
