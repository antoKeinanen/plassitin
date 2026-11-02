# Verification

- npm test: 23 tests pass, including real HiGHS solves compared with exhaustive enumeration for all objective modes.
- npm run typecheck: passes.
- npm run build: passes.
- Browser: changing table count and each table's seat count changes the actual map and persisted document.
- Browser: a new shared code persists on its attendee; a first-name match creates the correct stable attendee link; both chip types can be removed.
- Browser: Arrange interprets all messages and returns a validated assignment for the 24-person sample.
- Browser: pointer-drag events move the camera by the drag distance, wheel zoom changes scale, and Fit restores the view.
- Browser: mobile at 390px places the map above the input grid without document horizontal overflow.
- Browser: the interface contains no heading elements or SVG icons. The icon dependency has been removed.
- Storage: the new versioned editor document can migrate legacy workspaces and restore legacy backups.

The map displays table membership, not optimized neighboring chairs. AI extraction contract tests use a local HTTP service; no real provider is configured.

Annotation follow-up: verified table-click capacity popups, immediate seat-shortage alerts at 17 versus 24 seats, alert removal at 24 seats, bottom-row reference editing/removal, direct anyone-from tag creation and preservation through Arrange, and mobile popup bounds. Test mutations to browser data were restored afterward.
